import { describe, expect, it } from 'vitest';
import type { SearchItem } from '@shared/search';
import { applyContextAffinity } from './search-utils';

function item(over: Partial<SearchItem>): SearchItem {
  return {
    kind: 'task',
    id: 'id',
    projectId: null,
    taskId: null,
    title: 'title',
    subtitle: '',
    score: 0,
    ...over,
  };
}

describe('applyContextAffinity', () => {
  it('ranks commands ahead of in-project items (the original bug)', () => {
    const items: SearchItem[] = [
      // BM25 score: lower = better match. The file is a "better match" by raw
      // BM25 than the command, but commands should still come first.
      item({ kind: 'file', id: 'a.ts', projectId: 'p1', score: -3 }),
      item({ kind: 'command', id: 'app.shareSession', projectId: null, score: -1 }),
    ];
    const ranked = applyContextAffinity(items, { projectId: 'p1' });
    expect(ranked.map((r) => r.id)).toEqual(['app.shareSession', 'a.ts']);
  });

  it('within commands, lower BM25 wins', () => {
    const items: SearchItem[] = [
      item({ kind: 'command', id: 'cmd-weak', projectId: null, score: -1 }),
      item({ kind: 'command', id: 'cmd-strong', projectId: null, score: -5 }),
    ];
    const ranked = applyContextAffinity(items, { projectId: 'p1' });
    expect(ranked.map((r) => r.id)).toEqual(['cmd-strong', 'cmd-weak']);
  });

  it('after commands, in-project items beat out-of-project items', () => {
    const items: SearchItem[] = [
      // Same kind/score; only project membership differs.
      item({ kind: 'task', id: 'other', projectId: 'p2', score: -3 }),
      item({ kind: 'task', id: 'mine', projectId: 'p1', score: -1 }),
    ];
    const ranked = applyContextAffinity(items, { projectId: 'p1' });
    expect(ranked.map((r) => r.id)).toEqual(['mine', 'other']);
  });

  it('without a project context, falls back to BM25 across all items', () => {
    const items: SearchItem[] = [
      item({ kind: 'task', id: 'b', projectId: 'p1', score: -1 }),
      item({ kind: 'task', id: 'a', projectId: 'p2', score: -5 }),
    ];
    const ranked = applyContextAffinity(items, {});
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('is stable for a singleton', () => {
    const items: SearchItem[] = [item({ id: 'only', projectId: 'p1' })];
    expect(applyContextAffinity(items, { projectId: 'p1' })).toEqual(items);
  });
});
