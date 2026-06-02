import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

/**
 * Configures the external session-share storage: an enable toggle and the
 * endpoint base URL. The service is unauthenticated; no token is required.
 */
const SessionSharingSettingsCard: React.FC = () => {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('sessionSharing');

  const enabled = value?.enabled ?? false;
  const endpointUrl = value?.endpointUrl ?? '';
  const busy = isLoading || isSaving;

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
            Base URL of the storage service. It performs any format conversion between Claude Code,
            Codex, and Cursor.
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionSharingSettingsCard;
