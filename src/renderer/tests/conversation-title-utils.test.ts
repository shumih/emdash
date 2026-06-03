import { describe, expect, it } from 'vitest';
import {
  formatConversationTitleForDisplay,
  nextIndexedConversationTitle,
  nextProviderConversationTitle,
} from '@renderer/features/tasks/conversations/conversation-title-utils';
import { buildProviderSessionName } from '@shared/conversations';

describe('nextIndexedConversationTitle', () => {
  it('fills the smallest missing index for the given prefix', () => {
    const title = nextIndexedConversationTitle('session', [
      { providerId: 'codex', title: 'session-1' },
      { providerId: 'codex', title: 'session-3' },
    ]);

    expect(title).toBe('session-2');
  });

  it('appends when there are no gaps', () => {
    const title = nextIndexedConversationTitle('session', [
      { providerId: 'codex', title: 'session-1' },
      { providerId: 'codex', title: 'session-2' },
      { providerId: 'codex', title: 'session-3' },
    ]);

    expect(title).toBe('session-4');
  });

  it('ignores titles with a different prefix', () => {
    const title = nextIndexedConversationTitle('fix-bug', [
      { providerId: 'claude', title: 'session-1' },
      { providerId: 'codex', title: 'release-triage' },
      { providerId: 'codex', title: 'fix-bug-2' },
    ]);

    expect(title).toBe('fix-bug-1');
  });

  it('treats blank prefix as the fallback "session"', () => {
    const title = nextIndexedConversationTitle('   ', []);
    expect(title).toBe('session-1');
  });

  it('handles prefixes with regex-special chars', () => {
    const title = nextIndexedConversationTitle('feat/v2.1 (rc)', [
      { providerId: 'codex', title: 'feat/v2.1 (rc)-1' },
    ]);

    expect(title).toBe('feat/v2.1 (rc)-2');
  });
});

describe('formatConversationTitleForDisplay', () => {
  it('title-cases legacy "claude (1)" style titles', () => {
    expect(formatConversationTitleForDisplay('codex', 'codex (2)')).toBe('Codex (2)');
    expect(formatConversationTitleForDisplay('gemini', 'gemini (1)')).toBe('Gemini (1)');
  });

  it('returns new "${prefix}-${index}" titles unchanged', () => {
    expect(formatConversationTitleForDisplay('claude', 'session-1')).toBe('session-1');
    expect(formatConversationTitleForDisplay('codex', 'fix-bug-2')).toBe('fix-bug-2');
  });

  it('leaves arbitrary custom titles unchanged', () => {
    expect(formatConversationTitleForDisplay('codex', 'release-triage')).toBe('release-triage');
  });
});

describe('nextProviderConversationTitle', () => {
  it('uses the provider name for the first conversation', () => {
    expect(nextProviderConversationTitle('claude', [])).toBe('Claude Code');
  });

  it('indexes provider names only after collisions', () => {
    const title = nextProviderConversationTitle('claude', [
      { providerId: 'claude', title: 'Claude Code' },
      { providerId: 'claude', title: 'Claude Code-3' },
    ]);

    expect(title).toBe('Claude Code-2');
  });
});

describe('buildProviderSessionName', () => {
  it('joins the task name and conversation title with a dash (no spaces)', () => {
    expect(
      buildProviderSessionName({ taskName: 'email-writer', conversationTitle: 'quantization' })
    ).toBe('email-writer-quantization');
    expect(
      buildProviderSessionName({ taskName: 'fix-login', conversationTitle: 'Claude Code' })
    ).toBe('fix-login-Claude Code');
  });

  it('falls back to whichever side is present', () => {
    expect(buildProviderSessionName({ taskName: 'fix-login', conversationTitle: '' })).toBe(
      'fix-login'
    );
    expect(buildProviderSessionName({ taskName: '  ', conversationTitle: 'Claude Code' })).toBe(
      'Claude Code'
    );
  });
});
