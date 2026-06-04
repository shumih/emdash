import { useEffect, useMemo, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { DialogContentArea, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import type { ShareProviderId, ShareSummary } from '@shared/shared-sessions';
import { shareCurrentSession } from './share-action';

type Props = BaseModalProps<void>;

const PROVIDER_LABELS: Record<ShareProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

export function SearchSessionsModal({ onClose }: Props) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<ShareSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void rpc.sharedSessions
      .search({ text: text || undefined, limit: 100 })
      .then((r) => {
        if (alive) setResults(r);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [text]);

  const body = useMemo(() => {
    if (loading) return <p className="text-sm text-foreground-muted">Searching…</p>;
    if (results.length === 0)
      return <p className="text-sm text-foreground-muted">No shareable sessions found.</p>;
    return (
      <ul className="flex flex-col gap-1">
        {results.map((s) => (
          <li
            key={s.conversationId}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-background-1"
          >
            <div className="min-w-0">
              <div className="truncate text-sm text-foreground">{s.title || 'Untitled'}</div>
              <div className="text-xs text-foreground-passive">
                {PROVIDER_LABELS[s.provider]}
                {s.host ? ' · remote' : ''}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              // ShareSummary fields are optional for on-disk sessions that
              // aren't tracked by any tondash conversation — share would fail
              // deep in the main process with a low-signal "conversation not
              // found". Gate the button until we have everything we need.
              disabled={!s.projectId || !s.taskId || !s.conversationId}
              onClick={() => {
                if (!s.projectId || !s.taskId || !s.conversationId) return;
                void shareCurrentSession({
                  projectId: s.projectId,
                  taskId: s.taskId,
                  conversationId: s.conversationId,
                  title: s.title,
                });
                // Close the picker — the toast carries the link.
                onClose();
              }}
            >
              Share
            </Button>
          </li>
        ))}
      </ul>
    );
  }, [loading, results, onClose]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share a session</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="grid gap-3 pt-0">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Filter by title…"
          autoFocus
        />
        <div className="max-h-80 overflow-y-auto">{body}</div>
      </DialogContentArea>
    </>
  );
}
