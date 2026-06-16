import { extractShareRef } from '@renderer/features/shared-sessions/share-ref';
import { getPrNumber } from '@shared/pull-requests';

/**
 * What a pasted string turned out to be. `issue`/`pull-request` carry the
 * reference we need to find the matching object in the loaded lists;
 * `shared-link` is self-contained (the ref is all the importer needs).
 */
export type DetectedPaste =
  | {
      kind: 'issue';
      url: string;
      reference: string;
      provider: 'github' | 'gitlab' | 'linear' | null;
    }
  | { kind: 'pull-request'; url: string; number: number }
  | { kind: 'shared-link'; raw: string; ref: string };

/** Hosts where a non-issue/PR URL is almost certainly not a share link. */
const KNOWN_GIT_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'gitlab.com',
  'www.gitlab.com',
  'linear.app',
]);

/**
 * Path segments that mark a repo-browsing URL (file tree, commit, list pages).
 * Such pastes are never share links, even on self-hosted git instances whose
 * hosts we can't allowlist.
 */
const REPO_BROWSE_SEGMENTS = new Set([
  'tree',
  'blob',
  'commit',
  'commits',
  'compare',
  'releases',
  'wiki',
  'actions',
  'pull',
  'pulls',
  'issues',
  'merge_requests',
]);

/** Strip query/hash/trailing slashes so pasted and API-provided URLs compare equal. */
export function normalizeUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return input.trim().replace(/\/+$/, '');
  }
}

/**
 * Classify a pasted string for the unified create-task source field.
 *
 * Path-based (not host-based) matching for issues and PRs so self-hosted
 * GitHub/GitLab instances work too. Any other URL is assumed to be a shared
 * session link — except on known git hosts, where a leftover URL is more
 * likely a repo/branch link the user pasted by accident; those return null
 * and fall through to plain search.
 */
export function detectPastedSource(input: string): DetectedPaste | null {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  const numberAfter = (marker: string): string | null => {
    const idx = segments.lastIndexOf(marker);
    const next = idx >= 0 ? segments[idx + 1] : undefined;
    return next && /^\d+$/.test(next) ? next : null;
  };

  const mrNumber = numberAfter('merge_requests') ?? numberAfter('pull');
  if (mrNumber) return { kind: 'pull-request', url: trimmed, number: Number(mrNumber) };

  const issueNumber = numberAfter('issues');
  if (issueNumber) {
    const provider = host.endsWith('gitlab.com')
      ? 'gitlab'
      : host.endsWith('github.com')
        ? 'github'
        : null;
    return { kind: 'issue', url: trimmed, reference: issueNumber, provider };
  }

  // Linear: linear.app/<team>/issue/<IDENTIFIER>[/<title-slug>]
  if (host === 'linear.app' && segments[1] === 'issue' && segments[2]) {
    return { kind: 'issue', url: trimmed, reference: segments[2], provider: 'linear' };
  }

  if (KNOWN_GIT_HOSTS.has(host)) return null;
  if (segments.some((segment) => REPO_BROWSE_SEGMENTS.has(segment))) return null;
  return { kind: 'shared-link', raw: trimmed, ref: extractShareRef(trimmed) };
}

/**
 * Find the loaded issue a pasted URL points at. Numeric references (GitHub /
 * GitLab issue numbers) must match by URL — matching by number alone could
 * select this repo's #N when the paste points at a different repository.
 * Non-numeric references (Linear's ENG-123) are globally unique, so the
 * identifier is a safe fallback for short links without the title slug.
 */
export function findPastedIssue<T extends { url: string; identifier: string }>(
  issues: readonly T[],
  paste: { url: string; reference: string }
): T | undefined {
  const wanted = normalizeUrl(paste.url);
  const reference = paste.reference.toLowerCase();
  const isNumeric = /^\d+$/.test(reference);
  return issues.find(
    (issue) =>
      normalizeUrl(issue.url) === wanted ||
      (!isNumeric && issue.identifier.toLowerCase() === reference)
  );
}

/** The repo part of a normalized PR URL: everything before /pull/N or /merge_requests/N. */
function prRepoPrefix(normalizedUrl: string): string {
  return normalizedUrl.split(/\/(?:pull|merge_requests)\/\d+/)[0].replace(/\/-$/, '');
}

/**
 * Find the loaded pull request a pasted URL points at: exact URL match, or a
 * number match constrained to the same repository — so a pasted PR URL with a
 * trailing subpage (`/pull/42/files`) still resolves, but a foreign repo's
 * #42 never selects this project's #42.
 */
export function findPastedPullRequest<T extends { url: string; identifier: string | null }>(
  prs: readonly T[],
  paste: { url: string; number: number }
): T | undefined {
  const wanted = normalizeUrl(paste.url);
  const wantedRepo = prRepoPrefix(wanted);
  return prs.find((pr) => {
    const prUrl = normalizeUrl(pr.url);
    if (prUrl === wanted) return true;
    return getPrNumber(pr) === paste.number && prRepoPrefix(prUrl) === wantedRepo;
  });
}
