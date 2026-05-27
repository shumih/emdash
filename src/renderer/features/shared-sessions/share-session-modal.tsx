import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';

type ShareSessionModalArgs = {
  projectId: string;
  taskId: string;
  conversationId: string;
  title?: string;
};

type Props = BaseModalProps<void> & ShareSessionModalArgs;

export function ShareSessionModal({ projectId, taskId, conversationId, title, onClose }: Props) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const handleShare = useCallback(async () => {
    setIsSharing(true);
    setError(null);
    try {
      const result = await rpc.sharedSessions.share({ projectId, taskId, conversationId });
      const link = result.url ?? result.ref;
      setShareUrl(link);
      try {
        await rpc.app.clipboardWriteText(link);
        toast.success('Share link copied to clipboard');
      } catch {
        toast.success('Session shared');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to share session');
    } finally {
      setIsSharing(false);
    }
  }, [projectId, taskId, conversationId]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Share session{title ? `: ${title}` : ''}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        {shareUrl ? (
          <div className="grid gap-2">
            <p className="text-sm text-foreground-muted">Share link:</p>
            <Input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              onClick={() => {
                void rpc.app.clipboardWriteText(shareUrl);
                toast.success('Copied');
              }}
            >
              Copy link
            </Button>
          </div>
        ) : (
          <p className="text-sm text-foreground-muted">
            This uploads the full transcript of this session to your configured storage service,
            which converts it between providers. The transcript may contain source code and secrets
            — only share to a service you trust.
          </p>
        )}
        {error && <p className="text-destructive mt-2 text-xs">{error}</p>}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {shareUrl ? 'Done' : 'Cancel'}
        </Button>
        {!shareUrl && (
          <ConfirmButton onClick={() => void handleShare()} disabled={isSharing}>
            {isSharing ? 'Sharing…' : 'Share session'}
          </ConfirmButton>
        )}
      </DialogFooter>
    </>
  );
}
