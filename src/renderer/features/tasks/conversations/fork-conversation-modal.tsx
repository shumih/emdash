import { observer } from 'mobx-react-lite';
import { useCallback, useRef, useState } from 'react';
import { OptionalValueSelect } from '@renderer/features/tasks/components/optional-value-select';
import { buildSubscriptionOptions } from '@renderer/features/tasks/components/subscription-selection';
import { useSubscriptionProfiles } from '@renderer/features/tasks/hooks/useSubscriptionProfiles';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';

type ForkConversationModalArgs = {
  taskId: string;
  conversationId: string;
  defaultTitle: string;
  provider: string;
};

type Props = BaseModalProps<{ conversationId: string }> & ForkConversationModalArgs;

export const ForkConversationModal = observer(function ForkConversationModal({
  taskId,
  conversationId,
  defaultTitle,
  provider,
  onSuccess,
  onClose,
}: Props) {
  const [name, setName] = useState(defaultTitle);
  // Defaults come from the source conversation: a fork starts as an exact
  // continuation, so it keeps the session's current model/effort unless the
  // user picks otherwise here.
  const sourceData = conversationRegistry.get(taskId)?.conversations.get(conversationId)?.data;
  const [model, setModel] = useState<string | null>(sourceData?.model ?? null);
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(
    sourceData?.reasoningEffort ?? null
  );
  const [subscriptionId, setSubscriptionId] = useState<string | null>(
    sourceData?.subscriptionId ?? null
  );
  const providerDef = getProvider(provider as AgentProviderId);
  const modelOptions = providerDef?.modelOptions ?? [];
  const effortOptions = providerDef?.reasoningEffortOptions ?? [];
  const { profiles } = useSubscriptionProfiles();
  const subscriptionOptions = providerDef?.subscriptionTokenEnvVar
    ? buildSubscriptionOptions(profiles, subscriptionId)
    : [];
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: isSubmitting is async React state, so two rapid Enter
  // presses can both read it as false and fork twice. The ref closes that gap.
  const submittingRef = useRef(false);

  const trimmed = name.trim();
  const isValid = trimmed.length > 0;

  const handleSubmit = useCallback(async () => {
    if (!isValid || submittingRef.current) return;
    const conversationMgr = conversationRegistry.get(taskId);
    if (!conversationMgr) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const forked = await conversationMgr.forkConversation(conversationId, trimmed, {
        model,
        reasoningEffort,
        subscriptionId,
      });
      onSuccess({ conversationId: forked.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fork session');
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [isValid, taskId, conversationId, trimmed, model, reasoningEffort, subscriptionId, onSuccess]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Fork session</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>Session name</FieldLabel>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                // Plain Enter submits here; Cmd/Ctrl+Enter is handled by ConfirmButton's
                // confirm hotkey, so excluding modifiers avoids a double submit.
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) void handleSubmit();
              }}
              autoFocus
            />
            {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
            {(modelOptions.length > 0 ||
              effortOptions.length > 0 ||
              subscriptionOptions.length > 0) && (
              <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-border px-1 py-0.5">
                {modelOptions.length > 0 && (
                  <OptionalValueSelect
                    label="Model"
                    value={model}
                    options={modelOptions}
                    onChange={setModel}
                  />
                )}
                {effortOptions.length > 0 && (
                  <OptionalValueSelect
                    label="Effort"
                    value={reasoningEffort}
                    options={effortOptions}
                    onChange={setReasoningEffort}
                  />
                )}
                {subscriptionOptions.length > 0 && (
                  <OptionalValueSelect
                    label="Account"
                    value={subscriptionId}
                    options={subscriptionOptions}
                    onChange={setSubscriptionId}
                  />
                )}
              </div>
            )}
            {provider === 'codex' && (
              <p className="mt-1 text-xs text-foreground-passive">
                Codex resumes the most recent session, so after forking, continuing the original
                conversation may resume this fork instead.
              </p>
            )}
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
          {isSubmitting ? 'Forking...' : 'Fork'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
