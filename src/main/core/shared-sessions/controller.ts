import { createRPCController } from '@/shared/ipc/rpc';
import type { Conversation } from '@shared/conversations';
import type {
  ApplySharedSessionParams,
  SaveResult,
  SearchSessionsQuery,
  ShareSessionParams,
  ShareSummary,
} from '@shared/shared-sessions';
import { applySharedSession } from './apply-shared-session';
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
});
