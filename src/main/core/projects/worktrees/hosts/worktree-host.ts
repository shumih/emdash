import type { FileEntry } from '@main/core/fs/types';

/** Thrown by hosts that cannot create symlinks (e.g. remote SSH hosts). */
export class WorktreeSymlinkUnsupportedError extends Error {
  constructor(message = 'Symlinks are not supported on this worktree host') {
    super(message);
    this.name = 'WorktreeSymlinkUnsupportedError';
  }
}

export interface WorktreeHost {
  existsAbsolute(path: string): Promise<boolean>;
  mkdirAbsolute(path: string, options?: { recursive?: boolean }): Promise<void>;
  removeAbsolute(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<{ success: boolean; error?: string }>;
  realPathAbsolute(path: string): Promise<string>;
  globAbsolute(pattern: string, options: { cwd: string; dot?: boolean }): Promise<string[]>;
  readFileAbsolute(path: string): Promise<string>;
  copyFileAbsolute(src: string, dest: string): Promise<void>;
  /**
   * Create a symbolic link at `linkPath` pointing to `target`.
   * `target` must already exist; `linkPath` must not. Throws if the host
   * cannot create symlinks (e.g. remote SSH hosts in the current implementation).
   */
  symlinkAbsolute(target: string, linkPath: string): Promise<void>;
  statAbsolute(path: string): Promise<FileEntry | null>;
}
