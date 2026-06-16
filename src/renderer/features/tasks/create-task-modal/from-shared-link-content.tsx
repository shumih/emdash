import { Label } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { SHARE_PROVIDERS, type ShareProviderId } from '@shared/shared-sessions';
import { BranchPickerField } from './branch-picker-field';
import { TaskNameField } from './task-name-field';
import { type FromSharedLinkModeState } from './use-from-shared-link-mode';

const PROVIDER_LABELS: Record<ShareProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

interface FromSharedLinkContentProps {
  state: FromSharedLinkModeState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
}

/**
 * Shown when the unified source field has a shared-session link. The link
 * itself lives in the source field; this renders the target provider,
 * branch, and name fields. The session is imported as the task's first
 * conversation.
 */
export function FromSharedLinkContent({
  state,
  projectId,
  currentBranch,
  isUnborn,
}: FromSharedLinkContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Open as</Label>
        <Select
          value={state.targetProvider}
          onValueChange={(v) => state.setTargetProvider(v as ShareProviderId)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHARE_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-foreground-passive">
          The session is imported as this task&apos;s first conversation.
        </p>
      </div>
      <BranchPickerField
        state={state}
        branchNameState={state}
        projectId={projectId}
        currentBranch={currentBranch}
        isUnborn={isUnborn}
      />
      <TaskNameField state={state} />
    </div>
  );
}
