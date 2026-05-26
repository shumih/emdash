import { makeAutoObservable, onBecomeObserved, onBecomeUnobserved, runInAction } from 'mobx';
import { FrontendPty } from '@renderer/lib/pty/pty';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

/*
 * Global cap on the number of live FrontendPty (xterm) instances across every
 * conversation, terminal, and lifecycle-script session.
 *
 * Each xterm pins its scrollback in renderer memory for as long as it's live,
 * and sessions are NOT freed when switched away (only the active one is
 * rendered; the rest sit parked). Without a cap, every chat/terminal you ever
 * open accumulates a live xterm until its tab is closed — the unbounded growth
 * behind the renderer OOM crashes.
 *
 * When the cap is exceeded we dispose the least-recently-used session that is
 * not currently being viewed. Disposal only unsubscribes the renderer (the
 * main-process PTY keeps running and buffering); revisiting the session
 * reconnects lazily from the ring buffer via onBecomeObserved. This is the same
 * proven seam as closing a tab, just triggered by memory pressure instead.
 *
 * The cap is generous relative to how many sessions can be on screen at once
 * (split panes), so normal use never evicts — only hoarding dozens of open
 * sessions does.
 */
const MAX_LIVE_SESSIONS = 12;

const liveSessions = new Set<PtySession>();

function enforceLiveSessionCap(justConnected: PtySession): void {
  if (liveSessions.size <= MAX_LIVE_SESSIONS) return;
  // Evict only parked (unobserved) sessions, oldest-parked first; never the one
  // we just connected, and never a session currently on screen.
  const evictable = [...liveSessions]
    .filter((s) => s !== justConnected && !s.isObserved && s.pty)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  for (const victim of evictable) {
    if (liveSessions.size <= MAX_LIVE_SESSIONS) break;
    victim.dispose();
  }
}

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';
  /** True while an observer (i.e. a rendered, active pane) is reading `status`. */
  isObserved = false;
  /** Timestamp of the last observe/unobserve transition — drives LRU eviction. */
  lastActiveAt = Date.now();

  constructor(readonly sessionId: string) {
    makeAutoObservable(this, {
      pty: false,
      isObserved: false,
      lastActiveAt: false,
    });
    // Lazy connect: auto-connects the first time any observer reads status.
    // Sessions are created at data-load time without connecting; this fires
    // when the session is first rendered as the active conversation or terminal.
    onBecomeObserved(this, 'status', () => {
      this.isObserved = true;
      this.lastActiveAt = Date.now();
      if (this.status === 'disconnected') void this.connect();
    });
    // When the pane is switched away, the session is parked but kept alive.
    // Mark it as evictable so the LRU cap can reclaim its xterm under pressure.
    onBecomeUnobserved(this, 'status', () => {
      this.isObserved = false;
      this.lastActiveAt = Date.now();
    });
  }

  async connect() {
    if (this.pty) return;
    this.pty = new FrontendPty(this.sessionId);
    liveSessions.add(this);
    enforceLiveSessionCap(this);
    runInAction(() => {
      this.status = 'connecting';
    });
    await this.pty.connect();
    runInAction(() => {
      this.status = 'ready';
    });
  }

  dispose() {
    liveSessions.delete(this);
    this.pty?.dispose();
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
    });
  }
}
