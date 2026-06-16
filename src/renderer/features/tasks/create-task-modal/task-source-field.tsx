import { useQuery } from '@tanstack/react-query';
import { CircleDot, GitPullRequest, Link2, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IssueRow,
  SelectedIssueValue,
} from '@renderer/features/tasks/components/issue-selector/issue-selector';
import { getLinkedIssueMap } from '@renderer/features/tasks/components/issue-selector/use-linked-issue-urls';
import { useIssueSearch } from '@renderer/features/tasks/components/issue-selector/useIssueSearch';
import { PrRow } from '@renderer/features/tasks/components/pr-row';
import { rpc } from '@renderer/lib/ipc';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/lib/ui/input-group';
import { Label } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';
import { getPrNumber, pullRequestErrorMessage, type PullRequest } from '@shared/pull-requests';
import type { Issue } from '@shared/tasks';
import { SelectedPrCard } from './selected-pr-card';
import {
  detectPastedSource,
  findPastedIssue,
  findPastedPullRequest,
  type DetectedPaste,
} from './source-detection';

export type TaskSource =
  | { kind: 'issue'; issue: Issue }
  | { kind: 'pull-request'; pr: PullRequest }
  | { kind: 'shared-link'; raw: string };

type ListEntry = { kind: 'issue'; issue: Issue } | { kind: 'pull-request'; pr: PullRequest };

interface TaskSourceFieldProps {
  value: TaskSource | null;
  onValueChange: (source: TaskSource | null) => void;
  projectId?: string;
  issueRepositoryUrl?: string;
  pullRequestRepositoryUrl?: string;
  projectPath?: string;
  disabled?: boolean;
}

function usePullRequests(
  projectId: string | undefined,
  repositoryUrl: string | undefined,
  status: 'open' | 'not-open',
  enabled: boolean
) {
  return useQuery({
    queryKey: ['pull-requests-inline', projectId, repositoryUrl ?? '', status],
    queryFn: async () => {
      const response = await rpc.pullRequests.listPullRequests(projectId!, {
        limit: 50,
        offset: 0,
        filters: { status },
        repositoryUrl: repositoryUrl ?? '',
      });
      if (!response?.success) {
        throw new Error(
          response ? pullRequestErrorMessage(response.error) : 'Failed to load pull requests'
        );
      }
      return response.data.prs;
    },
    enabled: enabled && !!projectId && !!repositoryUrl,
    staleTime: 30_000,
  });
}

/**
 * Unified "start from" picker for the create-task modal. Replaces the old
 * From Branch / From Issue / From PR / From Shared Link tabs: leaving it
 * empty creates the task from a branch, typing searches issues and pull
 * requests, and pasting a URL auto-detects what it points at (issue, PR,
 * or shared session).
 */
