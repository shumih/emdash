import { type ConversationRow } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { type Conversation } from '@shared/conversations';

export type ConversationConfig = {
  autoApprove?: boolean;
  model?: string;
  reasoningEffort?: string;
  subscriptionId?: string;
};

export function parseConversationConfig(raw: string | null): ConversationConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const { autoApprove, model, reasoningEffort, subscriptionId } = parsed as Record<
      string,
      unknown
    >;
    return {
      ...(typeof autoApprove === 'boolean' ? { autoApprove } : {}),
      ...(typeof model === 'string' && model ? { model } : {}),
      ...(typeof reasoningEffort === 'string' && reasoningEffort ? { reasoningEffort } : {}),
      ...(typeof subscriptionId === 'string' && subscriptionId ? { subscriptionId } : {}),
    };
  } catch (err) {
    log.warn('parseConversationConfig: malformed config JSON', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

export function mapConversationRowToConversation(
  row: ConversationRow,
  resume: boolean = false
): Conversation {
  const config = parseConversationConfig(row.config);
  return {
    id: row.id,
    title: row.title,
    taskId: row.taskId,
    projectId: row.projectId,
    providerId: row.provider as AgentProviderId,
    autoApprove: config.autoApprove,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    subscriptionId: config.subscriptionId,
    resume: resume,
    lastInteractedAt: row.lastInteractedAt ?? null,
    isInitialConversation: row.isInitialConversation,
    providerSessionId: row.providerSessionId ?? null,
    sourceShareId: row.sourceShareId ?? null,
    sourceTargetProvider: row.sourceTargetProvider ?? null,
  };
}
