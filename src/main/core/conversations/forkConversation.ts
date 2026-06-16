import { randomUUID } from 'node:crypto';
import {
  getConversationRow,
  getTaskCwd,
  resolveConnectionFs,
} from '@main/core/shared-sessions/connection-fs';
import { log } from '@main/lib/logger';
import { traceUserAction } from '@main/lib/user-action-trace';
import {
  isForkableProvider,
  type Conversation,
  type ForkConversationParams,
} from '@shared/conversations';
import { createConversation } from './createConversation';
import { rewriteClaudeSessionId } from './fork-transcript';
import { readRawTranscript, writeRawTranscript } from './transcript-io';
import { parseConversationConfig } from './utils';

const FORK_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

/**
 * Fork a conversation: copy its on-disk transcript to a fresh session id (same
 * task → same worktree/cwd, so the path lines up) and create a new conversation
 * that resumes the copy. The original is untouched, so both branches continue
 * independently. A local-only sibling of applySharedSession (no external store).
 */
export async function forkConversation(params: ForkConversationParams): Promise<Conversation> {
  const span = traceUserAction('main:fork-conversation', {
    sourceConversationId: params.conversationId,
  });
  try {
    const src = await getConversationRow(params.conversationId);
    span.step('load-conversation-row');

    if (!isForkableProvider(src.provider)) {
      const msg = `Fork not supported for provider: ${src.provider}`;
      span.end({ status: 'error', failed_step: 'provider-check', error: msg });
      throw new Error(msg);
    }
    const provider = src.provider;
    const sourceSessionId = src.providerSessionId ?? src.id;

    const { autoApprove, ...srcConfig } = parseConversationConfig(src.config);
    const model = params.model === undefined ? srcConfig.model : (params.model ?? undefined);
    const reasoningEffort =
      params.reasoningEffort === undefined
        ? srcConfig.reasoningEffort
        : (params.reasoningEffort ?? undefined);
    const subscriptionId =
      params.subscriptionId === undefined
        ? srcConfig.subscriptionId
        : (params.subscriptionId ?? undefined);

    const { homeFs } = await withTimeout(
      resolveConnectionFs(src.projectId),
      FORK_TIMEOUT_MS,
      'fork: resolveConnectionFs'
    );
    span.step('resolve-connection-fs');

    const cwd = await withTimeout(
      getTaskCwd(src.projectId, src.taskId),
      FORK_TIMEOUT_MS,
      'fork: getTaskCwd'
    );
    span.step('get-task-cwd');

    const bundle = await withTimeout(
      readRawTranscript(homeFs, provider, sourceSessionId, cwd),
      FORK_TIMEOUT_MS,
      'fork: readRawTranscript'
    );
    span.step('read-raw-transcript', { bytes: bundle.files[0]?.base64.length ?? 0 });

    const newSessionId = randomUUID();
    const forked = provider === 'claude' ? rewriteClaudeSessionId(bundle, newSessionId) : bundle;
    span.step('rewrite-session-id');

    const dest = await withTimeout(
      writeRawTranscript(homeFs, provider, newSessionId, forked, cwd),
      FORK_TIMEOUT_MS,
      'fork: writeRawTranscript'
    );
    span.step('write-raw-transcript');
    log.info('forkConversation: wrote transcript', { dest, provider, newSessionId });

    const conversation = await withTimeout(
      createConversation({
        id: randomUUID(),
        projectId: src.projectId,
        taskId: src.taskId,
        provider,
        title: params.title,
        providerSessionId: newSessionId,
        autoApprove,
        model,
        reasoningEffort,
        subscriptionId,
        resume: true,
      }),
      FORK_TIMEOUT_MS,
      'fork: createConversation'
    );
    span.step('create-conversation');
    span.end({ status: 'ok', provider });
    return conversation;
  } catch (e) {
    span.end({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
