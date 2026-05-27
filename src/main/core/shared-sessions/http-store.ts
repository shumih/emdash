import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { appSettingsService } from '@main/core/settings/settings-service';
import type {
  RawBundle,
  SaveResult,
  SessionShareStore,
  ShareProviderId,
  ShareRef,
} from '@shared/shared-sessions';

/** Secret-storage key for the storage service auth token. */
export const SESSION_SHARING_TOKEN_KEY = 'sessionSharing.token';

export class SessionSharingDisabledError extends Error {
  constructor(
    message = 'Session sharing is disabled or not configured. Enable it and set an endpoint URL in Settings → Integrations.'
  ) {
    super(message);
    this.name = 'SessionSharingDisabledError';
  }
}

/**
 * App-side HTTP client implementing the SessionShareStore contract. The actual
 * storage + format conversion live behind the configured endpoint; this client
 * only ships raw bytes and a source tag, and fetches converted bytes back.
 *
 *   POST {base}/sessions          { shareId, bundle }     -> { ref, url? }
 *   GET  {base}/sessions/{ref}?target=<provider>          -> RawBundle | 404
 */
export class HttpSessionShareStore implements SessionShareStore {
  constructor(
    private readonly resolveConfig: () => Promise<{
      enabled: boolean;
      baseUrl: string;
      token: string | null;
    }>
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const { token } = await this.resolveConfig();
    return {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  /**
   * Resolve the base URL, enforcing the `enabled` kill switch and a configured
   * endpoint. This gates every network egress (save uploads transcripts; get
   * downloads them), so a disabled toggle truly stops data leaving the machine.
   */
  private async base(): Promise<string> {
    const { enabled, baseUrl } = await this.resolveConfig();
    if (!enabled || !baseUrl) throw new SessionSharingDisabledError();
    return baseUrl.replace(/\/+$/, '');
  }

  async save(input: { shareId: string; bundle: RawBundle }): Promise<SaveResult> {
    const res = await fetch(`${await this.base()}/sessions`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(`Share upload failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as SaveResult;
    if (!data?.ref) throw new Error('Share upload returned no ref');
    return data;
  }

  async get(ref: ShareRef, opts: { targetProvider: ShareProviderId }): Promise<RawBundle | null> {
    const url = `${await this.base()}/sessions/${encodeURIComponent(ref)}?target=${opts.targetProvider}`;
    const res = await fetch(url, { headers: await this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Share fetch failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as RawBundle;
  }
}

/**
 * The default store wired to app settings (endpoint URL) + secure storage
 * (auth token). Reads config lazily on each call so changes take effect without
 * a restart.
 */
export const sessionShareStore = new HttpSessionShareStore(async () => {
  const settings = await appSettingsService.get('sessionSharing');
  const token = await encryptedAppSecretsStore.getSecret(SESSION_SHARING_TOKEN_KEY);
  return { enabled: settings.enabled, baseUrl: settings.endpointUrl, token };
});
