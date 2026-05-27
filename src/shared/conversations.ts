import type { AgentProviderId } from '@shared/agent-provider-registry';

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
};

export type RenameConversationParams = {
  conversationId: string;
  newTitle: string;
};

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
};
