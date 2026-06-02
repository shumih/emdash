import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';

/**
 * Claude Code stores each session transcript at
 *   <home>/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 * where the cwd is encoded by replacing every "/" and "." with "-". The file
 * basename (sans extension) IS the real session id Claude chose.
 *
 * We use this to recover the real session id when the hook channel is
 * unavailable (e.g. SSH sessions, where hooks aren't wired) or as a backstop
 * for local sessions when no hook has fired yet.
 */

/** Encode an absolute cwd into Claude's project directory name. */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[/\\.]/g, '-');
}

/**
 * List the session ids present in Claude's transcript dir for the given cwd.
 * Best-effort: returns an empty set if the directory does not exist or cannot
 * be read. `fs` must be rooted at the home directory whose `.claude` is read.
 */
export async function listClaudeSessionIds(
  fs: Pick<FileSystemProvider, 'list'>,
  cwd: string
): Promise<Set<string>> {
  const dir = `.claude/projects/${encodeClaudeProjectDir(cwd)}`;
  try {
    const result = await fs.list(dir, { includeHidden: true, maxEntries: 10000 });
    const ids = new Set<string>();
    for (const entry of result.entries) {
      const name = entry.path.split(/[\\/]/).pop() ?? '';
      if (name.endsWith('.jsonl')) ids.add(name.slice(0, -'.jsonl'.length));
    }
    return ids;
  } catch {
    return new Set<string>();
  }
}

/**
 * Best-effort: return the session id of the most recently modified transcript
 * file under Claude's project dir for the given cwd, or null if none exist.
 *
 * Used as a fallback at share/lookup time when `providerSessionId` was never
 * captured (e.g. conversation predates capture, reconcile timed out, or cwd
 * mismatch). Single‑transcript dirs are unambiguous; multi-transcript dirs
 * resolve to the freshest, which is almost always what the user just used.
 */
export async function findMostRecentClaudeSession(
  fs: Pick<FileSystemProvider, 'list'>,
  cwd: string
): Promise<string | null> {
  const dir = `.claude/projects/${encodeClaudeProjectDir(cwd)}`;
  try {
    const result = await fs.list(dir, { includeHidden: true, maxEntries: 10000 });
    let best: { sid: string; mtime: number } | null = null;
    for (const entry of result.entries) {
      const name = entry.path.split(/[\\/]/).pop() ?? '';
      if (!name.endsWith('.jsonl')) continue;
      const sid = name.slice(0, -'.jsonl'.length);
      const mtime = entry.mtime?.getTime() ?? 0;
      if (!best || mtime > best.mtime) best = { sid, mtime };
    }
    return best?.sid ?? null;
  } catch {
    return null;
  }
}

/**
 * Return the single new session id that appeared in `after` but not in
 * `before`. If zero or more than one appeared, returns undefined — we never
 * guess when the attribution is ambiguous (e.g. two sessions sharing a cwd).
 */
export function pickNewSessionId(before: Set<string>, after: Set<string>): string | undefined {
  const added: string[] = [];
  for (const id of after) if (!before.has(id)) added.push(id);
  return added.length === 1 ? added[0] : undefined;
}

/**
 * Poll Claude's transcript dir until a single new session id appears (relative
 * to `before`), then invoke `onResolved` with it. Stops on timeout or when
 * `isAlive()` returns false. Fire-and-forget; never throws.
 */
export async function reconcileClaudeSessionId(opts: {
  fs: Pick<FileSystemProvider, 'list'>;
  cwd: string;
  before: Set<string>;
  isAlive: () => boolean;
  onResolved: (sessionId: string) => void | Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<void> {
  const { fs, cwd, before, isAlive, onResolved } = opts;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const pollMs = opts.pollMs ?? 1500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isAlive()) return;
    await new Promise((r) => setTimeout(r, pollMs));
    if (!isAlive()) return;
    const after = await listClaudeSessionIds(fs, cwd);
    const found = pickNewSessionId(before, after);
    if (found) {
      try {
        await onResolved(found);
      } catch (err) {
        log.warn('reconcileClaudeSessionId: onResolved failed', { error: String(err) });
      }
      return;
    }
  }
}
