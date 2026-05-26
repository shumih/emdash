import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { events, rpc } from '@renderer/lib/ipc';
import { cssColorToHex, cssVar } from '@renderer/utils/cssVars';
import { log } from '@renderer/utils/logger';
import { ptyDataChannel } from '@shared/events/ptyEvents';
import { buildTerminalFontFamily } from './terminal-font';
import { ensureXtermHost } from './xterm-host';

const SCROLLBACK_LINES = 100_000;

// ── Theme helpers ─────────────────────────────────────────────────────────────

export interface SessionTheme {
  override?: ITerminalOptions['theme'];
}

export function readXtermCssVars(): ITerminalOptions['theme'] {
  const color = (name: string) => cssColorToHex(cssVar(name));
  return {
    background: color('--xterm-bg'),
    foreground: color('--xterm-fg'),
    cursor: color('--xterm-cursor'),
    cursorAccent: color('--xterm-cursor-accent'),
    selectionBackground: color('--xterm-selection-bg'),
    selectionForeground: color('--xterm-selection-fg'),
  };
}

export function buildTheme(theme?: SessionTheme): ITerminalOptions['theme'] {
  if (theme?.override) return { ...readXtermCssVars(), ...theme.override };
  return readXtermCssVars();
}

// ── FrontendPty ───────────────────────────────────────────────────────────────

/**
 * Frontend counterpart to the main-process Pty interface.
 *
 * Owns the xterm Terminal instance for the full lifetime of the session.
 * The terminal is created synchronously during construction and opened into
 * an off-screen container. Call connect() to subscribe to the main-process
 * ring buffer and live IPC events — this writes historical output directly
 * to xterm and sets up ongoing data delivery without any renderer-side buffer.
 *
 * DOM management is handled via mount() / unmount():
 *  - mount()   → appends ownedContainer to the visible mount target
 *  - unmount() → moves ownedContainer back to the off-screen host
 *
 * Lifecycle: created and owned by PtySession (stores/pty-session.ts), one per
 * live session. Survives React component unmounts (e.g. navigating away from a
 * task), and is disposed only when the entity (terminal or conversation) is
 * explicitly deleted.
 */
export class FrontendPty {
  /** All live FrontendPty instances — used for app-wide operations (e.g. theme updates). */
  static readonly all = new Set<FrontendPty>();
  readonly terminal: Terminal;
  readonly ownedContainer: HTMLDivElement;
  private theme?: SessionTheme;
  private offData: (() => void) | null = null;
  /**
   * Whether this terminal is currently mounted in the visible DOM. Live PTY
   * output is only parsed into xterm while active; while parked off-screen we
   * buffer raw output (cheap) and flush it on remount. This keeps the main
   * thread from parsing+rendering output for terminals the user can't see —
   * the cause of the UI hang with several streaming background agents.
   */
  private active = true;
  private backlog: string[] = [];
  private backlogBytes = 0;
  /** Drop the oldest buffered output past this; the user has RAM, but not infinite. */
  private static readonly MAX_BACKLOG_BYTES = 8 * 1024 * 1024;
  /** True once backlog overflow forced us to drop output → reset xterm before flush. */
  private backlogTruncated = false;
  // ── PTY output-burst diagnostics ──────────────────────────────────────────
  // A large burst of output into the active terminal (e.g. an agent dumping a
  // file/image back after a paste) is the prime suspect for the memory spikes.
  // Record one diagnostic per window when throughput crosses the threshold.
  private burstBytes = 0;
  private burstStartedAt = 0;
  private burstReported = false;
  private static readonly BURST_WINDOW_MS = 2000;
  private static readonly BURST_THRESHOLD_BYTES = 2 * 1024 * 1024;
  /** Last { cols, rows } sent to rpc.pty.resize(). Used by PaneSizingContext to skip redundant IPC calls. */
  lastSentDims: { cols: number; rows: number } | null = null;

