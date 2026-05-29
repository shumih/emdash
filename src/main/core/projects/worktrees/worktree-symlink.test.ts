import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalWorktreeHost } from './hosts/local-worktree-host';

describe('LocalWorktreeHost.symlinkAbsolute', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-host-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates a symlink to an existing directory inside allowed roots', async () => {
    const src = path.join(root, 'node_modules');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'marker.txt'), 'ok');
    const link = path.join(root, 'wt', 'node_modules');
    await fs.mkdir(path.dirname(link), { recursive: true });

    const host = await LocalWorktreeHost.create({ allowedRoots: [root] });
    await host.symlinkAbsolute(src, link);

    const stat = await fs.lstat(link);
    expect(stat.isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(link, 'marker.txt'), 'utf8')).toBe('ok');
  });

  it('rejects link paths outside allowed roots', async () => {
    const host = await LocalWorktreeHost.create({ allowedRoots: [root] });
    const src = path.join(root, 'node_modules');
    await fs.mkdir(src, { recursive: true });
    await expect(
      host.symlinkAbsolute(src, path.join(os.tmpdir(), 'wt-host-escape-link'))
    ).rejects.toThrow();
  });
});
