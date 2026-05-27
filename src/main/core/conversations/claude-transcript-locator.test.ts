import { describe, expect, it } from 'vitest';
import {
  encodeClaudeProjectDir,
  listClaudeSessionIds,
  pickNewSessionId,
} from './claude-transcript-locator';

describe('encodeClaudeProjectDir', () => {
  it('replaces slashes with dashes like Claude Code', () => {
    expect(encodeClaudeProjectDir('/Users/shumih/projects/explee/explee')).toBe(
      '-Users-shumih-projects-explee-explee'
    );
  });

  it('replaces dots, producing a double dash for hidden segments', () => {
    expect(
      encodeClaudeProjectDir('/Users/shumih/projects/explee/explee/.data/agent-sessions/x')
    ).toBe('-Users-shumih-projects-explee-explee--data-agent-sessions-x');
  });
});

describe('pickNewSessionId', () => {
  it('returns the single newly-added id', () => {
    expect(pickNewSessionId(new Set(['a', 'b']), new Set(['a', 'b', 'c']))).toBe('c');
  });

  it('returns undefined when nothing was added', () => {
    expect(pickNewSessionId(new Set(['a']), new Set(['a']))).toBeUndefined();
  });

  it('returns undefined when attribution is ambiguous (multiple added)', () => {
    expect(pickNewSessionId(new Set(['a']), new Set(['a', 'b', 'c']))).toBeUndefined();
  });
});

describe('listClaudeSessionIds', () => {
  const fakeFs = (entries: { path: string; type?: 'file' | 'dir' }[]) => ({
    list: async () => ({
      entries: entries.map((e) => ({ type: 'file' as const, ...e })),
      total: entries.length,
    }),
  });

  it('extracts session ids from .jsonl basenames and ignores other entries', async () => {
    const fs = fakeFs([
      { path: '.claude/projects/-cwd/aaa.jsonl' },
      { path: '.claude/projects/-cwd/bbb.jsonl' },
      { path: '.claude/projects/-cwd/bbb' }, // subagent dir — ignored
      { path: '.claude/projects/-cwd/notes.txt' },
    ]);
    const ids = await listClaudeSessionIds(fs, '/cwd');
    expect(ids).toEqual(new Set(['aaa', 'bbb']));
  });

  it('returns an empty set when the directory cannot be read', async () => {
    const fs = {
      list: async () => {
        throw new Error('ENOENT');
      },
    };
    expect(await listClaudeSessionIds(fs, '/cwd')).toEqual(new Set());
  });
});
