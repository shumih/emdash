import { toast } from 'sonner';
import { rpc } from '@renderer/lib/ipc';

export interface ShareTarget {
  projectId: string;
  taskId: string;
  conversationId: string;
  /** Conversation title used purely for the success-toast headline. */
  title?: string;
}

/**
 * Share a conversation in one shot: upload via RPC, copy the link, and surface
 * a toast that shows the link (text is selectable so the user can re-grab it).
 * No intermediate modal — the privacy implications are documented in Settings
 * and apply only when sharing is enabled there.
 */
export async function shareCurrentSession(target: ShareTarget): Promise<void> {
  const id = toast.loading('Sharing session…');
  try {
    const result = await rpc.sharedSessions.share({
      projectId: target.projectId,
      taskId: target.taskId,
      conversationId: target.conversationId,
    });
    const link = result.url ?? result.ref;
    try {
      await rpc.app.clipboardWriteText(link);
    } catch {
      // Clipboard failures are non-fatal — the link is still in the toast.
    }
    toast.success(target.title ? `Shared "${target.title}"` : 'Session shared', {
      id,
      description: link,
      duration: 8_000,
    });
  } catch (e) {
    toast.error('Could not share session', {
      id,
      description: e instanceof Error ? e.message : String(e),
    });
  }
}
