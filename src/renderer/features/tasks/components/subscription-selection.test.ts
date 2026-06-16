import { describe, expect, it } from 'vitest';
import type { SubscriptionProfile } from '@shared/app-settings';
import { buildSubscriptionOptions, resolveDefaultSubscriptionId } from './subscription-selection';

const profiles: SubscriptionProfile[] = [
  { id: 'a', name: 'Account A' },
  { id: 'b', name: 'Account B' },
];

describe('resolveDefaultSubscriptionId', () => {
  it('follows the project default when the user has not chosen (override undefined)', () => {
    expect(resolveDefaultSubscriptionId(undefined, 'a')).toBe('a');
    expect(resolveDefaultSubscriptionId(undefined, null)).toBeNull();
    // Settings not loaded yet (project default undefined) → machine default.
    expect(resolveDefaultSubscriptionId(undefined, undefined)).toBeNull();
  });

  it('lets an explicit user choice win over the project default (the late-load race)', () => {
    // User picked B before settings loaded; default A resolves later — B survives.
    expect(resolveDefaultSubscriptionId('b', 'a')).toBe('b');
    // Explicit "machine default login" (null) also wins over a project default.
    expect(resolveDefaultSubscriptionId(null, 'a')).toBeNull();
  });
});

describe('buildSubscriptionOptions', () => {
  it('maps profiles to value/label options', () => {
    expect(buildSubscriptionOptions(profiles, null)).toEqual([
      { value: 'a', label: 'Account A' },
      { value: 'b', label: 'Account B' },
    ]);
  });

  it('appends a "Deleted account" entry for a dangling selected id', () => {
    expect(buildSubscriptionOptions(profiles, 'gone')).toEqual([
      { value: 'a', label: 'Account A' },
      { value: 'b', label: 'Account B' },
      { value: 'gone', label: 'Deleted account' },
    ]);
  });

  it('does not append for a known or empty selected id', () => {
    expect(buildSubscriptionOptions(profiles, 'a')).toHaveLength(2);
    expect(buildSubscriptionOptions(profiles, null)).toHaveLength(2);
  });
});
