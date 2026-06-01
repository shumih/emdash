import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Builds a pid → direct-children index from a single `ps` snapshot so callers
 * can fold an agent's whole subprocess subtree (MCP servers and their
 * descendants) into one resource row. Pure helpers are split out from the
 * sampler so they're testable without the Electron/db import chain.
 */

/** Parse `ps -axo pid=,ppid=` output into a pid → child pids map. */
export function parseChildrenIndex(stdout: string): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const list = children.get(ppid);
    if (list) list.push(pid);
    else children.set(ppid, [pid]);
  }
  return children;
}

/** All pids in the subtree rooted at `root` (inclusive). Cycle-safe. */
export function subtreePids(root: number, children: Map<number, number[]>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const stack: number[] = [root];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    const kids = children.get(pid);
    if (kids) for (const kid of kids) stack.push(kid);
  }
  return out;
}

/**
 * pid → direct child pids, from a single `ps` snapshot. Returns null when `ps`
 * is unavailable (Windows) or fails, so callers degrade to per-root sampling.
 */
export async function buildChildrenIndex(): Promise<Map<number, number[]> | null> {
  if (process.platform === 'win32') return null;
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid='], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return parseChildrenIndex(stdout);
  } catch {
    return null;
  }
}
