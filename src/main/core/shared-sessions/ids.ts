import { createHash } from 'node:crypto';
import type { ShareProviderId } from '@shared/shared-sessions';

/** Fixed namespace (a random UUID) for our deterministic v5-style ids. */
const NAMESPACE = '7f3a9c2e-1b4d-5e6f-8a09-0c1d2e3f4a5b';

/**
 * Derive a stable RFC-4122-shaped (version 5) UUID from an arbitrary string.
 * Used so that re-sharing a conversation reuses the same share id, and applying
 * a share writes the transcript under the same deterministic session id —
 * making both operations idempotent.
 */
export function deterministicUuid(name: string): string {
  const nsHex = NAMESPACE.replace(/-/g, '');
  const nsBytes = Buffer.from(nsHex, 'hex');
  const hash = createHash('sha1').update(nsBytes).update(Buffer.from(name, 'utf8')).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Stable share id for a conversation, so re-sharing updates the same entry. */
export function shareIdForConversation(conversationId: string): string {
  return deterministicUuid(`conversation:${conversationId}`);
}

/** Deterministic CLI session id for an applied share + target provider. */
export function appliedSessionId(ref: string, target: ShareProviderId): string {
  return deterministicUuid(`apply:${ref}:${target}`);
}
