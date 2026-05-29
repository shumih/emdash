import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
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
};

type Props = BaseModalProps<{ conversationId: string }> & ForkConversationModalArgs;

export const ForkConversationModal = observer(function ForkConversationModal({
  taskId,
  conversationId,
  defaultTitle,
  onSuccess,
  onClose,
}: Props) {
  const [name, setName] = useState(defaultTitle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const isValid = trimmed.length > 0;

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;
    const conversationMgr = conversationRegistry.get(taskId);
    if (!conversationMgr) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const forked = await conversationMgr.forkConversation(conversationId, trimmed);
      onSuccess({ conversationId: forked.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fork session');
      setIsSubmitting(false);
    }
  }, [isValid, isSubmitting, taskId, conversationId, trimmed, onSuccess]);

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
