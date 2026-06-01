import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState } from 'react';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import { getTaskStore, taskDisplayName } from '@renderer/features/tasks/stores/task-selectors';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { nextIndexedConversationTitle } from './conversation-title-utils';
import { useEffectiveProvider } from './use-effective-provider';

export const CreateConversationModal = observer(function CreateConversationModal({
  onSuccess,
  projectId,
  taskId,
}: BaseModalProps<{ conversationId: string }> & {
  projectId: string;
  taskId: string;
}) {
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId, setProviderOverride, createDisabled } = useEffectiveProvider(connectionId);
  const conversationMgr = conversationRegistry.get(taskId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const taskName = taskDisplayName(getTaskStore(projectId, taskId)) ?? '';
  const [nameInput, setNameInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipPermissions = providerId ? autoApproveDefaults.getDefault(providerId) : false;
  const title = nameInput.trim();
  const existingTitles = useMemo(
    () =>
      Array.from(conversationMgr?.conversations.values() ?? [], (conversation) => ({
        providerId: conversation.data.providerId,
        title: conversation.data.title,
      })),
    [conversationMgr]
  );
  const placeholderTitle = nextIndexedConversationTitle(taskName, existingTitles);

  const handleCreateConversation = useCallback(async () => {
    if (createDisabled || isSubmitting || !conversationMgr || !providerId || !title) return;
    const id = crypto.randomUUID();
    setIsSubmitting(true);
    setError(null);
    try {
      await conversationMgr.createConversation({
        projectId,
        taskId,
        id,
        autoApprove: skipPermissions,
        provider: providerId,
        title,
      });
      onSuccess({ conversationId: id });
    } catch {
      setError('Failed to create conversation');
      setIsSubmitting(false);
    }
  }, [
    conversationMgr,
    createDisabled,
    isSubmitting,
    providerId,
    title,
    onSuccess,
    projectId,
    taskId,
    skipPermissions,
  ]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create Conversation</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <FieldGroup>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={placeholderTitle}
              onFocus={(e) => e.currentTarget.select()}
            />
            {title && <p className="text-xs text-foreground-passive">Session name: {title}</p>}
          </Field>
          <Field>
            <FieldLabel>Agent</FieldLabel>
            <AgentSelector
              value={providerId}
              onChange={setProviderOverride}
              connectionId={connectionId}
            />
          </Field>
          <Field>
            <div className="flex items-center gap-2">
              <Switch
                checked={skipPermissions}
                disabled={!providerId || autoApproveDefaults.loading || autoApproveDefaults.saving}
                onCheckedChange={(checked) => {
                  if (providerId) autoApproveDefaults.setDefault(providerId, checked);
                }}
              />
              <FieldLabel>Auto-approve permissions</FieldLabel>
            </div>
          </Field>
          {error && <p className="text-destructive text-xs">{error}</p>}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton
          onClick={() => void handleCreateConversation()}
          disabled={createDisabled || isSubmitting || !title}
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
