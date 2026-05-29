import { observer } from 'mobx-react-lite';
import { useCallback, useRef, useState } from 'react';
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
      const forked = await conversationMgr.forkConversation(conversationId, trimmed);
      onSuccess({ conversationId: forked.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fork session');
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [isValid, taskId, conversationId, trimmed, onSuccess]);

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
