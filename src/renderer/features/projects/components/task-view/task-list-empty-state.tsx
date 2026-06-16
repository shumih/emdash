import { GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useArrowKeyNavigation } from '@renderer/lib/hooks/use-arrow-key-navigation';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ActionListItem } from '@renderer/lib/ui/action-list-item';

export const TaskListEmptyState = observer(function TaskListEmptyState({
  projectId,
}: {
  projectId: string;
}) {
  const showTaskModal = useShowModal('taskModal');

  const { selectedIndex, setSelectedIndex } = useArrowKeyNavigation(1, () => {
    showTaskModal({ projectId });
  });

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-sm flex-col gap-1">
        <ActionListItem
          label="Create a Task"
          description="Start from a branch, or paste an issue, PR, or shared-session link"
          icon={GitBranch}
          isSelected={selectedIndex === 0}
          onMouseEnter={() => setSelectedIndex(0)}
          onClick={() => showTaskModal({ projectId })}
        />
      </div>
    </div>
  );
});
