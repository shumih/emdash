import { getRecentRpc, rpc } from '@renderer/lib/ipc';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { log } from '@renderer/utils/logger';

// Renderer main-thread stall detector.
//
// Electron's webContents 'unresponsive' only fires after a long block (and just
// reports that it happened, not why). This catches shorter freezes too and,
// crucially, records a breadcrumb of what ran right before the stall — recent
// RPC channels, live PTY count, DOM size, heap — so the cause is greppable in
// process-health.log alongside the window_unresponsive events.
//
// Mechanism: a heartbeat timer expects to fire every HEARTBEAT_MS. If the loop
// was blocked, the actual gap exceeds that by the block duration ("lag"). When
// lag crosses STALL_THRESHOLD_MS we log a renderer_stall record.

const HEARTBEAT_MS = 500;
const STALL_THRESHOLD_MS = 750;

let longestTaskMs = 0;
let longTaskCount = 0;

function setupLongTaskObserver(): void {
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskCount += 1;
        if (entry.duration > longestTaskMs) longestTaskMs = entry.duration;
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {
    // longtask entry type unsupported — heartbeat lag alone still works.
  }
}

function heapUsedMb(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? Math.round(mem.usedJSHeapSize / (1024 * 1024)) : null;
}

let started = false;

export function startStallDetector(): void {
  if (started) return;
  started = true;
  setupLongTaskObserver();

  let expected = Date.now() + HEARTBEAT_MS;

  // When the window returns to the foreground, the previous (throttled) tick may
  // be up to ~60s old; reset the baseline so that wake-up isn't counted as a stall.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') expected = Date.now() + HEARTBEAT_MS;
  });

  setInterval(() => {
    const now = Date.now();
    const lag = now - expected;
    expected = now + HEARTBEAT_MS;

    // Only a stall while the window is visible is a real UI freeze. When the
    // window is hidden/backgrounded, Chromium throttles this timer to ~1/min,
    // which otherwise shows up as bogus ~59s "stalls". System sleep is the same
    // story. Gate on visibility so the log only contains genuine foreground hangs.
    if (lag >= STALL_THRESHOLD_MS && document.visibilityState === 'visible') {
      const { last, counts } = getRecentRpc(lag + 2000);
      void rpc.processHealth
        .record({
          kind: 'renderer_stall',
          lag_ms: Math.round(lag),
          longest_task_ms: Math.round(longestTaskMs),
          long_task_count: longTaskCount,
          last_rpc: last,
          recent_rpc: counts,
          active_ptys: FrontendPty.all.size,
          dom_nodes: document.getElementsByTagName('*').length,
          heap_used_mb: heapUsedMb(),
          path: window.location.hash || window.location.pathname,
        })
        .catch(() => {});
      log.warn('[stall] renderer main thread blocked', { lag_ms: Math.round(lag), last_rpc: last });
    }

    longestTaskMs = 0;
    longTaskCount = 0;
  }, HEARTBEAT_MS);
}
