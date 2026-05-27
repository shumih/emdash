import { createRPCController } from '@/shared/ipc/rpc';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import type { Conversation } from '@shared/conversations';
import type {
  ApplySharedSessionParams,
  SaveResult,
  SearchSessionsQuery,
  ShareSessionParams,
  ShareSummary,
} from '@shared/shared-sessions';
import { applySharedSession } from './apply-shared-session';
import { SESSION_SHARING_TOKEN_KEY } from './http-store';
import { searchSessions } from './search';
import { shareSession } from './share-session';

export const sharedSessionsController = createRPCController({
  /** Find shareable sessions across all projects and connections. */
  search: (query: SearchSessionsQuery): Promise<ShareSummary[]> => searchSessions(query),

  /** Read a conversation's transcript and upload it; returns a shareable ref/url. */
  share: (params: ShareSessionParams): Promise<SaveResult> => shareSession(params),

  /** Fetch a shared session (converted to target provider) and create a local conversation. */
  applySharedSession: (params: ApplySharedSessionParams): Promise<Conversation> =>
    applySharedSession(params),

  /** Store (or clear, when passed an empty string) the storage auth token. */
  setToken: async (token: string): Promise<void> => {
    const trimmed = token.trim();
    if (trimmed) {
      await encryptedAppSecretsStore.setSecret(SESSION_SHARING_TOKEN_KEY, trimmed);
    } else {
      await encryptedAppSecretsStore.deleteSecret(SESSION_SHARING_TOKEN_KEY);
    }
  },

  /** Whether an auth token is currently stored (value never leaves the main process). */
  hasToken: async (): Promise<boolean> => {
    const token = await encryptedAppSecretsStore.getSecret(SESSION_SHARING_TOKEN_KEY);
    return Boolean(token);
  },
});