export const TaskSourceField = observer(function TaskSourceField({
  value,
  onValueChange,
  projectId,
  issueRepositoryUrl = '',
  pullRequestRepositoryUrl,
  projectPath = '',
  disabled,
}: TaskSourceFieldProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [pendingPaste, setPendingPaste] = useState<Extract<
    DetectedPaste,
    { kind: 'issue' | 'pull-request' }
  > | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const linkedIssueMap = getLinkedIssueMap(projectId);
  const issueSearch = useIssueSearch(issueRepositoryUrl, projectPath, projectId);
  const { data: openPrs } = usePullRequests(projectId, pullRequestRepositoryUrl, 'open', true);
  // Closed/merged PRs are only fetched when a pasted PR URL didn't match an open one.
  const wantsClosedPrs =
    pendingPaste?.kind === 'pull-request' &&
    !(openPrs ?? []).some((pr) => getPrNumber(pr) === pendingPaste.number);
  const { data: closedPrs } = usePullRequests(
    projectId,
    pullRequestRepositoryUrl,
    'not-open',
    wantsClosedPrs
  );

  const filteredPrs = useMemo(() => {
    const prs = openPrs ?? [];
    const lower = query.trim().toLowerCase();
    if (!lower) return prs;
    return prs.filter(
      (pr) =>
        pr.title.toLowerCase().includes(lower) ||
        pr.headRefName.toLowerCase().includes(lower) ||
        (pr.identifier ?? '').toLowerCase().includes(lower)
    );
  }, [openPrs, query]);

  const entries = useMemo<ListEntry[]>(
    () => [
      ...issueSearch.issues.map((issue): ListEntry => ({ kind: 'issue', issue })),
      ...filteredPrs.map((pr): ListEntry => ({ kind: 'pull-request', pr })),
    ],
    [issueSearch.issues, filteredPrs]
  );

  const select = useCallback(
    (source: TaskSource | null) => {
      onValueChange(source);
      setQuery('');
      setPendingPaste(null);
      setHighlightedIndex(0);
      issueSearch.handleSetSearchTerm('');
    },
    [onValueChange, issueSearch]
  );

  // Resolve a pasted issue/PR URL once the matching object shows up in a list.
  useEffect(() => {
    if (!pendingPaste) return;
    if (pendingPaste.kind === 'issue') {
      const match = findPastedIssue(issueSearch.issues, pendingPaste);
      if (match) select({ kind: 'issue', issue: match });
    } else {
      const match = findPastedPullRequest([...(openPrs ?? []), ...(closedPrs ?? [])], pendingPaste);
      if (match) select({ kind: 'pull-request', pr: match });
    }
  }, [pendingPaste, issueSearch.issues, openPrs, closedPrs, select]);

  const handleQueryChange = useCallback(
    (raw: string) => {
      setQuery(raw);
      setHighlightedIndex(0);
      const detected = detectPastedSource(raw);
      if (detected?.kind === 'shared-link') {
        select({ kind: 'shared-link', raw: detected.raw });
        return;
      }
      setPendingPaste(detected);
      if (detected?.kind === 'issue') {
        if (detected.provider) issueSearch.setSelectedIssueProvider(detected.provider);
        issueSearch.handleSetSearchTerm(detected.reference);
      } else if (detected?.kind === 'pull-request') {
        issueSearch.handleSetSearchTerm('');
      } else {
        issueSearch.handleSetSearchTerm(raw);
      }
    },
    [issueSearch, select]
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector(`[data-entry-index="${highlightedIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex((prev) => Math.min(prev + 1, entries.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          const entry = entries[highlightedIndex];
          if (!entry) break;
          e.preventDefault();
          select(entry);
          break;
        }
        case 'Escape':
          if (query) {
            // Clear the query instead of letting the modal's global Escape
            // handler close the dialog under the user's half-typed input.
            e.preventDefault();
            e.stopPropagation();
            handleQueryChange('');
          }
          break;
      }
    },
    [entries, highlightedIndex, query, select, handleQueryChange]
  );

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>Start from</Label>
        {value.kind === 'issue' ? (
          <SelectedSourceCard
            onClear={() => select(null)}
            body={<SelectedIssueValue issue={value.issue} />}
          />
        ) : value.kind === 'pull-request' ? (
          <SelectedPrCard pr={value.pr} onDeselect={() => select(null)} />
        ) : (
          <SelectedSourceCard
            onClear={() => select(null)}
            body={
              <div className="flex min-w-0 items-center gap-2">
                <Link2 className="size-4 shrink-0 text-foreground-muted" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">Shared session</span>
                  <span className="truncate text-xs text-foreground-muted">{value.raw}</span>
                </div>
              </div>
            }
          />
        )}
      </div>
    );
  }

  const showList = isFocused && query.trim().length > 0;
  const isSearching = issueSearch.isProviderLoading;

  return (
    <div className={cn('flex flex-col gap-1.5', disabled && 'pointer-events-none')}>
      <Label htmlFor="task-source">
        Start from <span className="font-normal text-foreground-passive">(optional)</span>
      </Label>
      <div className="border-input flex min-w-0 flex-col overflow-hidden rounded-md border">
        <InputGroup
          className={cn(
            'border-input has-[[data-slot=input-group-control]:focus-visible]:border-input rounded-none border-0 shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0',
            showList && 'border-b'
          )}
        >
          <InputGroupInput
            ref={inputRef}
            id="task-source"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Search issues & PRs, or paste an issue / PR / session link…"
          />
          {isSearching && showList && (
            <InputGroupAddon align="inline-end">
              <Loader2 className="size-3.5 animate-spin text-foreground/60" />
            </InputGroupAddon>
          )}
        </InputGroup>
        {showList && (
          <div
            ref={listRef}
            className="max-h-52 overflow-x-hidden overflow-y-auto p-1"
            // Keep focus in the input so a click on a row isn't swallowed by blur.
            onMouseDown={(e) => e.preventDefault()}
          >
            {pendingPaste && (
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-foreground-muted">
                <Loader2 className="size-3 animate-spin" />
                Looking up{' '}
                {pendingPaste.kind === 'issue'
                  ? `issue ${pendingPaste.reference}`
                  : `PR #${pendingPaste.number}`}
                …
              </div>
            )}
            {entries.length === 0 && !pendingPaste ? (
              <div className="px-2 py-4 text-center text-sm text-foreground-passive">
                {isSearching ? 'Searching…' : 'No matching issues or pull requests'}
              </div>
            ) : (
              entries.map((entry, index) => {
                const isHighlighted = index === highlightedIndex;
                return (
                  <button
                    key={entry.kind === 'issue' ? entry.issue.identifier : entry.pr.url}
                    type="button"
                    data-entry-index={index}
                    className={cn(
                      'relative flex min-w-0 w-full cursor-default items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none select-none',
                      isHighlighted && 'bg-background-2'
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => select(entry)}
                  >
                    {entry.kind === 'issue' ? (
                      <>
                        <CircleDot className="size-3.5 shrink-0 text-foreground-muted" />
                        <IssueRow
                          issue={entry.issue}
                          linkedTo={linkedIssueMap.get(entry.issue.url)}
                        />
                      </>
                    ) : (
                      <>
                        <GitPullRequest className="size-3.5 shrink-0 text-foreground-muted" />
                        <PrRow pr={entry.pr} />
                      </>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-foreground-passive">
        Leave empty to start from a branch. Paste an issue, pull request, or shared-session link to
        start from it.
      </p>
    </div>
  );
});

function SelectedSourceCard({ body, onClear }: { body: React.ReactNode; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-2 overflow-hidden rounded-md border border-border">
      <div className="flex flex-col gap-2 p-2">{body}</div>
      <div className="flex h-6 items-center justify-end border-t border-border bg-background-1 px-2 text-xs">
        <button className="flex items-center gap-2 text-foreground-muted" onClick={onClear}>
          Change
        </button>
      </div>
    </div>
  );
}
