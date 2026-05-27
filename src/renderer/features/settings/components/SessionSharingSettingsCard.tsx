import React, { useCallback, useEffect, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

/**
 * Configures the external session-share storage: an enable toggle, the endpoint
 * base URL (a plain setting), and an auth token (kept in OS secure storage, set
 * via RPC — its value never round-trips back to the renderer).
 */
const SessionSharingSettingsCard: React.FC = () => {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('sessionSharing');

  const enabled = value?.enabled ?? false;
  const endpointUrl = value?.endpointUrl ?? '';
  const busy = isLoading || isSaving;

  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    let alive = true;
    void rpc.sharedSessions.hasToken().then((has) => {
      if (alive) setHasToken(has);
    });
    return () => {
      alive = false;
    };
  }, []);

  const saveToken = useCallback(async (token: string) => {
    await rpc.sharedSessions.setToken(token);
    setHasToken(Boolean(token.trim()));
  }, []);

  return (
    <div className="grid gap-8">
      <SettingRow
        title="Enable session sharing"
        description="Share agent sessions to an external storage service and apply shared sessions locally."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
            disabled={busy}
            aria-label="Enable session sharing"
          />
        }
      />
      {enabled && (
        <>
          <div className="grid gap-2">
            <Input
              key={endpointUrl}
              defaultValue={endpointUrl}
              onBlur={(e) => {
                const next = e.currentTarget.value.trim();
                if (next !== endpointUrl) update({ endpointUrl: next });
              }}
              placeholder="https://your-share-service.example.com"
              aria-label="Storage endpoint URL"
              disabled={busy}
            />
            <div className="text-xs text-foreground-passive">
              Base URL of the storage service. It performs any format conversion between Claude
              Code, Codex, and Cursor.
            </div>
          </div>
          <div className="grid gap-2">
            <Input
              type="password"
              defaultValue=""
              placeholder={hasToken ? '•••••••• (saved)' : 'Auth token (optional)'}
              aria-label="Storage auth token"
              disabled={busy}
              onBlur={(e) => {
                void saveToken(e.currentTarget.value);
                e.currentTarget.value = '';
              }}
            />
            <div className="text-xs text-foreground-passive">
              Sent as a Bearer token. Stored in your OS keychain, never in plaintext settings.
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SessionSharingSettingsCard;
