import { randomUUID } from 'node:crypto';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import type { SubscriptionProfile } from '@shared/app-settings';

const tokenSecretKey = (id: string) => `emdash-subscription-token-${id}`;

/**
 * Subscription (account) profiles for CLI agents: a named long-lived OAuth
 * token (`claude setup-token`) injected into a conversation's env so the
 * session runs under that account regardless of the machine's default login.
 * Metadata lives in app settings; tokens live encrypted in appSecrets and are
 * never sent to the renderer.
 */
export const subscriptionService = {
  async list(): Promise<SubscriptionProfile[]> {
    const { profiles } = await appSettingsService.get('subscriptionProfiles');
    return profiles;
  },

  async create(name: string, token: string): Promise<SubscriptionProfile> {
    const trimmedName = name.trim();
    const trimmedToken = token.trim();
    if (!trimmedName) throw new Error('Subscription name is required');
    if (!trimmedToken) throw new Error('Subscription token is required');

    const profile: SubscriptionProfile = { id: randomUUID(), name: trimmedName };
    // Token first: if secure storage is unavailable, no orphan metadata row.
    await encryptedAppSecretsStore.setSecret(tokenSecretKey(profile.id), trimmedToken);
    const { profiles } = await appSettingsService.get('subscriptionProfiles');
    await appSettingsService.update('subscriptionProfiles', {
      profiles: [...profiles, profile],
    });
    return profile;
  },

  async updateToken(id: string, token: string): Promise<void> {
    const trimmedToken = token.trim();
    if (!trimmedToken) throw new Error('Subscription token is required');
    const { profiles } = await appSettingsService.get('subscriptionProfiles');
    if (!profiles.some((p) => p.id === id)) throw new Error('Subscription profile not found');
    await encryptedAppSecretsStore.setSecret(tokenSecretKey(id), trimmedToken);
  },

  async delete(id: string): Promise<void> {
    const { profiles } = await appSettingsService.get('subscriptionProfiles');
    await appSettingsService.update('subscriptionProfiles', {
      profiles: profiles.filter((p) => p.id !== id),
    });
    await encryptedAppSecretsStore.deleteSecret(tokenSecretKey(id));
  },

  /**
   * Env to inject at agent spawn for a conversation pinned to a profile.
   * Returns undefined when the provider has no token env var, the profile is
   * gone, or the token can't be read — the session then falls back to the
   * machine's default login rather than failing to start.
   */
  async resolveEnv(
    subscriptionId: string | undefined,
    providerId: AgentProviderId
  ): Promise<Record<string, string> | undefined> {
    if (!subscriptionId) return undefined;
    const envVar = getProvider(providerId)?.subscriptionTokenEnvVar;
    if (!envVar) return undefined;
    try {
      const token = await encryptedAppSecretsStore.getSecret(tokenSecretKey(subscriptionId));
      if (!token) {
        log.warn('subscriptionService: no token for profile, using default login', {
          subscriptionId,
        });
        return undefined;
      }
      return { [envVar]: token };
    } catch (err) {
      log.warn('subscriptionService: failed to read token, using default login', {
        subscriptionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  },
};
