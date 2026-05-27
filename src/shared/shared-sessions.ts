/**
 * Shared "Share Session" contract.
 *
 * The app does NOT store or convert transcripts. A session is shared by sending
 * its RAW on-disk transcript bytes plus a source-provider tag to an external
 * storage service, which performs any Claude↔Codex↔Cursor format conversion on
 * its side. On apply, the app requests the bytes back for a chosen target
 * provider and writes them into that provider's session directory.
 *
 * This module defines the wire types and the storage interface the app calls;
 * the storage itself is implemented externally (see HttpSessionShareStore for
 * the app-side HTTP client that talks to it).
 */

/** The three providers we can share between. */
export type ShareProviderId = 'claude' | 'codex' | 'cursor';

export const SHARE_PROVIDERS: readonly ShareProviderId[] = ['claude', 'codex', 'cursor'] as const;

export function isShareProvider(id: string): id is ShareProviderId {
  return (SHARE_PROVIDERS as readonly string[]).includes(id);
}

/** One transcript file, base64-encoded so binary payloads (Cursor's SQLite
 * `store.db`) survive the round trip unharmed. */
export interface RawFile {
  /** Basename within the provider's session dir (informational on apply). */
  relName: string;
  /** File contents, base64-encoded. */
  base64: string;
}

/** The raw transcript of a single session, tagged with its provider. */
export interface RawBundle {
  provider: ShareProviderId;
  files: RawFile[];
  meta: {
    /** The provider's native session id this transcript came from. */
    sourceSessionId: string;
    /** Working directory the session ran in (used to locate Claude transcripts). */
    cwd?: string;
    title?: string;
    model?: string;
  };
}

/** Opaque reference to a stored share, returned by save() and consumed by get(). */
export type ShareRef = string;

export interface SaveResult {
  ref: ShareRef;
  /** Optional human-shareable URL (copied to clipboard by the UI). */
  url?: string;
}

/**
 * Storage contract. Implemented externally (the app ships an HTTP client).
 *
 * Idempotency requirement: save() is keyed by `shareId`. Saving the same
 * shareId again MUST return the same ref and replace the content rather than
 * creating a duplicate.
 */
export interface SessionShareStore {
  save(input: { shareId: string; bundle: RawBundle }): Promise<SaveResult>;
  /** Returns the transcript converted to `targetProvider`, or null if missing. */
  get(ref: ShareRef, opts: { targetProvider: ShareProviderId }): Promise<RawBundle | null>;
}

// ─── RPC param/return types (app-internal) ──────────────────────────────────

/** A locally-discovered session that can be shared. */
export interface ShareSummary {
  provider: ShareProviderId;
  /** Provider-native session id (e.g. Claude transcript basename). */
  providerSessionId: string;
  /** null = local connection, otherwise the SSH connection id. */
  host: string | null;
  cwd?: string;
  /** Set when this session is tracked by a tondash conversation. */
  projectId?: string;
  taskId?: string;
  conversationId?: string;
  title?: string;
  updatedAt?: string;
  /** Short preview drawn from the first transcript line. */
  snippet?: string;
}

export interface SearchSessionsQuery {
  text?: string;
  providers?: ShareProviderId[];
  projectIds?: string[];
  limit?: number;
}

export interface ShareSessionParams {
  projectId: string;
  taskId: string;
  conversationId: string;
}

export interface ApplySharedSessionParams {
  ref: ShareRef;
  projectId: string;
  taskId: string;
  targetProvider: ShareProviderId;
  autoApprove?: boolean;
}
