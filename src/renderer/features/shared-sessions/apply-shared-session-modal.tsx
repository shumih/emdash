import { useCallback, useState } from 'react';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { SHARE_PROVIDERS, type ShareProviderId } from '@shared/shared-sessions';
import { extractShareRef } from './share-ref';

type ApplySharedSessionModalArgs = {
  projectId: string;
  taskId: string;
  /** Pre-fill the target provider (defaults to claude, the most reliable target). */
  defaultProvider?: ShareProviderId;
};

type Props = BaseModalProps<void> & ApplySharedSessionModalArgs;

const PROVIDER_LABELS: Record<ShareProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

export function ApplySharedSessionModal({
  projectId,
  taskId,
  defaultProvider = 'claude',
  onSuccess,
  onClose,
}: Props) {
  const [ref, setRef] = useState('');
  const [targetProvider, setTargetProvider] = useState<ShareProviderId>(defaultProvider);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedRef = ref.trim();
  const canApply = trimmedRef.length > 0 && !isApplying;

  const handleApply = useCallback(async () => {
    if (!trimmedRef) return;
    setIsApplying(true);
    setError(null);
    try {
      // Accept either a bare ref or a full URL whose last path segment is the ref.
      const parsedRef = extractShareRef(trimmedRef);
      // Going through the conversation manager registers the new conv in the
      // renderer's store so it shows up in the task view without a reload.
      const manager = conversationRegistry.get(taskId);
      if (!manager) {
        setError('Open the task first, then try again.');
        setIsApplying(false);
        return;
      }
      await manager.applySharedSession({
        ref: parsedRef,
        projectId,
        taskId,
        targetProvider,
      });
      toast.success('Shared session added');
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply shared session');
      setIsApplying(false);
    }
  }, [trimmedRef, projectId, taskId, targetProvider, onSuccess]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Add shared session</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>Share link or ref</FieldLabel>
            <Input
              value={ref}
              onChange={(e) => {
                setRef(e.target.value);
                setError(null);
              }}
              placeholder="https://… or a share id"
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>Open as</FieldLabel>
            <Select
              value={targetProvider}
              onValueChange={(v) => setTargetProvider(v as ShareProviderId)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHARE_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {error && <p className="text-destructive text-xs">{error}</p>}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleApply()} disabled={!canApply}>
          {isApplying ? 'Adding…' : 'Add session'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
