import { computed, makeObservable, observable, runInAction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { resourceSnapshotChannel } from '@shared/events/resourceEvents';
import type { ResourcePtyEntry, ResourceSnapshot } from '@shared/resource-monitor';

export class ResourceMonitorStore {
  snapshot: ResourceSnapshot | null = null;
  private started = false;
  private offSnapshot: (() => void) | null = null;
  private clientId = crypto.randomUUID();
  private sequence = 0;
  private subscriptionId: string | null = null;
  private refCount = 0;

  constructor() {
    makeObservable(this, {
      snapshot: observable,
      totalCpuPercent: computed,
      totalMemoryBytes: computed,
      appMemoryBytes: computed,
      agentMemoryBytes: computed,
      entryCount: computed,
    });
  }

  /**
   * Total CPU usage as a fraction of the whole machine (0 - 100+%).
   * pidusage reports each PID as % of one core; divide by core count to
   * normalize against total CPU capacity.
   */
  get totalCpuPercent(): number {
    const snap = this.snapshot;
    if (!snap || snap.cpuCount === 0) return 0;
    let sum = snap.app?.cpuPercent ?? 0;
    for (const e of snap.entries) sum += e.cpu;
    return sum / snap.cpuCount;
  }

  get totalMemoryBytes(): number {
    return this.appMemoryBytes + this.agentMemoryBytes;
  }

  get appMemoryBytes(): number {
    return this.snapshot?.app?.memoryBytes ?? 0;
  }

  get agentMemoryBytes(): number {
    if (!this.snapshot) return 0;
    let sum = 0;
    for (const e of this.snapshot.entries) sum += e.memory;
    return sum;
  }

  get entryCount(): number {
    return this.snapshot?.entries.length ?? 0;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const subscriptionId = crypto.randomUUID();
    this.subscriptionId = subscriptionId;
    void rpc.resourceMonitor.setOpen(this.clientId, subscriptionId, true, ++this.sequence);
    this.offSnapshot = events.on(resourceSnapshotChannel, (snap) => {
      runInAction(() => {
        this.snapshot = snap;
      });
    });
    rpc.resourceMonitor
      .getSnapshot()
      .then((res) => {
        if (!res?.success || !res.data) return;
        runInAction(() => {
          this.applyFetchedSnapshot(res.data);
        });
      })
      .catch(() => {});
  }

  dispose(): void {
    if (!this.started) return;
    const subscriptionId = this.subscriptionId;
    this.offSnapshot?.();
    this.offSnapshot = null;
    this.started = false;
    this.subscriptionId = null;
    if (subscriptionId) {
      void rpc.resourceMonitor.setOpen(this.clientId, subscriptionId, false, ++this.sequence);
    }
  }

  /**
   * Reference-counted entry point for consumers (command palette view, task
   * titlebar badges). The stream is opened on the first acquire and closed on
   * the last release, so multiple independent consumers don't tear down each
   * other's subscription.
   */
  acquire(): void {
    this.refCount += 1;
    if (this.refCount === 1) this.start();
  }

  release(): void {
    if (this.refCount === 0) return;
    this.refCount -= 1;
    if (this.refCount === 0) this.dispose();
  }

  async refresh(): Promise<void> {
    const res = await rpc.resourceMonitor.getSnapshot();
    if (!res?.success) return;
    runInAction(() => {
      this.applyFetchedSnapshot(res.data);
    });
  }

  private applyFetchedSnapshot(snap: ResourceSnapshot | null): void {
    if (snap && this.snapshot && this.snapshot.timestamp > snap.timestamp) return;
    this.snapshot = snap;
  }

  /** Normalized CPU% (relative to all cores) for a single entry. */
  normalizedCpu(entry: ResourcePtyEntry): number {
    if (!this.snapshot || this.snapshot.cpuCount === 0) return 0;
    return entry.cpu / this.snapshot.cpuCount;
  }

  /**
   * Aggregate resource usage for a single task (all its conversation/terminal
   * PTYs). `cpu` is normalized to all cores; `memoryBytes` is summed RSS.
   * `localCount` counts entries with a real OS pid — remote (SSH) PTYs have
   * `pid === undefined` and report 0/0, so a task with `localCount === 0` has
   * no local footprint to display.
   */
  usageForTask(
    projectId: string,
    taskId: string
  ): { cpu: number; memoryBytes: number; localCount: number; entries: ResourcePtyEntry[] } {
    const snap = this.snapshot;
    const entries = snap
      ? snap.entries.filter((e) => e.projectId === projectId && e.scopeId === taskId)
      : [];
    let cpuSum = 0;
    let memoryBytes = 0;
    let localCount = 0;
    for (const e of entries) {
      cpuSum += e.cpu;
      memoryBytes += e.memory;
      if (typeof e.pid === 'number') localCount += 1;
    }
    const cpu = snap && snap.cpuCount > 0 ? cpuSum / snap.cpuCount : 0;
    return { cpu, memoryBytes, localCount, entries };
  }
}
