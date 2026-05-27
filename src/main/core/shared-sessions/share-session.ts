import { readRawTranscript } from '@main/core/conversations/transcript-io';
import { log } from '@main/lib/logger';
import { isShareProvider, type SaveResult, type ShareSessionParams } from '@shared/shared-sessions';
import { getConversationRow, getTaskCwd, resolveConnectionFs } from './connection-fs';
import { sessionShareStore } from './http-store';
import { shareIdForConversation } from './ids';

/**
 * Share a conversation's session: read its raw on-disk transcript, tag it with
 * the source provider, and upload it to the storage service. The store performs
 * any cross-provider conversion on its side. Re-sharing the same conversation
 * reuses a deterministic shareId so the stored entry is updated, not duplicated.
 *
 * The caller (UI) is responsible for confirming the upload first — transcripts
 * leave the machine and may contain source code.
 */
export async function shareSession(params: ShareSessionParams): Promise<SaveResult> {
  const conv = await getConversationRow(params.conversationId);
  const provider = conv.provider ?? '';
  if (!isShareProvider(provider)) {
    throw new Error(`Provider "${provider}" is not shareable (expected claude, codex, or cursor).`);
  }
  if (!conv.providerSessionId) {
    throw new Error(
      'This session has no captured provider session id yet, so its transcript cannot be located.'
    );
  }

  const { homeFs } = await resolveConnectionFs(conv.projectId);
  const cwd = await getTaskCwd(conv.projectId, conv.taskId);

  const bundle = await readRawTranscript(homeFs, provider, conv.providerSessionId, cwd);
  bundle.meta.title = conv.title;

  const shareId = shareIdForConversation(conv.id);
  const result = await sessionShareStore.save({ shareId, bundle });

  log.info('shareSession: uploaded', { conversationId: conv.id, provider, ref: result.ref });
  return result;
}
