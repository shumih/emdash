import { defineEvent } from '@shared/ipc/events';

// 'pty:data' matches the channel name consumed by TerminalSessionManager.
export const ptyDataChannel = defineEvent<string>('pty:data');

export const ptyExitChannel = defineEvent<{
  exitCode: number;
  signal?: number;
}>('pty:exit');

export const ptyInputChannel = defineEvent<string>('pty:input');

/**
 * Progress for an SFTP upload of pasted/dropped files to a remote host.
 * Emitted with the upload's `uploadId` as the topic so the initiating
 * renderer can scope its subscription to just that batch.
 */
export type PtyUploadProgress = {
  uploadId: string;
  /** Human-readable file name being transferred. */
  name: string;
  /** 1-based index of the current file in the batch. */
  index: number;
  /** Total files in the batch. */
  count: number;
  /** Bytes transferred so far for the current file. */
  transferred: number;
  /** Total bytes of the current file (0 if unknown). */
  total: number;
  phase: 'progress' | 'done';
};

export const ptyUploadProgressChannel = defineEvent<PtyUploadProgress>('pty:upload-progress');
