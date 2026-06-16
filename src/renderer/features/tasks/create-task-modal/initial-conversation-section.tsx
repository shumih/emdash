import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { OptionalValueSelect } from '@renderer/features/tasks/components/optional-value-select';
import {
  buildSubscriptionOptions,
  resolveDefaultSubscriptionId,
} from '@renderer/features/tasks/components/subscription-selection';
import {
  buildContextActionText,
  buildTaskContextActions,
  type ContextAction,
} from '@renderer/features/tasks/conversations/context-actions';
import { resolveContextActionText } from '@renderer/features/tasks/conversations/resolve-context-action-text';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { useSubscriptionProfiles } from '@renderer/features/tasks/hooks/useSubscriptionProfiles';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import type { Issue } from '@shared/tasks';
import {
  appendInitialConversationText,
  upsertInitialIssueContext,
} from './initial-conversation-text';
import { ModalContextBar } from './modal-context-bar';

export type InitialConversationState = {
  provider: AgentProviderId | null;
  setProvider: (provider: AgentProviderId | null) => void;
  prompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  /** Provider-specific model value for the CLI; null = provider default. */
  model: string | null;
  setModel: (model: string | null) => void;
  /** Provider-specific reasoning effort value; null = provider default. */
  reasoningEffort: string | null;
  setReasoningEffort: (effort: string | null) => void;
  /** Subscription (account) profile id; null = default login. */
  subscriptionId: string | null;
  setSubscriptionId: (id: string | null) => void;
  connectionId?: string;
};

export function useInitialConversationState(
  projectId?: string,
  /** Project's default account; `undefined` = settings not loaded yet. */
  projectDefaultSubscriptionId?: string | null
): InitialConversationState {
  const connectionId = projectId ? getProjectSshConnectionId(projectId) : undefined;
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(null);
  // `undefined` = follow the project's default account; `string | null` = the
  // user's explicit choice (null = machine default login). The shown value is
  // derived from (override, projectDefault), so a late-loading project default
  // never clobbers a manual selection.
  const [subscriptionOverride, setSubscriptionOverride] = useState<string | null | undefined>(
    undefined
  );
  return {
    provider: providerId,
    // Switching the agent resets provider-specific values: account falls back to
    // the project default (undefined), model/effort to the provider default (null).
    setProvider: (provider) => {
      setProviderOverride(provider);
      setModel(null);
      setReasoningEffort(null);
      setSubscriptionOverride(undefined);
    },
    prompt,
    setPrompt,
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    subscriptionId: resolveDefaultSubscriptionId(
      subscriptionOverride,
      projectDefaultSubscriptionId
    ),
    setSubscriptionId: setSubscriptionOverride,
    connectionId,
  };
}

interface InitialConversationFieldProps {
  state: InitialConversationState;
  linkedIssue?: Issue;
  projectId?: string;
  issueActionPending?: boolean;
}

export function InitialConversationField({
  state,
  linkedIssue,
  projectId,
  issueActionPending = false,
}: InitialConversationFieldProps) {
  const { value: promptLibrary } = usePromptLibrary();
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const contextActions = useMemo(
    () => buildTaskContextActions(linkedIssue, [], promptLibrary),
    [linkedIssue, promptLibrary]
  );

  const providerDef = state.provider ? getProvider(state.provider) : undefined;
  const modelOptions = providerDef?.modelOptions ?? [];
  const effortOptions = providerDef?.reasoningEffortOptions ?? [];
  const { profiles } = useSubscriptionProfiles();
  const subscriptionOptions = providerDef?.subscriptionTokenEnvVar
    ? buildSubscriptionOptions(profiles, state.subscriptionId)
    : [];

  const handleActionClick = async (action: ContextAction) => {
    const text =
      action.kind === 'linked-issue'
        ? await resolveContextActionText({ action, linkedIssue, projectId })
        : buildContextActionText(action);

    state.setPrompt((current) =>
      action.kind === 'linked-issue'
        ? upsertInitialIssueContext(current, text)
        : appendInitialConversationText(current, text)
    );
  };

  return (
    <>
      <Field>
        <FieldLabel>Initial conversation</FieldLabel>
        <div className="flex flex-col rounded-md border border-border">
          <AgentSelector
            value={state.provider}
            onChange={(provider) => state.setProvider(provider)}
            connectionId={state.connectionId}
            className="rounded-none border-0 border-b"
          />
          {(modelOptions.length > 0 ||
            effortOptions.length > 0 ||
            subscriptionOptions.length > 0) && (
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-1 py-0.5">
              {modelOptions.length > 0 && (
                <OptionalValueSelect
                  label="Model"
                  value={state.model}
                  options={modelOptions}
                  onChange={state.setModel}
                />
              )}
              {effortOptions.length > 0 && (
                <OptionalValueSelect
                  label="Effort"
                  value={state.reasoningEffort}
                  options={effortOptions}
                  onChange={state.setReasoningEffort}
                />
              )}
              {subscriptionOptions.length > 0 && (
                <OptionalValueSelect
                  label="Account"
                  value={state.subscriptionId}
                  options={subscriptionOptions}
                  onChange={state.setSubscriptionId}
                />
              )}
            </div>
          )}
          <Textarea
            placeholder="Start with a prompt... (optional)"
            value={state.prompt}
            onChange={(e) => state.setPrompt(e.target.value)}
            className="max-h-64 min-h-24 resize-none rounded-none border-0 focus-visible:border-0 focus-visible:ring-0"
          />
          <ModalContextBar
            actions={contextActions}
            onActionClick={(action) => void handleActionClick(action)}
            issueActionPending={issueActionPending}
          />
        </div>
      </Field>
      <Field>
        <div className="flex items-center gap-2">
          <Switch
            checked={state.provider ? autoApproveDefaults.getDefault(state.provider) : false}
            disabled={!state.provider || autoApproveDefaults.loading || autoApproveDefaults.saving}
            onCheckedChange={(checked) => {
              if (state.provider) autoApproveDefaults.setDefault(state.provider, checked);
            }}
          />
          <FieldLabel>Auto-approve permissions</FieldLabel>
        </div>
      </Field>
    </>
  );
}
