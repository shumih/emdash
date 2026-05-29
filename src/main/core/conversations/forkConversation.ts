import { randomUUID } from 'node:crypto';
import {
  getConversationRow,
  getTaskCwd,
  resolveConnectionFs,
} from '@main/core/shared-sessions/connection-fs';
import { log } from '@main/lib/logger';
import {
  isForkableProvider,
  type Conversation,
  type ForkConversationParams,
} from '@shared/conversations';
import { createConversation } from './createConversation';
import { rewriteClaudeSessionId } from './fork-transcript';
import { readRawTranscript, writeRawTranscript } from './transcript-io';

/**
 * Fork a conversation: copy its on-disk transcript to a fresh session id (same
 * task → same worktree/cwd, so the path lines up) and create a new conversation
 * that resumes the copy. The original is untouched, so both branches continue
 * independently. A local-only sibling of applySharedSession (no external store).
 */
export async function forkConversation(params: ForkConversationParams): Promise<Conversation> {
  const src = await getConversationRow(params.conversationId);

  if (!isForkableProvider(src.provider)) {
    throw new Error(`Fork not supported for provider: ${src.provider}`);
  }
  const provider = src.provider;

  // The transcript on disk is named by the real CLI session id once captured,
  // otherwise by the tondash conversation id (what we requested via --session-id).
  const sourceSessionId = src.providerSessionId ?? src.id;

  const { homeFs } = await resolveConnectionFs(src.projectId);
  const cwd = await getTaskCwd(src.projectId, src.taskId);

  const bundle = await readRawTranscript(homeFs, provider, sourceSessionId, cwd);
  const newSessionId = randomUUID();
  const forked = provider === 'claude' ? rewriteClaudeSessionId(bundle, newSessionId) : bundle;

  const dest = await writeRawTranscript(homeFs, provider, newSessionId, forked, cwd);
  log.info('forkConversation: wrote transcript', { dest, provider, newSessionId });

  return createConversation({
    id: randomUUID(),
    projectId: src.projectId,
    taskId: src.taskId,
    provider,
    title: params.title,
    providerSessionId: newSessionId,
    resume: true,
  });
}
