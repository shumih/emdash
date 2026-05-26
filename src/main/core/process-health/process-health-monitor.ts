import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow, type RenderProcessGoneDetails } from 'electron';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

/**
 * Process-health observability.
 *
 * Tondash's renderer leaks xterm instances and periodically dies with an
 * out-of-memory crash (V8/cppgc SIGTRAP); separately the window can hang. None
 * of this was visible before: the main logger only writes to a console nobody
 * reads in a packaged build, and the only trace was macOS .ips crash reports.
 *
 * This module makes both failure modes observable:
 *   - durable, greppable JSONL on disk at <userData>/logs/process-health.log
 *   - the existing PostHog telemetry (typed events)
 *   - the existing console logger
 *
 * It is intentionally self-contained and low-risk: it only *observes* (no
 * restarts, no mutation of app state) so it can ship ahead of the real fix.
 */

// Watchdog cadence is adaptive: cheap polling while healthy, but once memory
// enters a warning band we poll fast so the final ramp toward OOM (which can
// go from ~2GB to crash in well under 30s) is captured at high resolution.
const WATCHDOG_HEALTHY_INTERVAL_MS = 10_000;
const WATCHDOG_ELEVATED_INTERVAL_MS = 2_000;

// Renderer working-set thresholds. The observed OOM crashes peaked ~3.2 GB, so
// we warn well before that and escalate as it approaches the danger zone.
const MEMORY_WARN_MB = 2_000;
const MEMORY_CRITICAL_MB = 3_000;

// Cap the on-disk log so it can't grow unbounded; keep one rotated backup.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

type HealthRecord = Record<string, unknown> & { kind: string };

let watchdogTimer: NodeJS.Timeout | null = null;
let appHandlersInstalled = false;
let logFilePath: string | null = null;

/** Last sampled max renderer working-set (MB). Attached to crash/hang records. */
let lastRendererMemoryMb: number | null = null;
/** Highest memory band we've already reported, so we alert once per escalation. */
let reportedMemoryBand: 'none' | 'warn' | 'critical' = 'none';
let unresponsiveSince: number | null = null;

const startedAt = Date.now();

function resolveLogFilePath(): string {
  if (logFilePath) return logFilePath;
  const dir = join(app.getPath('userData'), 'logs');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort; appendRecord will surface failures
  }
  logFilePath = join(dir, 'process-health.log');
  rotateIfNeeded(logFilePath);
  return logFilePath;
}

function rotateIfNeeded(path: string): void {
  try {
    if (statSync(path).size > MAX_LOG_BYTES) {
      renameSync(path, `${path}.1`);
    }
  } catch {
    // file doesn't exist yet, or rotation failed — neither is fatal
  }
}

function appendRecord(record: HealthRecord): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
  try {
    appendFileSync(resolveLogFilePath(), `${line}\n`);
  } catch (err) {
    log.warn('process-health: failed to write health log', err);
  }
}

/**
 * Max working-set (MB) across renderer ("Tab") processes, plus how many there
 * are. Uses Electron's own metrics so it works in packaged builds without
 * extra native deps. Returns null on failure rather than throwing.
 */
function sampleRendererMemoryMb(): { maxMb: number; totalMb: number; count: number } | null {
  try {
    const metrics = app.getAppMetrics();
    let maxKb = 0;
    let totalKb = 0;
    let count = 0;
    for (const m of metrics) {
      if (m.type !== 'Tab') continue;
      count += 1;
      totalKb += m.memory.workingSetSize;
      if (m.memory.workingSetSize > maxKb) maxKb = m.memory.workingSetSize;
    }
    return {
      maxMb: Math.round(maxKb / 1024),
      totalMb: Math.round(totalKb / 1024),
      count,
    };
  } catch (err) {
    log.warn('process-health: getAppMetrics failed', err);
    return null;
  }
}

function bandFor(maxMb: number): 'none' | 'warn' | 'critical' {
  if (maxMb >= MEMORY_CRITICAL_MB) return 'critical';
  if (maxMb >= MEMORY_WARN_MB) return 'warn';
  return 'none';
}

