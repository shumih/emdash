import { makeAutoObservable, onBecomeObserved, onBecomeUnobserved, runInAction } from 'mobx';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { log } from '@renderer/utils/logger';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

const MAX_LIVE_SESSIONS = 4;

const liveSessions = new Set<PtySession>();

function enforceLiveSessionCap(justConnected: PtySession): void {
  if (liveSessions.size <= MAX_LIVE_SESSIONS) return;
  const evictable = [...liveSessions]
    .filter((s) => s !== justConnected && !s.isObserved && s.pty)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  for (const victim of evictable) {
    if (liveSessions.size <= MAX_LIVE_SESSIONS) break;
    log.info('PtySession LRU eviction', {
      evicted: victim.sessionId,
      liveCount: liveSessions.size,
      cap: MAX_LIVE_SESSIONS,
    });
    victim.dispose();
  }
}

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';
  isObserved = false;
  lastActiveAt = Date.now();

  constructor(readonly sessionId: string) {
    makeAutoObservable(this, {
      pty: false,
      isObserved: false,
      lastActiveAt: false,
    });
    onBecomeObserved(this, 'status', () => {
      this.isObserved = true;
      this.lastActiveAt = Date.now();
      if (this.status === 'disconnected') void this.connect();
    });
    onBecomeUnobserved(this, 'status', () => {
      this.isObserved = false;
      this.lastActiveAt = Date.now();
    });
  }

  async connect() {
    if (this.pty) return;
    this.pty = new FrontendPty(this.sessionId);
    liveSessions.add(this);
    log.info('PtySession connect', {
      sessionId: this.sessionId,
      liveCount: liveSessions.size,
      totalPty: FrontendPty.all.size,
    });
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
