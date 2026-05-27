import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

/**
 * Persist the real agent-CLI session id for a conversation so future --resume
 * targets the id the CLI actually wrote its transcript under, not the
 * tondash-minted conversation id. Idempotent: writes only when the value
 * changes, so it is safe to call on every hook event.
 *
 * Returns true if a write happened.
 */
export async function setProviderSessionId(
  conversationId: string,
  providerSessionId: string
): Promise<boolean> {
  if (!providerSessionId) return false;

  const [existing] = await db
    .select({ providerSessionId: conversations.providerSessionId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!existing || existing.providerSessionId === providerSessionId) return false;

  await db
    .update(conversations)
    .set({ providerSessionId })
    .where(eq(conversations.id, conversationId));

  return true;
}
