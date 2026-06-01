import { describe, expect, it } from 'vitest';
import {
  formatConversationTitleForDisplay,
  nextIndexedConversationTitle,
} from '@renderer/features/tasks/conversations/conversation-title-utils';

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
