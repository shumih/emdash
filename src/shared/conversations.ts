import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';

export type Conversation = {
  id: string;
  projectId: string;
  taskId: string;
  providerId: AgentProviderId;
  title: string;
  lastInteractedAt: string | null;
  resume?: boolean;
  autoApprove?: boolean;
  isInitialConversation: boolean | null;
  /**
   * The real session id chosen by the agent CLI (e.g. Claude Code), captured at
   * runtime. Used for --resume instead of the tondash-minted conversation id,
   * which the CLI does not reliably persist under. Null until first captured.
   */
  providerSessionId?: string | null;
  /** When imported from a shared session, the opaque store ref it came from. */
  sourceShareId?: string | null;
  /** Target provider chosen when the shared session was applied. */
  sourceTargetProvider?: string | null;
};

export type RenameConversationParams = {
  conversationId: string;
  newTitle: string;
};

export type ForkConversationParams = {
  conversationId: string;
  title: string;
};

/**
 * Providers a session can be forked for: their transcript is a single text file
 * we can copy under a new id. Claude is full-fidelity (resume by id); Codex is
 * best-effort (copy becomes newest for `resume --last`). Cursor (binary SQLite)
 * is excluded.
 */
export function isForkableProvider(
  providerId: string | null | undefined
): providerId is 'claude' | 'codex' {
  return providerId === 'claude' || providerId === 'codex';
}

export type CreateConversationParams = {
  id: string;
  projectId: string;
  taskId: string;
  provider: AgentProviderId;
  title: string;
  autoApprove?: boolean;
  isInitialConversation?: boolean;
  initialSize?: { cols: number; rows: number };
  initialPrompt?: string;
  /**
   * Pre-seed the real CLI session id (e.g. when applying a shared session whose
   * transcript was written to disk under a deterministic id). When set together
   * with `resume: true`, the spawned CLI resumes that transcript.
   */
  providerSessionId?: string;
  /** Spawn the agent in resume mode rather than starting a fresh session. */
  resume?: boolean;
  /** Provenance for an applied shared session (idempotency key components). */
  sourceShareId?: string;
  sourceTargetProvider?: string;
};

/**
 * Detect whether a conversation title is the auto-generated default for the
 * provider — i.e. exactly the provider name (`Claude Code`) or the indexed
 * form for disambiguation (`Claude Code-2`). The bare default carries no
 * information beyond "this is the provider", so we drop it from the CLI
 * session name; the indexed form keeps just its number so the CLI sees
 * `task-2` instead of `task-Claude Code-2`.
 */
function classifyDefaultTitle(
  title: string,
  providerName: string
): { isDefault: boolean; suffix?: string } {
  if (title === providerName) return { isDefault: true };
  if (title.startsWith(`${providerName}-`)) {
    const tail = title.slice(providerName.length + 1);
    if (/^[1-9]\d*$/.test(tail)) return { isDefault: true, suffix: tail };
  }
  return { isDefault: false };
}

export function buildProviderSessionName({
  taskName,
  conversationTitle,
  providerId,
}: {
  taskName: string;
  conversationTitle?: string | null;
  providerId?: AgentProviderId;
}): string {
  const task = taskName.trim();
  const title = conversationTitle?.trim() ?? '';

  if (!task) return title;
  if (!title) return task;

  if (providerId) {
    const providerName = getProvider(providerId)?.name;
    if (providerName) {
      const { isDefault, suffix } = classifyDefaultTitle(title, providerName);
      if (isDefault) return suffix ? `${task}-${suffix}` : task;
    }
  }

  return `${task}-${title}`;
}
