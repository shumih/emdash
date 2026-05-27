import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { RawBundle, RawFile, ShareProviderId } from '@shared/shared-sessions';
import { encodeClaudeProjectDir } from './claude-transcript-locator';

/**
 * Locating and reading/writing the RAW on-disk transcript for a session, given
 * a filesystem rooted at the home directory whose CLI dirs (`.claude`,
 * `.codex`, `.cursor`) hold the transcripts. The same module serves local and
 * SSH connections — the caller supplies the appropriate home-rooted fs.
 *
 * All three providers store a session as a single file:
 *   claude → .claude/projects/<enc-cwd>/<sid>.jsonl
 *   codex  → .codex/sessions/YYYY/MM/DD/rollout-<ts>-<sid>.jsonl  (fixed depth)
 *   cursor → .cursor/chats/<chatId>/<agentId>/store.db           (binary SQLite)
 */

/** Where each provider keeps a session's single transcript file (read side). */
function claudeRelPath(cwd: string, sessionId: string): string {
  return `.claude/projects/${encodeClaudeProjectDir(cwd)}/${sessionId}.jsonl`;
}

/**
 * Codex buckets rollouts by date (YYYY/MM/DD) — exactly three dir levels, so a
 * fixed-depth glob avoids needing `**`/globstar (which the SSH shell glob does
 * not enable).
 */
function codexReadGlob(sessionId: string): string {
  return `.codex/sessions/*/*/*/rollout-*-${sessionId}.jsonl`;
}

/**
 * Applied Codex sessions are written into the same native YYYY/MM/DD layout (so
 * the Codex CLI discovers them and `resume --last` sees the freshest one) with a
 * `rollout-<ts>-<sid>.jsonl` name that the read glob also matches. The date/time
 * is the current instant: that keeps it newest for `--last`, and DB-level
 * idempotency (see apply-shared-session) prevents duplicate conversations.
 */
function codexWriteRelPath(sessionId: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const ts = now.toISOString().replace(/[:.]/g, '-').replace(/-?Z$/, '');
  return `.codex/sessions/${yyyy}/${mm}/${dd}/rollout-${ts}-${sessionId}.jsonl`;
}

/** Cursor nests store.db under an agent-id dir we glob for (read side). */
function cursorReadGlob(chatId: string): string {
  return `.cursor/chats/${chatId}/*/store.db`;
}

function cursorWriteRelPath(chatId: string): string {
  // Deterministic agent-id segment keeps re-apply idempotent on disk.
  return `.cursor/chats/${chatId}/${chatId}/store.db`;
}

/**
 * Resolve the relative path (under home) of the existing transcript file for a
 * session, or null if it can't be found. Claude is a direct lookup; codex and
 * cursor are located by glob.
 */
export async function locateTranscriptFile(
  homeFs: FileSystemProvider,
  provider: ShareProviderId,
  sessionId: string,
  cwd?: string
): Promise<string | null> {
  if (provider === 'claude') {
    if (!cwd) return null;
    const rel = claudeRelPath(cwd, sessionId);
    return (await homeFs.exists(rel)) ? rel : null;
  }
  const pattern = provider === 'codex' ? codexReadGlob(sessionId) : cursorReadGlob(sessionId);
  try {
    const matches = await homeFs.glob(pattern, { dot: true });
    return matches.length > 0 ? matches[0] : null;
  } catch (err) {
    log.warn('locateTranscriptFile: glob failed', { provider, error: String(err) });
    return null;
  }
}

/**
 * Read the raw transcript for a session into a RawBundle (base64). Throws if the
 * file can't be located or the fs lacks binary read support.
 */
export async function readRawTranscript(
  homeFs: FileSystemProvider,
  provider: ShareProviderId,
  sessionId: string,
  cwd?: string
): Promise<RawBundle> {
  if (!homeFs.readBytes) {
    throw new Error('Filesystem does not support binary reads (readBytes)');
  }
  const rel = await locateTranscriptFile(homeFs, provider, sessionId, cwd);
  if (!rel) {
    throw new Error(`Transcript not found for ${provider} session ${sessionId}`);
  }
  const { base64, truncated, totalSize } = await homeFs.readBytes(rel);
  if (truncated) {
    // Sharing a partial transcript would upload (and later apply) a corrupt file.
    throw new Error(
      `Transcript for ${provider} session ${sessionId} is too large to share (${totalSize} bytes).`
    );
  }
  const relName = rel.split('/').pop() ?? rel;
  const files: RawFile[] = [{ relName, base64 }];
  return { provider, files, meta: { sourceSessionId: sessionId, cwd } };
}

/**
 * Compute the deterministic destination path for writing an applied session's
 * transcript. Stable across re-applies (no timestamps) so apply is idempotent.
 */
export function destTranscriptPath(
  provider: ShareProviderId,
  sessionId: string,
  cwd?: string
): string {
  switch (provider) {
    case 'claude':
      if (!cwd) throw new Error('cwd required to place a Claude transcript');
      return claudeRelPath(cwd, sessionId);
    case 'codex':
      return codexWriteRelPath(sessionId);
    case 'cursor':
      return cursorWriteRelPath(sessionId);
  }
}

/**
 * Write a converted transcript (single file) to the target provider's session
 * directory under a deterministic id. Returns the relative path written.
 */
export async function writeRawTranscript(
  homeFs: FileSystemProvider,
  provider: ShareProviderId,
  sessionId: string,
  bundle: RawBundle,
  cwd?: string
): Promise<string> {
  if (!homeFs.writeBytes) {
    throw new Error('Filesystem does not support binary writes (writeBytes)');
  }
  const file = bundle.files[0];
  if (!file) throw new Error('Converted bundle has no files');
  const dest = destTranscriptPath(provider, sessionId, cwd);
  await homeFs.writeBytes(dest, file.base64);
  return dest;
}

/**
 * Best-effort one-line preview of a transcript for search results. Reads only a
 * small prefix; returns undefined for binary (Cursor) or on any error.
 */
export async function readTranscriptSnippet(
  homeFs: FileSystemProvider,
  provider: ShareProviderId,
  sessionId: string,
  cwd?: string
): Promise<string | undefined> {
  if (provider === 'cursor') return undefined; // binary SQLite, no cheap text peek
  try {
    const rel = await locateTranscriptFile(homeFs, provider, sessionId, cwd);
    if (!rel) return undefined;
    const { content } = await homeFs.read(rel, 4096);
    const firstLine = content.split('\n').find((l) => l.trim().length > 0);
    if (!firstLine) return undefined;
    try {
      const obj = JSON.parse(firstLine) as Record<string, unknown>;
      const text =
        (obj.text as string) ??
        (typeof obj.message === 'object' && obj.message
          ? JSON.stringify((obj.message as Record<string, unknown>).content)
          : undefined);
      return (text ?? firstLine).slice(0, 200);
    } catch {
      return firstLine.slice(0, 200);
    }
  } catch {
    return undefined;
  }
}
