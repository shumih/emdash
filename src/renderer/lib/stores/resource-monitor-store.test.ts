import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resourceSnapshotChannel } from '@shared/events/resourceEvents';
import type { ResourcePtyEntry, ResourceSnapshot } from '@shared/resource-monitor';

const setOpen = vi.fn();
let snapshotHandler: ((snap: ResourceSnapshot) => void) | null = null;
const offSnapshot = vi.fn(() => {
  snapshotHandler = null;
});

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    resourceMonitor: {
      setOpen,
      getSnapshot: vi.fn(),
    },
  },
  events: {
    on: vi.fn((channel: typeof resourceSnapshotChannel, cb: (snap: ResourceSnapshot) => void) => {
      if (channel === resourceSnapshotChannel) snapshotHandler = cb;
      return offSnapshot;
    }),
  },
}));

function snapshot(timestamp: number): ResourceSnapshot {
  return {
    timestamp,
    cpuCount: 1,
    totalMemoryBytes: 0,
    app: { memoryBytes: 0, cpuPercent: 0 },
    appProcesses: [],
    entries: [],
  };
}

function entry(over: Partial<ResourcePtyEntry>): ResourcePtyEntry {
  return {
    sessionId: 'p:t:c',
    projectId: 'p',
    scopeId: 't',
    leafId: 'c',
    pid: 100,
    cpu: 0,
    memory: 0,
    ...over,
  };
}

describe('ResourceMonitorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotHandler = null;
  });

  it('opens once and disposes idempotently with the same subscription', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockResolvedValue({ success: true, data: null });

    const store = new ResourceMonitorStore();
    store.start();
    store.start();
    store.dispose();
    store.dispose();

    expect(setOpen).toHaveBeenCalledTimes(2);
    const clientId = setOpen.mock.calls[0]?.[0];
    const subscriptionId = setOpen.mock.calls[0]?.[1];
    expect(setOpen).toHaveBeenNthCalledWith(1, clientId, subscriptionId, true, 1);
    expect(setOpen).toHaveBeenNthCalledWith(2, clientId, subscriptionId, false, 2);
  });

  it('does not let an older fetched snapshot overwrite a newer event snapshot', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockResolvedValue({
      success: true,
      data: snapshot(1),
    });

    const store = new ResourceMonitorStore();
    store.start();
    snapshotHandler?.(snapshot(2));
    await Promise.resolve();

    expect(store.snapshot?.timestamp).toBe(2);
  });

  it('opens on first acquire and closes on last release (refcounted)', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockResolvedValue({ success: true, data: null });

    const store = new ResourceMonitorStore();
    store.acquire();
    store.acquire();
    store.release();
    // Still one consumer holding it open — no close yet.
    expect(setOpen).toHaveBeenCalledTimes(1);
    expect(setOpen).toHaveBeenNthCalledWith(1, expect.any(String), expect.any(String), true, 1);

    store.release();
    expect(setOpen).toHaveBeenCalledTimes(2);
    expect(setOpen).toHaveBeenNthCalledWith(2, expect.any(String), expect.any(String), false, 2);

    // Extra release is a no-op.
    store.release();
    expect(setOpen).toHaveBeenCalledTimes(2);
  });

  it('usageForTask sums + normalizes only matching entries', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');

    const store = new ResourceMonitorStore();
    store.snapshot = {
      ...snapshot(1),
      cpuCount: 4,
      entries: [
        entry({ sessionId: 'p:t:a', leafId: 'a', cpu: 80, memory: 100 }),
        entry({ sessionId: 'p:t:b', leafId: 'b', cpu: 40, memory: 50 }),
        entry({ sessionId: 'p:other:c', scopeId: 'other', leafId: 'c', cpu: 999, memory: 999 }),
        entry({ sessionId: 'other:t:d', projectId: 'other', leafId: 'd', cpu: 999, memory: 999 }),
      ],
    };

    const usage = store.usageForTask('p', 't');
    expect(usage.cpu).toBe(30); // (80 + 40) / 4 cores
    expect(usage.memoryBytes).toBe(150);
    expect(usage.localCount).toBe(2);
    expect(usage.entries.map((e) => e.leafId)).toEqual(['a', 'b']);
  });

  it('usageForTask treats remote (pid-less) entries as no local footprint', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');

    const store = new ResourceMonitorStore();
    store.snapshot = {
      ...snapshot(1),
      entries: [entry({ pid: undefined, cpu: 0, memory: 0 })],
    };

    const usage = store.usageForTask('p', 't');
    expect(usage.localCount).toBe(0);
    expect(usage.entries).toHaveLength(1);
  });

  it('does not let refresh overwrite a newer snapshot', async () => {
    const { ResourceMonitorStore } = await import('./resource-monitor-store');
    const { rpc } = await import('@renderer/lib/ipc');
    let resolveSnapshot!: (value: { success: true; data: ResourceSnapshot }) => void;
    vi.mocked(rpc.resourceMonitor.getSnapshot).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      })
    );

    const store = new ResourceMonitorStore();
    const refreshing = store.refresh();
    store.snapshot = snapshot(2);
    resolveSnapshot({ success: true, data: snapshot(1) });
    await refreshing;

    expect(store.snapshot?.timestamp).toBe(2);
  });
});
