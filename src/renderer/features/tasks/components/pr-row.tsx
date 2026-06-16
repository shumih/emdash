import type { PullRequest } from '@shared/pull-requests';

export function PrRow({ pr }: { pr: PullRequest }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-mono text-xs text-foreground-muted">
          {pr.identifier ?? ''}
        </span>
        {pr.isDraft && (
          <span className="shrink-0 rounded border border-border px-1 text-xs text-foreground-muted">
            Draft
          </span>
        )}
        <span className="truncate text-sm">{pr.title}</span>
      </div>
      <div className="flex items-center gap-1 text-xs text-foreground-muted">
        <code className="text-xs">{pr.headRefName}</code>
        {pr.author && (
          <>
            <span>·</span>
            <span>{pr.author.userName}</span>
          </>
        )}
      </div>
    </div>
  );
}
