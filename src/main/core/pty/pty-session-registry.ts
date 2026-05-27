import { recordHealthEvent } from '@main/core/process-health/process-health-monitor';
import { events } from '@main/lib/events';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';
import type { Pty } from './pty';

export interface PtySessionMetadata {
  providerId?: AgentProviderId;
  title?: string;
  isRemote?: boolean;
}

const FLUSH_INTERVAL_MS = 16; // ~60 fps
// Per-session replay buffer. This is what a renderer gets when it (re)subscribes
// — e.g. navigating back to a task or after an app restart — so it bounds how
// much scrollback history is actually available, independent of xterm's own
// (much larger) SCROLLBACK_LINES ceiling. Kept as a single string sliced from
// the tail on overflow, so very large caps get costly under output floods; 1 MB
// (~10k typical lines) mirrors the frontend MAX_BACKLOG_BYTES.
const RING_BUFFER_CAP = 1024 * 1024; // 1 MB per session

// PTY output-throughput diagnostics. A sustained high-rate stream (a runaway
// remote process spewing stdout) floods the renderer's xterm and hangs the UI.
// This runs in the MAIN process — which stays responsive even while the
// renderer is pegged — so it reliably captures the flood (rate + a sample of
// what's streaming) to the process-health log for diagnosis.
const THROUGHPUT_WINDOW_MS = 1000;
const THROUGHPUT_REPORT_THRESHOLD = 1024 * 1024; // report when >1 MB/s
const THROUGHPUT_REPORT_COOLDOWN_MS = 2000;

export class PtySessionRegistry {
  private ptyMap: Map<string, Pty> = new Map();
  private ptyInputSubscriptions: Map<string, () => void> = new Map();
  private ringBuffers: Map<string, string> = new Map();
  private activeConsumers: Set<string> = new Set();
  private metadata: Map<string, PtySessionMetadata> = new Map();

  register(
    sessionId: string,
    pty: Pty,
    options?: { preserveBufferOnExit?: boolean; metadata?: PtySessionMetadata }
  ): void {
    const preserveBufferOnExit = options?.preserveBufferOnExit ?? false;

    // Clear any stale ring buffer and consumer from a previous PTY at this sessionId (respawn)
    this.ringBuffers.delete(sessionId);
    this.activeConsumers.delete(sessionId);
    this.metadata.delete(sessionId);
    if (options?.metadata) this.metadata.set(sessionId, options.metadata);

    this.ptyMap.set(sessionId, pty);

    let buffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    // Throughput tracking (diagnostics only).
    let windowStart = Date.now();
    let windowBytes = 0;
    let lastReportAt = 0;
    let lastSample = '';

    const flush = () => {
      if (buffer) {
        events.emit(ptyDataChannel, buffer, sessionId);
        buffer = '';
      }
      flushTimer = null;
    };

    pty.onData((data) => {
      buffer += data;
      if (!flushTimer) {
        flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
      }
      // Accumulate into ring buffer for late-connecting renderers
      let rb = (this.ringBuffers.get(sessionId) ?? '') + data;
      if (rb.length > RING_BUFFER_CAP) rb = rb.slice(-RING_BUFFER_CAP);
      this.ringBuffers.set(sessionId, rb);

      // Throughput meter: detect a flood and log rate + a short content sample.
      windowBytes += data.length;
      lastSample = data;
      const now = Date.now();
      const elapsed = now - windowStart;
      if (elapsed >= THROUGHPUT_WINDOW_MS) {
        const bytesPerSec = Math.round((windowBytes / elapsed) * 1000);
        if (
          windowBytes >= THROUGHPUT_REPORT_THRESHOLD &&
          now - lastReportAt >= THROUGHPUT_REPORT_COOLDOWN_MS
        ) {
          lastReportAt = now;
          const meta = this.metadata.get(sessionId);
          recordHealthEvent({
            kind: 'pty_throughput',
            sessionId,
            bytes_per_sec: bytesPerSec,
            provider: meta?.providerId ?? null,
            is_remote: meta?.isRemote ?? null,
            // First ~160 chars of the latest chunk, control chars escaped, so we
            // can tell apart build output / escape storms / binary garbage.
            sample: lastSample
              .slice(0, 160)
              .replace(
                /[\x00-\x1f\x7f]/g,
                (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
              ),
          });
        }
        windowStart = now;
        windowBytes = 0;
      }
    });

    pty.onExit((info) => {
      // Flush any buffered output before emitting exit
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flush();
      }
      events.emit(ptyExitChannel, info, sessionId);
      if (preserveBufferOnExit) {
        // Partial cleanup: keep ring buffer so late-connecting renderers can replay output
        this.ptyMap.delete(sessionId);
        this.ptyInputSubscriptions.get(sessionId)?.();
        this.ptyInputSubscriptions.delete(sessionId);
      } else {
        this.unregister(sessionId);
      }
    });

    const off = events.on(
      ptyInputChannel,
      (data) => {
        pty.write(data);
      },
      sessionId
    );

    this.ptyInputSubscriptions.set(sessionId, off);
  }

  unregister(sessionId: string): void {
    this.ptyMap.delete(sessionId);
    this.ptyInputSubscriptions.get(sessionId)?.();
    this.ptyInputSubscriptions.delete(sessionId);
    this.ringBuffers.delete(sessionId);
    this.activeConsumers.delete(sessionId);
    this.metadata.delete(sessionId);
  }

  get(sessionId: string): Pty | undefined {
    return this.ptyMap.get(sessionId);
  }

  /**
   * Atomically snapshot the ring buffer and register a consumer for future
   * IPC delivery. Returns the current ring buffer without deleting it.
   * Safe: runs in one synchronous tick — no PTY data can arrive between
   * snapshot and consumer registration.
   */
  subscribe(sessionId: string): string {
    const buf = this.ringBuffers.get(sessionId) ?? '';
    this.activeConsumers.add(sessionId);
    return buf;
  }

  /**
   * Remove the consumer registration for a session.
   * Called when the renderer disposes its FrontendPty.
   */
  unsubscribe(sessionId: string): void {
    this.activeConsumers.delete(sessionId);
  }

  getMetadata(sessionId: string): PtySessionMetadata | undefined {
    return this.metadata.get(sessionId);
  }

  /** Active PTYs with local OS PID; SSH entries have `pid: undefined`. */
  listActiveSessions(): Array<{
    sessionId: string;
    pid: number | undefined;
    metadata?: PtySessionMetadata;
  }> {
    const out: Array<{
      sessionId: string;
      pid: number | undefined;
      metadata?: PtySessionMetadata;
    }> = [];
    for (const [sessionId, pty] of this.ptyMap) {
      out.push({
        sessionId,
        pid: pty.getPid?.(),
        metadata: this.metadata.get(sessionId),
      });
    }
    return out;
  }
}

export const ptySessionRegistry = new PtySessionRegistry();
