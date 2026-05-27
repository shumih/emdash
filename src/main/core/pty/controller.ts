import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { ptyUploadProgressChannel } from '@shared/events/ptyEvents';
import { createRPCController } from '@shared/ipc/rpc';
import { parsePtySessionId } from '@shared/ptySessionId';
import { err, ok } from '@shared/result';
import { taskManager } from '../tasks/task-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import {
  cleanupExpiredDroppedBlobs,
  DROPPED_BLOB_FILENAME_PREFIX,
  persistClipboardImagePath,
  persistDroppedBlobBytes,
} from './persist-dropped-blob';
import { ptySessionRegistry } from './pty-session-registry';

void cleanupExpiredDroppedBlobs().catch((error) => {
  log.warn('pty:cleanupExpiredDroppedBlobs failed', { error });
});

/**
 * Recover a human-readable name from a local upload path for progress display.
 * Temp blobs are named `emdash-drop-<uuid>[-<name>]<ext>`; strip the prefix and
 * uuid so the user sees e.g. `paste.png` rather than the internal temp name.
 */
function prettyUploadName(base: string): string {
  if (!base.startsWith(DROPPED_BLOB_FILENAME_PREFIX)) return base;
  const rest = base.slice(DROPPED_BLOB_FILENAME_PREFIX.length).replace(/^[0-9a-f-]{36}-?/i, '');
  return rest && !rest.startsWith('.') ? rest : `image${rest}`;
}

export const ptyController = createRPCController({
  /** Send raw input data to a PTY session. */
  sendInput: (sessionId: string, data: string) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.write(data);
    if (data.includes('\r')) {
      const meta = ptySessionRegistry.getMetadata(sessionId);
      if (meta?.providerId && !meta.isRemote) {
        const parsed = parsePtySessionId(sessionId);
        if (parsed) {
          conversationEvents._emit('conversation:input-submitted', {
            projectId: parsed.projectId,
            taskId: parsed.scopeId,
            conversationId: parsed.leafId,
            providerId: meta.providerId,
          });
        }
      }
    }
    return ok();
  },

  /** Resize a PTY session to the given terminal dimensions. */
  resize: (sessionId: string, cols: number, rows: number) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.resize(cols, rows);
    return ok();
  },

  /**
   * Atomically return the ring buffer and register the renderer as a consumer
   * for future IPC delivery. Non-destructive — the ring buffer is kept intact.
   * Called once by the renderer when connecting a FrontendPty to a session.
   */
  subscribe: (sessionId: string) => {
    return ok({ buffer: ptySessionRegistry.subscribe(sessionId) });
  },

  /**
   * Remove the renderer's consumer registration for a session.
   * Called when the renderer disposes its FrontendPty.
   */
  unsubscribe: (sessionId: string) => {
    ptySessionRegistry.unsubscribe(sessionId);
    return ok();
  },

  /** Kill a PTY session and clean it up immediately. */
  kill: (sessionId: string) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('ptyController.kill: error killing PTY', { sessionId, error: String(e) });
      }
    }
    ptySessionRegistry.unregister(sessionId);
    return ok();
  },

  /**
   * Upload local files into the shared remote temp dir (`/tmp/tondash/artifacts`)
   * on a remote SSH host and return their absolute remote paths. Kept out of the
   * worktree so pasted/dropped images don't pollute the project. Uses the SFTP
   * subsystem of the already-connected ssh2 client — no local ssh/scp binaries.
   *
   * The session ID encodes the project and scope (`projectId:scopeId:leafId`),
   * where `scopeId` is a task ID for conversation uploads.
   */
  uploadFiles: async (args: { sessionId: string; localPaths: string[]; uploadId?: string }) => {
    try {
      const parsed = parsePtySessionId(args.sessionId);
      if (!parsed) {
        return err({ type: 'invalid_session' as const });
      }
      const { scopeId } = parsed;

      const taskProvider = taskManager.getTask(scopeId);
      if (!taskProvider) return err({ type: 'not_ssh' as const });

      const workspaceId = taskManager.getWorkspaceId(scopeId) ?? '';
      const workspace = workspaceRegistry.get(workspaceId);
      if (!workspace?.fs.uploadToTemp) return err({ type: 'not_ssh' as const });

      const { uploadId } = args;
      const count = args.localPaths.length;
      // Sequential so the single progress toast advances file-by-file cleanly.
      const remotePaths: string[] = [];
      for (let i = 0; i < args.localPaths.length; i++) {
        const localPath = args.localPaths[i];
        const name = prettyUploadName(basename(localPath));
        let total = 0;
        let lastEmit = 0;
        const emit = (transferred: number, t: number, phase: 'progress' | 'done') => {
          if (!uploadId) return;
          if (t) total = t;
          const now = Date.now();
          // Throttle in-flight updates to ~12/s; always emit completion.
          if (phase === 'progress' && transferred < total && now - lastEmit < 80) return;
          lastEmit = now;
          events.emit(
            ptyUploadProgressChannel,
            { uploadId, name, index: i + 1, count, transferred, total, phase },
            uploadId
          );
        };
        const remote = await workspace.fs.uploadToTemp!(
          localPath,
          `${randomUUID()}-${basename(localPath)}`,
          (transferred, t) => emit(transferred, t, 'progress')
        );
        emit(total, total, 'done');
        remotePaths.push(remote);
      }
      return ok({ remotePaths });
    } catch (e: unknown) {
      log.error('pty:uploadFiles failed', {
        sessionId: args.sessionId,
        error: (e as Error)?.message || e,
      });
      return err({ type: 'upload_failed' as const, message: String((e as Error)?.message || e) });
    }
  },

  /**
   * Persist a dropped or pasted in-memory image to a stable temp file.
   * HEIC/HEIF bytes are converted to PNG so Claude Code can inline them.
   */
  persistDroppedBlob: async (args: { bytes: Uint8Array; name?: string; mimeType?: string }) => {
    try {
      const path = await persistDroppedBlobBytes(args);
      return ok({ path });
    } catch (e: unknown) {
      log.error('pty:persistDroppedBlob failed', {
        error: (e as Error)?.message || e,
      });
      return err({ type: 'persist_failed' as const, message: String((e as Error)?.message || e) });
    }
  },

  /** Persist the OS clipboard image (macOS HEIC paste, screenshots, etc.). */
  persistClipboardImage: async () => {
    try {
      const path = await persistClipboardImagePath();
      return ok({ path });
    } catch (e: unknown) {
      log.error('pty:persistClipboardImage failed', {
        error: (e as Error)?.message || e,
      });
      return err({ type: 'persist_failed' as const, message: String((e as Error)?.message || e) });
    }
  },
});
