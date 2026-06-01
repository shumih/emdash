import { type AgentProviderId } from '@shared/agent-provider-registry';

type ConversationTitleInput = {
  providerId: AgentProviderId;
  title: string;
};

function capitalizeProviderId(providerId: AgentProviderId): string {
  return `${providerId.charAt(0).toUpperCase()}${providerId.slice(1)}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSuffixIndex(title: string, prefix: string): number | null {
  const match = title.match(new RegExp(`^${escapeRegex(prefix)}-([1-9]\\d*)$`));
  if (!match) return null;
  const rawIndex = match[1];
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 1) return null;
  if (String(index) !== rawIndex) return null;
  return index;
}

function parseLegacyProviderTitleIndex(title: string, providerId: AgentProviderId): number | null {
  const match = title.match(new RegExp(`^${providerId} \\(([1-9]\\d*)\\)$`, 'i'));
  if (!match) return null;
  const rawIndex = match[1];
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 1) return null;
  if (String(index) !== rawIndex) return null;
  return index;
}

/**
 * Format a stored title for display. Legacy `claude (1)` is title-cased to
 * `Claude (1)`; new `${prefix}-${index}` titles render as-is.
 */
export function formatConversationTitleForDisplay(
  providerId: AgentProviderId,
  title: string
): string {
  const legacyIndex = parseLegacyProviderTitleIndex(title, providerId);
  if (legacyIndex !== null) return `${capitalizeProviderId(providerId)} (${legacyIndex})`;
  return title;
}

/**
 * Compute the next `${prefix}-${index}` title that does not collide with any
 * existing conversation title. Indexes count up from 1, filling gaps.
 *
 * Callers can use the result as a generated title or as a placeholder. The
 * prefix should be human-meaningful, usually the task name.
 */
export function nextIndexedConversationTitle(
  prefix: string,
  conversations: ConversationTitleInput[]
): string {
  const trimmed = prefix.trim();
  const safePrefix = trimmed.length > 0 ? trimmed : 'session';
  const used = new Set<number>();

  for (const conversation of conversations) {
    const index = parseSuffixIndex(conversation.title, safePrefix);
    if (index !== null) used.add(index);
  }

  let next = 1;
  while (used.has(next)) next += 1;

  return `${safePrefix}-${next}`;
}
