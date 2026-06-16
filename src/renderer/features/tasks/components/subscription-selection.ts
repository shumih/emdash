import type { SubscriptionProfile } from '@shared/app-settings';

export type SubscriptionOption = { value: string; label: string };

/**
 * The subscription (account) id to show in a create-task account picker.
 * `override` is the user's explicit choice for the current project/provider
 * entry; `undefined` means "follow the project default". A `null` override or
 * default means the machine's default login.
 *
 * Deriving the shown value from (override, projectDefault) — rather than seeding
 * it via an effect once settings load — means a late-resolving project default
 * never clobbers a manual selection: if `override` is set it always wins.
 */
export function resolveDefaultSubscriptionId(
  override: string | null | undefined,
  projectDefault: string | null | undefined
): string | null {
  return override !== undefined ? override : (projectDefault ?? null);
}

/**
 * Options for an account picker. When `selectedId` references a profile that no
 * longer exists (deleted while still configured as a project default or
 * inherited by a fork), append a synthetic "Deleted account" entry so the
 * trigger shows a label instead of a raw id and the select has a matching item.
 * Spawn already falls back to the default login for an unknown id
 * (subscriptionService.resolveEnv), so this is display-only.
 */
export function buildSubscriptionOptions(
  profiles: SubscriptionProfile[],
  selectedId: string | null
): SubscriptionOption[] {
  const options = profiles.map((profile) => ({ value: profile.id, label: profile.name }));
  if (selectedId && !profiles.some((profile) => profile.id === selectedId)) {
    options.push({ value: selectedId, label: 'Deleted account' });
  }
  return options;
}
