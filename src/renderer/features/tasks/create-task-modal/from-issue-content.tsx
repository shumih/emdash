import { BranchPickerField } from './branch-picker-field';
import {
  InitialConversationField,
  type InitialConversationState,
} from './initial-conversation-section';
import { TaskNameField } from './task-name-field';
import { type FromIssueModeState } from './use-from-issue-mode';

interface FromIssueContentProps {
  state: FromIssueModeState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
  initialConversation: InitialConversationState;
  issueActionPending?: boolean;
}

/**
 * Shown when the unified source field has an issue selected. The issue card
 * and issue-context injection live in the source field / modal; this renders
 * only the branch, name, and conversation fields.
 */
export function FromIssueContent({
  state,
  projectId,
  currentBranch,
  isUnborn,
  initialConversation,
  issueActionPending,
}: FromIssueContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <BranchPickerField
        state={state}
        branchNameState={state}
        projectId={projectId}
        currentBranch={currentBranch}
        isUnborn={isUnborn}
      />
      <TaskNameField state={state} />
      <InitialConversationField
        state={initialConversation}
        linkedIssue={state.linkedIssue ?? undefined}
        projectId={projectId}
        issueActionPending={issueActionPending}
      />
    </div>
  );
}
