import { ChevronRight, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getProjectManagerStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { extractShareRef } from '@renderer/features/shared-sessions/share-ref';
import { buildLinkedIssueContextAction } from '@renderer/features/tasks/conversations/context-actions';
import { nextProviderConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { resolveContextActionText } from '@renderer/features/tasks/conversations/resolve-context-action-text';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { AnimatedHeight } from '@renderer/lib/ui/animated-height';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Switch } from '@renderer/lib/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { getPrNumber, isForkPr, type PullRequest } from '@shared/pull-requests';
import {
  resolveBranchLikeTaskStrategy,
  resolvePullRequestTaskStrategy,
} from './create-task-strategy';
import { FromBranchContent } from './from-branch-content';
import { FromIssueContent } from './from-issue-content';
import { FromPrContent } from './from-pr-content';
import { FromSharedLinkContent } from './from-shared-link-content';
import { useInitialConversationState } from './initial-conversation-section';
import { hasInitialIssueContext, upsertInitialIssueContext } from './initial-conversation-text';
import { useFromBranchMode } from './use-from-branch-mode';
import { useFromIssueMode } from './use-from-issue-mode';
import { useFromPullRequestMode } from './use-from-pull-request-mode';
import { useFromSharedLinkMode } from './use-from-shared-link-mode';

type CreateTaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request' | 'from-shared-link';

export const CreateTaskModal = observer(function CreateTaskModal({
  projectId,
  strategy = 'from-branch',
  initialPR,
  onClose,
}: BaseModalProps & {
  projectId?: string;
  strategy?: CreateTaskStrategy;
  initialPR?: PullRequest;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (projectId) return projectId;
    const nav = appState.navigation;
    const navProjectId =
      nav.currentViewId === 'task'
        ? (nav.viewParamsStore['task'] as { projectId?: string } | undefined)?.projectId
        : nav.currentViewId === 'project'
          ? (nav.viewParamsStore['project'] as { projectId?: string } | undefined)?.projectId
          : undefined;
    return (
      navProjectId ??
      Array.from(getProjectManagerStore().projects.values())
        .reverse()
        .find((p) => p.state === 'mounted')?.data?.id
    );
  });
  const [selectedStrategy, setSelectedStrategy] = useState<CreateTaskStrategy>(strategy);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [useBYOI, setUseBYOI] = useState(false);

  const projectData = selectedProjectId
    ? mountedProjectData(getProjectManagerStore().projects.get(selectedProjectId))
    : null;
  const initialConversation = useInitialConversationState(selectedProjectId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const taskSettings = useTaskSettings();

  useEffect(() => setUseBYOI(false), [selectedProjectId]);
  useEffect(() => {
    initialConversation.setProvider(null);
    initialConversation.setPrompt('');
    // setProvider and setPrompt are stable useState setters
    // oxlint-disable-next-line react/exhaustive-deps
  }, [selectedProjectId]);

  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  useEffect(() => {
    if (!isWorkspaceProviderEnabled) setUseBYOI(false);
  }, [isWorkspaceProviderEnabled]);

  const repo = selectedProjectId ? getRepositoryStore(selectedProjectId) : undefined;
  const defaultBranch = repo?.defaultBranch;
  const isUnborn = repo?.isUnborn ?? false;
  const currentBranch = repo?.currentBranch ?? null;
  const { navigate } = useNavigate();

  const issueRepositoryUrl = repo?.issueRepositoryUrl ?? undefined;
  const pullRequestRepositoryUrl = repo?.pullRequestRepositoryUrl ?? undefined;

  const fromBranch = useFromBranchMode(selectedProjectId, defaultBranch, isUnborn, currentBranch);
  const fromIssue = useFromIssueMode(selectedProjectId, defaultBranch, isUnborn, currentBranch);
  const fromPR = useFromPullRequestMode(selectedProjectId, defaultBranch, isUnborn, initialPR);
  // Shares the same branch picker / task name state as From Branch — switching
  // tabs preserves the user's choices and avoids a duplicate generateTaskName RPC.
  const fromSharedLink = useFromSharedLinkMode(fromBranch);

  const activeMode = {
    'from-branch': fromBranch,
    'from-issue': fromIssue,
    'from-pull-request': fromPR,
    'from-shared-link': fromSharedLink,
  }[selectedStrategy];
  const fromPrUnavailable = selectedStrategy === 'from-pull-request' && !pullRequestRepositoryUrl;
  const canCreate = !!selectedProjectId && activeMode.isValid && !fromPrUnavailable && !isCreating;

  const handleCreateTask = useCallback(async () => {
    if (!selectedProjectId) return;
    const id = crypto.randomUUID();
    const projectStore = getProjectManagerStore().projects.get(selectedProjectId);
    if (projectStore?.state !== 'mounted') return;

    setIsCreating(true);
    try {
      let initialPrompt = initialConversation.prompt;

      if (
        selectedStrategy === 'from-issue' &&
        taskSettings.includeIssueContextByDefault &&
        fromIssue.linkedIssue &&
        !hasInitialIssueContext(initialPrompt)
      ) {
        const action = buildLinkedIssueContextAction(fromIssue.linkedIssue);
        if (action) {
          const issueContext = await resolveContextActionText({
            action,
            linkedIssue: fromIssue.linkedIssue,
            projectId: selectedProjectId,
          });
          initialPrompt = upsertInitialIssueContext(initialPrompt, issueContext);
        }
      }

      const builtInitialConversation = initialConversation.provider
        ? {
            id: crypto.randomUUID(),
            projectId: selectedProjectId,
            taskId: id,
            provider: initialConversation.provider,
            title: nextProviderConversationTitle([]),
            initialPrompt: initialPrompt.trim() || undefined,
            autoApprove: autoApproveDefaults.getDefault(initialConversation.provider),
          }
        : undefined;

      switch (selectedStrategy) {
        case 'from-branch': {
          if (!fromBranch.selectedBranch) return;
          const taskStrategy = resolveBranchLikeTaskStrategy({
            isUnborn,
            createBranchAndWorktree: fromBranch.createBranchAndWorktree,
            taskBranch: fromBranch.branchName,
            pushBranch: fromBranch.pushBranch,
          });
          void projectStore.mountedProject!.taskManager.createTask({
            id,
            projectId: selectedProjectId,
            name: fromBranch.taskName,
            sourceBranch: fromBranch.selectedBranch,
            strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
            workspaceProvider: useBYOI ? 'byoi' : undefined,
            initialConversation: builtInitialConversation,
          });
          break;
        }
        case 'from-issue': {
          if (!fromIssue.selectedBranch) return;
          const taskStrategy = resolveBranchLikeTaskStrategy({
            isUnborn,
            createBranchAndWorktree: fromIssue.createBranchAndWorktree,
            taskBranch: fromIssue.branchName,
            pushBranch: fromIssue.pushBranch,
          });
          void projectStore.mountedProject!.taskManager.createTask({
            id,
            projectId: selectedProjectId,
            name: fromIssue.taskName,
            sourceBranch: fromIssue.selectedBranch,
            strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
            linkedIssue: fromIssue.linkedIssue ?? undefined,
            workspaceProvider: useBYOI ? 'byoi' : undefined,
            initialConversation: builtInitialConversation,
          });
          break;
        }
        case 'from-pull-request': {
          if (!fromPR.linkedPR) return;
          const reviewBranch = fromPR.linkedPR.headRefName;
          const taskStrategy = resolvePullRequestTaskStrategy({
            checkoutMode: fromPR.checkoutMode,
            prNumber: getPrNumber(fromPR.linkedPR) ?? 0,
            headBranch: reviewBranch,
            headRepositoryUrl: fromPR.linkedPR.headRepositoryUrl,
            isFork: isForkPr(fromPR.linkedPR),
            taskBranch: fromPR.taskName,
            pushBranch: fromPR.branchSelection.pushBranch,
          });
          void projectStore.mountedProject!.taskManager.createTask({
            id,
            projectId: selectedProjectId,
            name: fromPR.taskName,
            sourceBranch: { type: 'local', branch: reviewBranch },
            initialStatus:
              fromPR.linkedPR.status === 'open' && !fromPR.linkedPR.isDraft ? 'review' : undefined,
            strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
            workspaceProvider: useBYOI ? 'byoi' : undefined,
            initialConversation: builtInitialConversation,
          });
          break;
        }
        case 'from-shared-link': {
          if (!fromSharedLink.selectedBranch) return;
          const taskStrategy = resolveBranchLikeTaskStrategy({
            isUnborn,
            createBranchAndWorktree: fromSharedLink.createBranchAndWorktree,
            taskBranch: fromSharedLink.branchName,
            pushBranch: fromSharedLink.pushBranch,
          });
          // taskManager.createTask awaits provisionTask internally, but for
          // branch_elsewhere/path_missing resolutions it returns successfully
          // while leaving the task in `unprovisioned` (workspace needs user
          // resolution). We must check the store state — applySharedSession
          // against a half-provisioned task would write the transcript to a
          // stale cwd and resume into a worktree that doesn't exist.
          await projectStore.mountedProject!.taskManager.createTask({
            id,
            projectId: selectedProjectId,
            name: fromSharedLink.taskName,
            sourceBranch: fromSharedLink.selectedBranch,
            strategy: useBYOI ? { kind: 'no-worktree' } : taskStrategy,
            workspaceProvider: useBYOI ? 'byoi' : undefined,
            // No initialConversation — the imported one is created below.
          });
          const created = projectStore.mountedProject!.taskManager.tasks.get(id);
          if (created?.state !== 'provisioned') {
            toast.error('Task needs workspace resolution before importing', {
              description:
                'Open the task and resolve the workspace, then use "Add Shared Session" to import.',
            });
            break;
          }
          const ref = extractShareRef(fromSharedLink.shareLink);
          try {
            await rpc.sharedSessions.applySharedSession({
              ref,
              projectId: selectedProjectId,
              taskId: id,
              targetProvider: fromSharedLink.targetProvider,
            });
          } catch (e) {
            // Task is alive; only the import failed. Surface a toast and still
            // navigate — the user can retry via "Add Shared Session" from
            // within the task without re-creating it.
            toast.error('Could not import shared session', {
              description: e instanceof Error ? e.message : String(e),
            });
          }
          break;
        }
      }

      navigate('task', { projectId: selectedProjectId, taskId: id });
      onClose();
    } finally {
      setIsCreating(false);
    }
  }, [
    selectedProjectId,
    selectedStrategy,
    fromBranch,
    fromIssue,
    fromPR,
    fromSharedLink,
    isUnborn,
    useBYOI,
    initialConversation,
    autoApproveDefaults,
    taskSettings.includeIssueContextByDefault,
    navigate,
    onClose,
  ]);

  return (
    <>
      <DialogHeader className="flex items-center gap-2">
        <ProjectSelector
          value={selectedProjectId}
          onChange={setSelectedProjectId}
          trigger={
            <ComboboxTrigger className="flex h-6 items-center gap-2 rounded-md border border-border px-2.5 py-1 text-sm outline-none">
              <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
              <ComboboxValue placeholder="Select a project" />
            </ComboboxTrigger>
          }
        />
        <ChevronRight className="size-3.5 text-foreground-passive" />
        <DialogTitle>Create Task</DialogTitle>
      </DialogHeader>
      <div className="flex shrink-0 flex-col gap-4 px-6 pb-4">
        <ToggleGroup
          className="w-full"
          value={[selectedStrategy]}
          onValueChange={([value]) => {
            if (value) {
              setSelectedStrategy(value as CreateTaskStrategy);
            }
          }}
        >
          <ToggleGroupItem className="flex-1" value="from-branch">
            From Branch
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-issue">
            From Issue
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-pull-request">
            From Pull Request
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-shared-link">
            From Shared Link
          </ToggleGroupItem>
        </ToggleGroup>
        {isWorkspaceProviderEnabled &&
          selectedStrategy !== 'from-shared-link' && (
            // BYOI workspaces don't expose a local cwd for the share importer to
            // write into, so we hide the toggle on the From Shared Link tab.
            <div className="flex items-center gap-2">
              <Switch size="sm" checked={useBYOI} onCheckedChange={setUseBYOI} />
              <span className="text-muted-foreground text-sm">Run on own infrastructure</span>
            </div>
          )}
      </div>
      <DialogContentArea>
        <AnimatedHeight onAnimatingChange={setIsTransitioning}>
          {selectedStrategy === 'from-branch' && (
            <FromBranchContent
              state={fromBranch}
              projectId={selectedProjectId}
              currentBranch={currentBranch}
              isUnborn={isUnborn}
              initialConversation={initialConversation}
            />
          )}
          {selectedStrategy === 'from-issue' && (
            <FromIssueContent
              state={fromIssue}
              projectId={selectedProjectId}
              currentBranch={currentBranch}
              repositoryUrl={issueRepositoryUrl}
              projectPath={projectData?.path}
              disabled={isTransitioning}
              isUnborn={isUnborn}
              initialConversation={initialConversation}
            />
          )}
          {selectedStrategy === 'from-pull-request' && (
            <div className="flex flex-col gap-3">
              {!pullRequestRepositoryUrl && (
                <p className="text-muted-foreground text-sm">
                  Pull requests are currently available only for configured GitHub remotes.
                </p>
              )}
              <FromPrContent
                state={fromPR}
                projectId={selectedProjectId}
                repositoryUrl={pullRequestRepositoryUrl}
                disabled={isTransitioning || fromPrUnavailable}
                initialConversation={initialConversation}
              />
            </div>
          )}
          {selectedStrategy === 'from-shared-link' && (
            <FromSharedLinkContent
              state={fromSharedLink}
              projectId={selectedProjectId}
              currentBranch={currentBranch}
              isUnborn={isUnborn}
            />
          )}
        </AnimatedHeight>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton size="sm" onClick={handleCreateTask} disabled={!canCreate}>
          {isCreating ? 'Creating...' : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