  constructor(
    readonly sessionId: string,
    theme?: SessionTheme
  ) {
    this.theme = theme;
    this.ownedContainer = document.createElement('div');
    Object.assign(this.ownedContainer.style, {
      width: '100%',
      height: '100%',
    });

    this.terminal = new Terminal({
      cols: 120,
      rows: 32,
      scrollback: SCROLLBACK_LINES,
      convertEol: true,
      fontFamily: buildTerminalFontFamily(),
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      allowProposedApi: true,
      scrollOnUserInput: false,
      linkHandler: {
        activate: (_event: MouseEvent, text: string) => {
          rpc.app.openExternal(text).catch((error) => {
            log.warn('FrontendPty: failed to open external link', { text, error });
          });
        },
      },
      theme: buildTheme(theme),
    });

    // Keep xterm on its DOM renderer: CanvasAddon repaints the full canvas on resize,
    // which makes panel/sidebar transitions visibly flicker.

    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      rpc.app.openExternal(uri).catch(() => {});
    });

    this.terminal.loadAddon(webLinksAddon);
    this.terminal.open(this.ownedContainer);

    const el = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.backgroundColor = 'transparent';
    }

    ensureXtermHost().appendChild(this.ownedContainer);
    FrontendPty.all.add(this);
  }

  setTheme(theme?: SessionTheme): void {
    this.theme = theme;
    this.terminal.options.theme = buildTheme(theme);
  }

  refreshTheme(): void {
    this.terminal.options.theme = buildTheme(this.theme);
  }

  /**
   * Subscribe to the session: fetches the ring buffer from the main process,
   * writes it directly to xterm, then sets up a live IPC listener for future
   * data. Marks status as 'ready' once complete.
   *
   * The main process guarantees atomicity: subscribe() snapshots the ring
   * buffer and registers the consumer in one synchronous tick, so no data
   * can slip between the snapshot and the first live IPC event.
   */
  async connect(): Promise<void> {
    const result = await rpc.pty.subscribe(this.sessionId);
    const historical = result.success ? result.data.buffer : '';
    if (historical) this.terminal.write(historical);
    this.offData = events.on(
      ptyDataChannel,
      (data: string) => {
        this.trackOutputBurst(data.length);
        if (this.active) {
          this.terminal.write(data);
        } else {
          this.bufferWhileInactive(data);
        }
      },
      this.sessionId
    );
  }

  /**
   * Append ownedContainer to a visible mount target.
   * If targetDims are provided the terminal is resized BEFORE the appendChild
   * to eliminate the flash caused by a post-mount resize.
   */
  /**
   * Buffer raw PTY output while the terminal is parked off-screen instead of
   * parsing it into xterm. Bounded so a runaway background stream can't grow
   * without limit; on overflow we drop the oldest bytes and reset on flush.
   */
  private bufferWhileInactive(data: string): void {
    this.backlog.push(data);
    this.backlogBytes += data.length;
    while (this.backlogBytes > FrontendPty.MAX_BACKLOG_BYTES && this.backlog.length > 1) {
      const dropped = this.backlog.shift();
      if (dropped) this.backlogBytes -= dropped.length;
      this.backlogTruncated = true;
    }
  }

  /**
   * Diagnostic: detect a large burst of PTY output (the suspected trigger for
   * the renderer memory spikes — e.g. an agent echoing an image/file). Fires at
   * most once per window, recorded to the process-health log for correlation.
   */
  private trackOutputBurst(len: number): void {
    const now = Date.now();
    if (now - this.burstStartedAt > FrontendPty.BURST_WINDOW_MS) {
      this.burstStartedAt = now;
      this.burstBytes = 0;
      this.burstReported = false;
    }
    this.burstBytes += len;
    if (!this.burstReported && this.burstBytes >= FrontendPty.BURST_THRESHOLD_BYTES) {
      this.burstReported = true;
      const bytes = this.burstBytes;
      void rpc.processHealth
        .record({
          kind: 'pty_burst',
          sessionId: this.sessionId,
          bytes_in_window: bytes,
          window_ms: FrontendPty.BURST_WINDOW_MS,
          active: this.active,
          scrollback_lines: this.terminal.buffer.active.length,
        })
        .catch(() => {});
    }
  }

  /** Write everything buffered while inactive into xterm in a single batch. */
  private flushBacklog(): void {
    if (this.backlog.length === 0) return;
    const pending = this.backlog.join('');
    this.backlog = [];
    this.backlogBytes = 0;
    // If we had to drop output, the buffer is no longer continuous with what's
    // on screen — reset so the user sees a clean, current view rather than a
    // torn one. Otherwise append, preserving existing scrollback.
    if (this.backlogTruncated) {
      this.backlogTruncated = false;
      this.terminal.reset();
    }
    this.terminal.write(pending);
  }

  mount(mountTarget: HTMLElement, targetDims?: { cols: number; rows: number }): void {
    this.active = true;
    if (
      targetDims &&
      (this.terminal.cols !== targetDims.cols || this.terminal.rows !== targetDims.rows)
    ) {
      this.terminal.resize(targetDims.cols, targetDims.rows);
    }
    mountTarget.appendChild(this.ownedContainer);
    // Catch up on output that streamed while this terminal was off-screen,
    // now that it's sized and in the visible DOM.
    this.flushBacklog();
    // Force a Canvas2D repaint after reparenting in the DOM.
    const t = this.terminal;
    requestAnimationFrame(() => {
      try {
        if ((t as unknown as { _isDisposed?: boolean })._isDisposed) return;
        t.refresh(0, t.rows - 1);
      } catch {}
    });
  }

  /**
   * Move ownedContainer back to the off-screen host (tab deactivated /
   * TerminalPane unmounting).  Must be called after all ResizeObservers on
   * the visible mount target have been disconnected.
   */
  unmount(): void {
    // Going off-screen: stop parsing live output into xterm; buffer it instead.
    this.active = false;
    ensureXtermHost().appendChild(this.ownedContainer);
  }

  /**
   * Permanently dispose this session (terminal or conversation deleted).
   * Unsubscribes from the main process, tears down the IPC data listener,
   * disposes the xterm Terminal, and removes the owned container from the DOM.
   */
  dispose(): void {
    FrontendPty.all.delete(this);
    this.offData?.();
    this.offData = null;
    this.backlog = [];
    this.backlogBytes = 0;
    rpc.pty.unsubscribe(this.sessionId).catch(() => {});
    try {
      this.terminal.dispose();
    } catch {}
    try {
      this.ownedContainer.remove();
    } catch {}
  }
}

// ── App-wide helpers ──────────────────────────────────────────────────────────

/** Apply a theme to all live terminals. Called on app-level theme change. */
export function applyThemeToAll(theme?: SessionTheme): void {
  for (const pty of FrontendPty.all) {
    if (theme) {
      pty.setTheme(theme);
    } else {
      pty.refreshTheme();
    }
  }
}

/** Dispose all live FrontendPty instances. Called on app teardown. */
export function disposeAllPtys(): void {
  for (const pty of [...FrontendPty.all]) {
    pty.dispose();
  }
}
