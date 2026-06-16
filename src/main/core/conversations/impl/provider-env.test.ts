import { describe, expect, it } from 'vitest';
import { resolveProviderEnv } from './provider-env';

describe('resolveProviderEnv', () => {
  it('returns valid provider environment variables', () => {
    expect(
      resolveProviderEnv({
        env: {
          ANTHROPIC_BASE_URL: 'https://example.test',
          _TOKEN: 'secret',
          'INVALID-NAME': 'ignored',
          '1TOKEN': 'ignored',
        },
      })
    ).toEqual({
      ANTHROPIC_BASE_URL: 'https://example.test',
      _TOKEN: 'secret',
    });
  });

  it('returns undefined when no valid provider environment variables exist', () => {
    expect(resolveProviderEnv(undefined)).toBeUndefined();
    expect(resolveProviderEnv({ env: { 'INVALID-NAME': 'ignored' } })).toBeUndefined();
  });

  it('sets inline opencode permissions when auto-approve is enabled', () => {
    expect(resolveProviderEnv(undefined, { providerId: 'opencode', autoApprove: true })).toEqual({
      OPENCODE_PERMISSION: '{"*":"allow"}',
    });
  });

  it('does not set inline opencode permissions when auto-approve is disabled', () => {
    expect(
      resolveProviderEnv(undefined, { providerId: 'opencode', autoApprove: false })
    ).toBeUndefined();
  });

  it('preserves custom opencode permissions when auto-approve is enabled', () => {
    expect(
      resolveProviderEnv(
        { env: { OPENCODE_PERMISSION: '{"edit":"allow","bash":"ask"}' } },
        { providerId: 'opencode', autoApprove: true }
      )
    ).toEqual({
      OPENCODE_PERMISSION: '{"edit":"allow","bash":"ask"}',
    });
  });

  it('does not set inline opencode permissions for other providers', () => {
    expect(
      resolveProviderEnv(undefined, { providerId: 'claude', autoApprove: true })
    ).toBeUndefined();
  });

  it('merges extraEnv (subscription token) over provider custom env', () => {
    expect(
      resolveProviderEnv(
        { env: { CLAUDE_CODE_OAUTH_TOKEN: 'provider-wide', ANTHROPIC_BASE_URL: 'https://x' } },
        { providerId: 'claude', extraEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'per-conversation' } }
      )
    ).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'per-conversation',
      ANTHROPIC_BASE_URL: 'https://x',
    });
  });

  it('validates extraEnv variable names like provider env', () => {
    expect(
      resolveProviderEnv(undefined, { extraEnv: { 'INVALID-NAME': 'x', GOOD_NAME: 'y' } })
    ).toEqual({ GOOD_NAME: 'y' });
  });
});
