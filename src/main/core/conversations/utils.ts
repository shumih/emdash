import { type ConversationRow } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { type Conversation } from '@shared/conversations';

export type ConversationConfig = {
  autoApprove?: boolean;
};

export function parseConversationConfig(raw: string | null): ConversationConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const autoApprove = (parsed as { autoApprove?: unknown }).autoApprove;
    return typeof autoApprove === 'boolean' ? { autoApprove } : {};
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
  return {
    id: row.id,
    title: row.title,
    taskId: row.taskId,
    projectId: row.projectId,
    providerId: row.provider as AgentProviderId,
    autoApprove: parseConversationConfig(row.config).autoApprove,
    resume: resume,
    lastInteractedAt: row.lastInteractedAt ?? null,
    isInitialConversation: row.isInitialConversation,
    providerSessionId: row.providerSessionId ?? null,
    sourceShareId: row.sourceShareId ?? null,
    sourceTargetProvider: row.sourceTargetProvider ?? null,
  };
}
