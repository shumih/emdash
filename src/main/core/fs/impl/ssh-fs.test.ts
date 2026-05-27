import { EventEmitter } from 'node:events';
import type * as NodeFs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as RemoteShellProfileModule from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { FileEntry, FileListResult } from '../types';
import { SshFileSystem, sanitizeRemoteUploadName, uploadTimeoutMs } from './ssh-fs';

// node:fs and the shell-command builder are mocked so the streaming-upload
// tests can drive a fake local file and a fake remote channel deterministically.
const fsMocks = vi.hoisted(() => ({
  statSync: vi.fn(),
  createReadStream: vi.fn(),
}));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  statSync: fsMocks.statSync,
  createReadStream: fsMocks.createReadStream,
}));
vi.mock('@main/core/ssh/lifecycle/remote-shell-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof RemoteShellProfileModule>()),
  // Identity wrapper: the test asserts the raw `cat >` command we build.
  buildRemoteShellCommand: (_profile: unknown, command: string) => command,
}));

describe('sanitizeRemoteUploadName', () => {
  it('keeps safe characters intact', () => {
    expect(sanitizeRemoteUploadName('abc-123_DEF.png')).toBe('abc-123_DEF.png');
  });

  it('strips directory components (no traversal)', () => {
    expect(sanitizeRemoteUploadName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeRemoteUploadName('/tmp/foo/bar.png')).toBe('bar.png');
    expect(sanitizeRemoteUploadName('a\\b\\c.png')).toBe('c.png');
  });

  it('replaces shell metacharacters and spaces with underscores', () => {
    expect(sanitizeRemoteUploadName('my shot.png')).toBe('my_shot.png');
    expect(sanitizeRemoteUploadName('a;b`c$d.png')).toBe('a_b_c_d.png');
  });

  it('neutralizes leading dots', () => {
    expect(sanitizeRemoteUploadName('...hidden')).toBe('hidden');
    expect(sanitizeRemoteUploadName('..')).toBe('upload');
  });

  it('falls back to "upload" for empty results', () => {
    expect(sanitizeRemoteUploadName('')).toBe('upload');
    expect(sanitizeRemoteUploadName('/')).toBe('upload');
  });
});

describe('uploadTimeoutMs', () => {
  it('uses a 10s floor for tiny files', () => {
    expect(uploadTimeoutMs(0)).toBe(10_000);
    expect(uploadTimeoutMs(1)).toBe(11_000);
  });

  it('adds 1s per megabyte so large files are not cut off', () => {
    expect(uploadTimeoutMs(2 * 1024 * 1024)).toBe(12_000);
    expect(uploadTimeoutMs(10 * 1024 * 1024)).toBe(20_000);
  });
});

function listResult(entries: FileEntry[]): FileListResult {
  return { entries, total: entries.length };
}

function fileEntry(path: string, mtimeMs: number, size = 1): FileEntry {
  return {
    path,
    type: 'file',
    size,
    mtime: new Date(mtimeMs),
    mode: 0o100644,
  };
}

/** Minimal stand-in for an ssh2 ClientChannel driven by a piped read stream. */
class FakeChannel extends EventEmitter {
  stderr = new EventEmitter();
  closed = false;
  exitCode = 0;
  stderrText = '';
  close() {
    this.closed = true;
  }
  // Called by FakeReadStream once all chunks are "sent".
  _complete() {
    if (this.stderrText) this.stderr.emit('data', Buffer.from(this.stderrText));
    this.emit('close', this.exitCode);
  }
}

/** Minimal stand-in for fs.createReadStream that emits the given chunks. */
class FakeReadStream extends EventEmitter {
  destroyed = false;
  constructor(private readonly chunks: Buffer[]) {
    super();
  }
  pipe(dest: FakeChannel): FakeChannel {
    setImmediate(() => {
      for (const chunk of this.chunks) this.emit('data', chunk);
      dest._complete();
    });
    return dest;
  }
  destroy() {
    this.destroyed = true;
  }
}

describe('SshFileSystem.uploadToTemp (streaming cat)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function makeFs(opts: { size: number; chunks: Buffer[]; channel: FakeChannel }) {
    const execCommands: string[] = [];
    const proxy = {
      getRemoteShellProfile: vi.fn().mockResolvedValue({}),
      exec: vi.fn((command: string, cb: (err: Error | undefined, ch: FakeChannel) => void) => {
        execCommands.push(command);
        cb(undefined, opts.channel);
      }),
    };
    fsMocks.statSync.mockReturnValue({ size: opts.size });
    fsMocks.createReadStream.mockReturnValue(new FakeReadStream(opts.chunks));
    const fs = new SshFileSystem(proxy as never, '/repo');
    // Prune is fire-and-forget; stub it so the fake channel isn't reused for find.
    vi.spyOn(
      fs as never as { pruneOldUploads: () => Promise<void> },
      'pruneOldUploads'
    ).mockResolvedValue(undefined);
    return { fs, execCommands };
  }

  it('streams via `mkdir … && cat >` and returns the sanitized absolute path', async () => {
    const channel = new FakeChannel();
    const { fs, execCommands } = makeFs({
      size: 1000,
      chunks: [Buffer.alloc(500), Buffer.alloc(500)],
      channel,
    });

    const remote = await fs.uploadToTemp('/local/My Shot.png', 'My Shot.png');

    expect(remote).toBe('/tmp/tondash/artifacts/My_Shot.png');
    expect(execCommands).toHaveLength(1);
    expect(execCommands[0]).toBe(
      "mkdir -p -m 700 '/tmp/tondash/artifacts' && cat > '/tmp/tondash/artifacts/My_Shot.png'"
    );
    expect(channel.closed).toBe(true);
  });

  it('reports transfer progress from bytes read off disk', async () => {
    const channel = new FakeChannel();
    const { fs } = makeFs({
      size: 1000,
      chunks: [Buffer.alloc(500), Buffer.alloc(500)],
      channel,
    });

    const steps: Array<{ transferred: number; total: number }> = [];
    await fs.uploadToTemp('/local/x.png', 'x.png', (transferred, total) =>
      steps.push({ transferred, total })
    );

    expect(steps).toEqual([
      { transferred: 0, total: 1000 },
      { transferred: 500, total: 1000 },
      { transferred: 1000, total: 1000 },
    ]);
  });

  it('rejects when the remote cat exits non-zero', async () => {
    const channel = new FakeChannel();
    channel.exitCode = 1;
    channel.stderrText = 'No space left on device';
    const { fs } = makeFs({ size: 10, chunks: [Buffer.alloc(10)], channel });

    await expect(fs.uploadToTemp('/local/x.png', 'x.png')).rejects.toThrow(/code 1.*No space left/);
  });
});

describe('SshFileSystem.watch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits modify events when an existing polled file changes metadata', async () => {
    vi.useFakeTimers();

    const fs = new SshFileSystem({} as never, '/repo');
    vi.spyOn(fs, 'list')
      .mockResolvedValueOnce(listResult([fileEntry('notes.md', 1_000)]))
      .mockResolvedValueOnce(listResult([fileEntry('notes.md', 2_000)]));

    const events: Array<{ type: string; entryType: string; path: string }> = [];
    const watcher = fs.watch((batch) => events.push(...batch), { debounceMs: 10 });
    watcher.update(['']);

    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual([]);

    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual([{ type: 'modify', entryType: 'file', path: 'notes.md' }]);

    watcher.close();
  });
});
