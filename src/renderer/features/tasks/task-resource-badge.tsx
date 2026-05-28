import { Cpu, MemoryStick } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatBytes } from '@renderer/utils/formatBytes';
import type { ResourcePtyEntry } from '@shared/resource-monitor';

function entryLabel(entry: ResourcePtyEntry): string {
  const meta = entry.providerId ? agentMeta[entry.providerId] : undefined;
  return entry.title || meta?.label || entry.providerId || entry.leafId.slice(0, 8);
}

/**
 * Live CPU/memory consumed by a task's local agent PTY processes, shown in the
 * task titlebar. Only renders when the Resource Monitor setting is enabled
 * (which drives the underlying sampler) and the task has a local footprint —
 * remote (SSH) tasks run their agent off-machine and report no local usage.
 */
export const TaskResourceBadge = observer(function TaskResourceBadge({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { value } = useAppSettingsKey('resourceMonitor');
  const enabled = value?.enabled ?? false;

  useEffect(() => {
    if (!enabled) return;
    const store = appState.resourceMonitor;
    store.acquire();
    return () => store.release();
  }, [enabled]);

  if (!enabled) return null;

  const usage = appState.resourceMonitor.usageForTask(projectId, taskId);
  if (usage.localCount === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="tabular-nums">
              <Cpu />
              {usage.cpu.toFixed(1)}%
            </Badge>
            <Badge variant="secondary" className="tabular-nums">
              <MemoryStick />
              {formatBytes(usage.memoryBytes)}
            </Badge>
          </div>
        }
      />
      <TooltipContent>
        <div className="flex flex-col gap-0.5">
          {usage.entries.map((e) => (
            <span key={e.sessionId} className="tabular-nums">
              {entryLabel(e)} · {appState.resourceMonitor.normalizedCpu(e).toFixed(1)}% ·{' '}
              {formatBytes(e.memory)}
            </span>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
});
