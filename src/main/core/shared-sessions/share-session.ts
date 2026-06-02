import { findMostRecentClaudeSession } from '@main/core/conversations/claude-transcript-locator';
import { setProviderSessionId } from '@main/core/conversations/setProviderSessionId';
import { readRawTranscript } from '@main/core/conversations/transcript-io';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import {
  isShareProvider,
  type SaveResult,
  type ShareProviderId,
  type ShareSessionParams,
} from '@shared/shared-sessions';
import { getConversationRow, getTaskCwd, resolveConnectionFs } from './connection-fs';
import { sessionShareStore } from './http-store';
import { shareIdForConversation } from './ids';

/**
 * Best-effort recovery when a conversation has no captured providerSessionId.
 * This happens for older conversations created before the reconcile logic was
 * wired up, or when the CLI wrote its transcript under a cwd different from
 * what tondash expected. For Claude we can locate the freshest .jsonl under
 * the encoded-cwd dir — that's almost always the session the user just used.
 * Codex/Cursor have no cwd in their path layout, so we can't safely guess.
 */
async function discoverProviderSessionId(
  provider: ShareProviderId,
  homeFs: FileSystemProvider,
  cwd: string
): Promise<string | null> {
  if (provider !== 'claude') return null;
  return findMostRecentClaudeSession(homeFs, cwd);
}

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

  const { homeFs } = await resolveConnectionFs(conv.projectId);
  const cwd = await getTaskCwd(conv.projectId, conv.taskId);

  // Resolve the provider's native session id. Use the captured one when we have
  // it; otherwise fall back to discovering the freshest transcript file on disk
  // and persist what we found so future shares skip the search.
  let providerSessionId = conv.providerSessionId ?? null;
  if (!providerSessionId) {
    providerSessionId = await discoverProviderSessionId(provider, homeFs, cwd);
    if (!providerSessionId) {
      throw new Error(
        `No transcript found for this ${provider} session yet (cwd: ${cwd}). ` +
          `If the session was just started, give it a moment to write its first turn and try again.`
      );
    }
    await setProviderSessionId(conv.id, providerSessionId);
    log.info('shareSession: discovered providerSessionId via transcript scan', {
      conversationId: conv.id,
      providerSessionId,
    });
  }

  const bundle = await readRawTranscript(homeFs, provider, providerSessionId, cwd);
  bundle.meta.title = conv.title;

  const shareId = shareIdForConversation(conv.id);
  const result = await sessionShareStore.save({ shareId, bundle });

  log.info('shareSession: uploaded', { conversationId: conv.id, provider, ref: result.ref });
  return result;
}
