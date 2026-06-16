import { KeyRound, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  useInvalidateSubscriptionProfiles,
  useSubscriptionProfiles,
} from '@renderer/features/tasks/hooks/useSubscriptionProfiles';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';

/**
 * Subscription (account) profiles for CLI agents. A profile is a name plus a
 * long-lived OAuth token (`claude setup-token`); pick it in the Account
 * selector when creating or forking a conversation to run that session under
 * a different subscription. Tokens are stored encrypted and never displayed.
 */
export function SubscriptionsSettingsCard() {
  const { profiles } = useSubscriptionProfiles();
  const invalidate = useInvalidateSubscriptionProfiles();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [updatingTokenId, setUpdatingTokenId] = useState<string | null>(null);
  const [replacementToken, setReplacementToken] = useState('');

  const canAdd = name.trim().length > 0 && token.trim().length > 0 && !isSaving;

  const handleAdd = useCallback(async () => {
    setIsSaving(true);
    try {
      await rpc.subscriptions.create(name, token);
      setName('');
      setToken('');
      invalidate();
    } catch (e) {
      toast.error('Could not add subscription', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsSaving(false);
    }
  }, [name, token, invalidate]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await rpc.subscriptions.delete(id);
        invalidate();
      } catch (e) {
        toast.error('Could not delete subscription', {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [invalidate]
  );

  const handleUpdateToken = useCallback(async () => {
    if (!updatingTokenId || !replacementToken.trim()) return;
    try {
      await rpc.subscriptions.updateToken(updatingTokenId, replacementToken);
      setUpdatingTokenId(null);
      setReplacementToken('');
    } catch (e) {
      toast.error('Could not update token', {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [updatingTokenId, replacementToken]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground-muted">
        Named account tokens for CLI agents. Get a token with{' '}
        <code className="rounded bg-background-2 px-1 py-0.5 text-xs">claude setup-token</code> and
        pick the account when creating a task or forking a session. Works for SSH projects too — the
        token travels with the session.
      </p>

      {profiles.length > 0 && (
        <div className="flex flex-col gap-1">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <KeyRound className="size-3.5 shrink-0 text-foreground-muted" />
              <span className="flex-1 truncate text-sm">{profile.name}</span>
              {updatingTokenId === profile.id ? (
                <>
                  <Input
                    type="password"
                    value={replacementToken}
                    onChange={(e) => setReplacementToken(e.target.value)}
                    placeholder="New token"
                    className="h-7 w-56 text-xs"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!replacementToken.trim()}
                    onClick={() => void handleUpdateToken()}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setUpdatingTokenId(null);
                      setReplacementToken('');
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-foreground-muted"
                    onClick={() => setUpdatingTokenId(profile.id)}
                  >
                    Replace token
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${profile.name}`}
                    onClick={() => void handleDelete(profile.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. tony1)"
          className="h-8 w-44"
        />
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token from `claude setup-token`"
          className="h-8 flex-1"
        />
        <Button size="sm" disabled={!canAdd} onClick={() => void handleAdd()}>
          {isSaving ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </div>
  );
}