function watchdogTick(): 'none' | 'warn' | 'critical' {
  const sample = sampleRendererMemoryMb();
  if (!sample) return 'none';
  lastRendererMemoryMb = sample.maxMb;

  const band = bandFor(sample.maxMb);
  if (band === 'none') {
    reportedMemoryBand = 'none';
    return 'none';
  }

  // While above the warning threshold, record every tick so the ramp toward
  // OOM is captured in the log.
  appendRecord({
    kind: 'memory_sample',
    band,
    renderer_max_mb: sample.maxMb,
    renderer_total_mb: sample.totalMb,
    renderer_count: sample.count,
  });

  // Escalate to telemetry only when we enter a higher band, so we don't spam.
  const escalated =
    (band === 'warn' && reportedMemoryBand === 'none') ||
    (band === 'critical' && reportedMemoryBand !== 'critical');
  if (escalated) {
    log.warn('process-health: renderer memory high', {
      level: band,
      renderer_memory_mb: sample.maxMb,
    });
    telemetryService.capture('renderer_memory_high', {
      renderer_memory_mb: sample.maxMb,
      level: band,
    });
    reportedMemoryBand = band;
  }

  return band;
}

/**
 * Self-scheduling watchdog: polls fast while memory is elevated, slow while
 * healthy. Using setTimeout (not setInterval) lets the cadence adapt each tick.
 */
function scheduleWatchdog(delayMs: number): void {
  watchdogTimer = setTimeout(() => {
    const band = watchdogTick();
    const next = band === 'none' ? WATCHDOG_HEALTHY_INTERVAL_MS : WATCHDOG_ELEVATED_INTERVAL_MS;
    scheduleWatchdog(next);
  }, delayMs);
  watchdogTimer.unref?.();
}

function onRenderProcessGone(details: RenderProcessGoneDetails): void {
  // A clean exit (e.g. normal navigation/teardown) is not a fault.
  if (details.reason === 'clean-exit') return;

  const record = {
    kind: 'render-process-gone',
    reason: details.reason,
    exit_code: details.exitCode,
    renderer_memory_mb: lastRendererMemoryMb,
    uptime_ms: Date.now() - startedAt,
  };
  appendRecord(record);
  log.error('process-health: renderer process gone', record);
  telemetryService.capture('renderer_process_gone', {
    reason: details.reason,
    exit_code: details.exitCode,
    renderer_memory_mb: lastRendererMemoryMb,
  });
  // The renderer is about to be recreated/reloaded — reset memory tracking.
  reportedMemoryBand = 'none';
  lastRendererMemoryMb = null;
}

/**
 * Wire renderer-scoped health handlers onto a window's webContents. Call this
 * for every window created (the macOS "activate" path can recreate it).
 */
export function attachRendererHealthHandlers(window: BrowserWindow): void {
  const wc = window.webContents;

  wc.on('render-process-gone', (_event, details) => onRenderProcessGone(details));

  wc.on('unresponsive', () => {
    unresponsiveSince = Date.now();
    const record = {
      kind: 'window_unresponsive',
      renderer_memory_mb: lastRendererMemoryMb,
    };
    appendRecord(record);
    log.error('process-health: window unresponsive (hang)', record);
    telemetryService.capture('window_unresponsive', {
      renderer_memory_mb: lastRendererMemoryMb,
    });
  });

  wc.on('responsive', () => {
    const hungForMs = unresponsiveSince ? Date.now() - unresponsiveSince : null;
    unresponsiveSince = null;
    appendRecord({ kind: 'window_responsive', hung_for_ms: hungForMs });
    log.info('process-health: window responsive again', { hung_for_ms: hungForMs });
  });
}

/**
 * Install app-level health handlers and start the memory watchdog. Idempotent;
 * safe to call once during app startup.
 */
export function startProcessHealthMonitor(): void {
  if (!appHandlersInstalled) {
    app.on('child-process-gone', (_event, details) => {
      // Renderer crashes arrive via webContents 'render-process-gone' (handled
      // above with richer context); this event covers GPU/utility/etc.
      const record = {
        kind: 'child-process-gone',
        process_type: details.type,
        reason: details.reason,
        exit_code: details.exitCode ?? null,
        name: details.name ?? details.serviceName ?? null,
      };
      appendRecord(record);
      log.error('process-health: child process gone', record);
      telemetryService.capture('child_process_gone', {
        process_type: details.type,
        reason: details.reason,
        exit_code: details.exitCode ?? null,
      });
    });
    appHandlersInstalled = true;
  }

  if (!watchdogTimer) {
    appendRecord({
      kind: 'monitor_started',
      interval_ms: WATCHDOG_HEALTHY_INTERVAL_MS,
      elevated_interval_ms: WATCHDOG_ELEVATED_INTERVAL_MS,
    });
    scheduleWatchdog(WATCHDOG_HEALTHY_INTERVAL_MS);
  }
}

export function stopProcessHealthMonitor(): void {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

/**
 * Append a diagnostic record to the health log from elsewhere (e.g. the
 * renderer via RPC). Used to correlate user actions (image paste, large PTY
 * output bursts) with the memory/CPU spikes the watchdog samples.
 */
export function recordHealthEvent(record: HealthRecord): void {
  appendRecord(record);
}
