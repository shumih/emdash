import { describe, expect, it } from 'vitest';
import {
  detectPastedSource,
  findPastedIssue,
  findPastedPullRequest,
  normalizeUrl,
} from '@renderer/features/tasks/create-task-modal/source-detection';

describe('detectPastedSource', () => {
  it('returns null for plain search text', () => {
    expect(detectPastedSource('fix login bug')).toBeNull();
    expect(detectPastedSource('')).toBeNull();
    expect(detectPastedSource('abc123')).toBeNull();
  });

  it('detects GitHub pull request URLs', () => {
    expect(detectPastedSource('https://github.com/owner/repo/pull/42')).toEqual({
      kind: 'pull-request',
      url: 'https://github.com/owner/repo/pull/42',
      number: 42,
    });
  });

  it('detects PR URLs on self-hosted instances by path', () => {
    expect(detectPastedSource('https://ghe.corp.example/owner/repo/pull/7')).toMatchObject({
      kind: 'pull-request',
      number: 7,
    });
  });

  it('detects GitLab merge request URLs', () => {
    expect(
      detectPastedSource('https://gitlab.com/group/project/-/merge_requests/15')
    ).toMatchObject({ kind: 'pull-request', number: 15 });
  });

  it('detects GitHub issue URLs with provider hint', () => {
    expect(detectPastedSource('https://github.com/owner/repo/issues/123?foo=1')).toEqual({
      kind: 'issue',
      url: 'https://github.com/owner/repo/issues/123?foo=1',
      reference: '123',
      provider: 'github',
    });
  });

  it('detects GitLab issue URLs', () => {
    expect(detectPastedSource('https://gitlab.com/group/project/-/issues/9')).toMatchObject({
      kind: 'issue',
      reference: '9',
      provider: 'gitlab',
    });
  });

  it('detects Linear issue URLs by identifier', () => {
    expect(detectPastedSource('https://linear.app/myteam/issue/ENG-123/fix-the-thing')).toEqual({
      kind: 'issue',
      url: 'https://linear.app/myteam/issue/ENG-123/fix-the-thing',
      reference: 'ENG-123',
      provider: 'linear',
    });
  });

  it('treats unknown-host URLs as shared-session links', () => {
    expect(detectPastedSource('http://code.d/s/abc123')).toEqual({
      kind: 'shared-link',
      raw: 'http://code.d/s/abc123',
      ref: 'abc123',
    });
  });

  it('does not treat leftover known-git-host URLs as share links', () => {
    expect(detectPastedSource('https://github.com/owner/repo')).toBeNull();
    expect(detectPastedSource('https://github.com/owner/repo/tree/main')).toBeNull();
    expect(detectPastedSource('https://linear.app/myteam')).toBeNull();
  });

  it('detects issue/PR lists (no number) as plain text', () => {
    expect(detectPastedSource('https://github.com/owner/repo/issues')).toBeNull();
    expect(detectPastedSource('https://github.com/owner/repo/pulls')).toBeNull();
  });

  it('treats repo-browsing URLs on self-hosted instances as plain text, not share links', () => {
    expect(detectPastedSource('https://ghe.corp.example/owner/repo/tree/main')).toBeNull();
    expect(detectPastedSource('https://ghe.corp.example/owner/repo/commit/abc123')).toBeNull();
    expect(detectPastedSource('https://ghe.corp.example/owner/repo/issues')).toBeNull();
  });
});

describe('findPastedIssue', () => {
  const issues = [
    { url: 'https://github.com/owner/repo/issues/123', identifier: '#123' },
    { url: 'https://linear.app/team/issue/ENG-42/fix-the-thing', identifier: 'ENG-42' },
  ];

  it('matches GitHub issues by URL despite query/trailing-slash noise', () => {
    expect(
      findPastedIssue(issues, {
        url: 'https://github.com/owner/repo/issues/123/?x=1',
        reference: '123',
      })
    ).toBe(issues[0]);
  });

  it('never matches a numeric reference by identifier alone (cross-repo collision)', () => {
    expect(
      findPastedIssue(issues, { url: 'https://github.com/other/repo/issues/123', reference: '123' })
    ).toBeUndefined();
  });

  it('matches Linear issues by identifier when the pasted link lacks the title slug', () => {
    expect(
      findPastedIssue(issues, { url: 'https://linear.app/team/issue/ENG-42', reference: 'ENG-42' })
    ).toBe(issues[1]);
  });
});

describe('findPastedPullRequest', () => {
  const prs = [
    { url: 'https://github.com/owner/repo/pull/42', identifier: '#42' },
    { url: 'https://github.com/owner/repo/pull/43', identifier: '#43' },
  ];

  it('matches by exact URL', () => {
    expect(
      findPastedPullRequest(prs, { url: 'https://github.com/owner/repo/pull/43', number: 43 })
    ).toBe(prs[1]);
  });

  it('matches by number when the paste carries a subpage suffix', () => {
    expect(
      findPastedPullRequest(prs, { url: 'https://github.com/owner/repo/pull/42/files', number: 42 })
    ).toBe(prs[0]);
  });

  it('does not match a foreign repository PR with the same number', () => {
    expect(
      findPastedPullRequest(prs, { url: 'https://github.com/other/repo/pull/42', number: 42 })
    ).toBeUndefined();
  });
});

describe('normalizeUrl', () => {
  it('strips query, hash, and trailing slashes', () => {
    expect(normalizeUrl('https://github.com/o/r/issues/1/?x=1#frag')).toBe(
      'github.com/o/r/issues/1'
    );
  });

  it('compares case-insensitively on host only', () => {
    expect(normalizeUrl('https://GitHub.com/o/r/pull/2')).toBe('github.com/o/r/pull/2');
  });
});
