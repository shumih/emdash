import os from 'node:os';
import { app } from 'electron';
import pidusage from 'pidusage';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { resourceSnapshotChannel } from '@shared/events/resourceEvents';
import { parsePtySessionId } from '@shared/ptySessionId';
import type {
  ResourceAppProcess,
  ResourceAppUsage,
  ResourcePtyEntry,
  ResourceSnapshot,
} from '@shared/resource-monitor';
import { buildChildrenIndex, subtreePids } from './process-tree';

const SAMPLE_INTERVAL_MS = 1500;
const CPU_COUNT = os.cpus().length;
const TOTAL_MEMORY_BYTES = os.totalmem();
const STALE_LOCAL_PTY_MEMORY_BYTES = 2 * 1024 * 1024;

type PidSample = { cpu: number; memory: number; ppid?: number };

export async function sampleOnce(): Promise<ResourceSnapshot> {
  const active = ptySessionRegistry.listActiveSessions();
  const rootPids = active
    .map((a) => a.pid)
    .filter((p): p is number => typeof p === 'number' && p > 0);

  // An agent's real footprint is its whole subprocess subtree: the `claude`
  // (or codex/…) PTY process plus every MCP server it spawns (node,
  // chrome-devtools-mcp, …) and their grandchildren. Sampling only the root pid
  // under-reports by the (often dominant) weight of those helpers. Build a
  // pid → children index once per tick and fold each root's subtree into a
  // single row. `null` on platforms without `ps` (Windows) → per-root sampling.
  const childrenByPid = await buildChildrenIndex();

  const subtreeByRoot = new Map<number, number[]>();
  const allPids = new Set<number>();
  for (const root of rootPids) {
    const subtree = childrenByPid ? subtreePids(root, childrenByPid) : [root];
    subtreeByRoot.set(root, subtree);
    for (const pid of subtree) allPids.add(pid);
  }

  const usage = await sampleUsage([...allPids]);

  const entries: ResourcePtyEntry[] = [];
  for (const a of active) {
    const parsed = parsePtySessionId(a.sessionId);
    if (!parsed) continue;
    const rootPid = typeof a.pid === 'number' ? a.pid : undefined;
    const subtree = rootPid !== undefined ? (subtreeByRoot.get(rootPid) ?? [rootPid]) : [];

    let cpu = 0;
    let memory = 0;
    for (const pid of subtree) {
      const u = usage[String(pid)];
      if (!u) continue;
      cpu += u.cpu;
      memory += u.memory;
    }
    const rootUsage = rootPid !== undefined ? usage[String(rootPid)] : undefined;
    if (isStaleLocalPty(rootPid, cpu, memory)) continue;

    entries.push({
      sessionId: a.sessionId,
      projectId: parsed.projectId,
      scopeId: parsed.scopeId,
      leafId: parsed.leafId,
      pid: a.pid,
      ppid: rootUsage?.ppid,
      cpu,
      memory,
      providerId: a.metadata?.providerId,
      title: a.metadata?.title,
    });
  }

  const { usage: appUsage, processes: appProcesses } = sampleAppUsage();
  return {
    timestamp: Date.now(),
    cpuCount: CPU_COUNT,
    totalMemoryBytes: TOTAL_MEMORY_BYTES,
    app: appUsage,
    appProcesses,
    entries,
  };
}

/** Sample cpu + RSS for a set of pids, tolerating dead pids in the batch. */
async function sampleUsage(pids: number[]): Promise<Record<string, PidSample>> {
  if (pids.length === 0) return {};
  try {
    return await pidusage(pids);
  } catch {
    // A dead PID rejects the whole batch — fall back to per-pid sampling.
    const usage: Record<string, PidSample> = {};
    const results = await Promise.allSettled(pids.map((pid) => pidusage(pid)));
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        usage[String(pids[i])] = {
          cpu: r.value.cpu,
          memory: r.value.memory,
          ppid: r.value.ppid,
        };
      }
    });
    return usage;
  }
}

/**
 * True when an agent's PTY (and its subtree) has no meaningful footprint — the
 * process has exited but the registry hasn't cleaned it up yet. A live agent
 * always exceeds the threshold (a fresh Node process alone is tens of MB).
 */
function isStaleLocalPty(pid: number | undefined, cpu: number, memory: number): boolean {
  if (pid === undefined) return false;
  return cpu === 0 && memory < STALE_LOCAL_PTY_MEMORY_BYTES;
}

/**
 * Sum memory + CPU across all Electron processes (main, renderer, GPU, utility)
 * and capture each row individually. `workingSetSize` is reported in KiB;
 * `percentCPUUsage` is % of one core. These are Electron's own processes only;
 * the pty-spawned agent subtrees are reported per-entry, so there is no overlap.
 */
function sampleAppUsage(): { usage: ResourceAppUsage; processes: ResourceAppProcess[] } {
  try {
    const metrics = app.getAppMetrics();
    let memoryBytes = 0;
    let cpuPercent = 0;
    const processes: ResourceAppProcess[] = [];
    for (const m of metrics) {
      const memBytes = m.memory.workingSetSize * 1024;
      memoryBytes += memBytes;
      cpuPercent += m.cpu.percentCPUUsage;
      processes.push({
        pid: m.pid,
        type: m.type,
        name: m.name ?? m.serviceName,
        cpu: m.cpu.percentCPUUsage,
        memory: memBytes,
      });
    }
    return { usage: { memoryBytes, cpuPercent }, processes };
  } catch (err) {
    log.warn('resource-sampler: app metrics failed', err);
    return { usage: { memoryBytes: 0, cpuPercent: 0 }, processes: [] };
  }
}

let timer: NodeJS.Timeout | null = null;
const openSubscriptions = new Set<string>();
const latestSequenceByClient = new Map<string, number>();

export function startResourceSampler(): void {
  if (timer) return;
  const tick = async () => {
    try {
      const snap = await sampleOnce();
      events.emit(resourceSnapshotChannel, snap);
    } catch (err) {
      log.warn('resource-sampler: sample failed', err);
    }
  };
  timer = setInterval(() => void tick(), SAMPLE_INTERVAL_MS);
  void tick();
}

export function stopResourceSampler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    try {
      pidusage.clear();
    } catch {
      // ignore
    }
  }
}

export function setResourceMonitorOpen(
  clientId: string,
  subscriptionId: string,
  open: boolean,
  sequence: number
): void {
  const latestSequence = latestSequenceByClient.get(clientId) ?? 0;
  if (sequence <= latestSequence) return;
  latestSequenceByClient.set(clientId, sequence);
  if (open) {
    openSubscriptions.add(subscriptionId);
  } else {
    openSubscriptions.delete(subscriptionId);
    latestSequenceByClient.delete(clientId);
  }
  void reconcileResourceSampler();
}

export async function reconcileResourceSampler(): Promise<void> {
  try {
    const { enabled } = await appSettingsService.get('resourceMonitor');
    if (enabled && openSubscriptions.size > 0) startResourceSampler();
    else stopResourceSampler();
  } catch (err) {
    log.warn('resource-sampler: failed to read settings', err);
  }
}
