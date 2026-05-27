/**
 * Fast remote upload by streaming a local file into `ssh <host> 'cat > file'`,
 * reusing the user's system ssh config (keys, agent, ProxyJump, ControlMaster).
 *
 * This exists because pushing bulk bytes through the app's shared ssh2 client
 * connection is slow — that connection is busy carrying PTY/agent traffic, which
 * starves the transfer (~17 KB/s observed). A dedicated native ssh process is as
 * fast as the user's own `scp`/`ssh 'cat >'` workflow and does not compete with
 * the live session.
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { quoteShellArg } from '@main/utils/shellEscape';

/** Connection coordinates needed to reach the host with the system ssh client. */
export interface NativeSshUploadTarget {
  /** ~/.ssh/config Host alias, when the connection was created from one. */
  alias?: string;
  /** Hostname the user entered (used when there is no alias). */
  host: string;
  port: number;
  username: string;
  /** `-J` jump host, when configured outside an alias. */
  proxyJump?: string;
}

/**
 * Build argv for `ssh`. Prefers the config alias as the destination so the
 * user's full ~/.ssh/config (IdentityFile, ProxyJump, etc.) applies; pins the
 * username/port we authenticated as. BatchMode keeps it non-interactive so a
 * password-only host fails fast (the caller then falls back to the ssh2 path)
 * instead of hanging on a prompt. ControlMaster reuses one connection across
 * repeated uploads, avoiding a fresh handshake each time.
 */
export function buildNativeSshArgs(target: NativeSshUploadTarget, remoteCommand: string): string[] {
  // %C is a short hash of (host, port, user, …); keeps the socket path well under
  // the ~104-char macOS unix-socket limit (tmpdir() can already be ~50 chars).
  const controlPath = '/tmp/tondash-ssh-%C';
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ControlMaster=auto',
    '-o',
    `ControlPath=${controlPath}`,
    '-o',
    'ControlPersist=60',
    '-C',
    '-p',
    String(target.port || 22),
    '-l',
    target.username,
  ];
  // ProxyJump from an alias is already applied via the alias; only add it
  // explicitly when connecting by raw hostname.
  if (target.proxyJump && !target.alias) {
    args.push('-J', target.proxyJump);
  }
  args.push('--', target.alias ?? target.host, remoteCommand);
  return args;
}

/**
 * Stream a local file to `<remoteDir>/<remoteName>` via native ssh. Resolves
 * with the absolute remote path. Rejects on spawn error, non-zero exit, or the
 * timeout — the caller treats any rejection as "fall back to the ssh2 stream".
 */
export function uploadFileViaNativeSsh(opts: {
  target: NativeSshUploadTarget;
  localAbsPath: string;
  remoteDir: string;
  remoteName: string;
  total: number;
  timeoutMs: number;
  sshPath?: string;
  onProgress?: (transferred: number, total: number) => void;
}): Promise<string> {
  const { target, localAbsPath, remoteDir, remoteName, total, timeoutMs, onProgress } = opts;
  const remoteFull = `${remoteDir}/${remoteName}`;
  // -m 700: keep pasted artifacts private; idempotent so concurrent uploads are fine.
  const command = `mkdir -p -m 700 ${quoteShellArg(remoteDir)} && cat > ${quoteShellArg(
    remoteFull
  )}`;
  const args = buildNativeSshArgs(target, command);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(opts.sshPath ?? '/usr/bin/ssh', args, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let settled = false;
    let stderr = '';
    let transferred = 0;
    const fileStream = createReadStream(localAbsPath);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fileStream.destroy();
      if (!child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }
      if (error) reject(error);
      else resolve(remoteFull);
    };

    const timer = setTimeout(() => {
      finish(new Error(`Native ssh upload timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8');
    });
    child.on('error', (e: Error) => finish(e));
    child.on('close', (code: number | null) => {
      if (code && code !== 0) {
        finish(new Error(`ssh exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
      } else {
        finish();
      }
    });

    fileStream.on('data', (chunk: string | Buffer) => {
      transferred += chunk.length;
      onProgress?.(transferred, total);
    });
    fileStream.on('error', (e: Error) => finish(e));
    // stdin closes when the child dies mid-transfer; swallow the resulting EPIPE.
    child.stdin.on('error', () => {});
    fileStream.pipe(child.stdin);
  });
}
