import type { RpcRouter } from '@main/rpc';
import { createEventEmitter, type EmitterAdapter } from '@shared/ipc/events';
import { createRPCClient } from '@shared/ipc/rpc';

// ── RPC breadcrumb ──────────────────────────────────────────────────────────
// Keep a small ring of recent invoke channels so the stall detector can name
// what the renderer was doing right before a main-thread freeze. Cheap: one
// push per RPC, capped length. Read via getRecentRpc().
type RpcMark = { ch: string; at: number };
const rpcRing: RpcMark[] = [];
const RPC_RING_MAX = 64;

export function getRecentRpc(sinceMs: number): {
  last: string | null;
  counts: Record<string, number>;
} {
  const cutoff = Date.now() - sinceMs;
  const counts: Record<string, number> = {};
  let last: string | null = null;
  for (const m of rpcRing) {
    if (m.at < cutoff) continue;
    counts[m.ch] = (counts[m.ch] ?? 0) + 1;
    last = m.ch;
  }
  return { last, counts };
}

const invokeWithBreadcrumb = (channel: string, ...args: unknown[]): Promise<unknown> => {
  rpcRing.push({ ch: channel, at: Date.now() });
  if (rpcRing.length > RPC_RING_MAX) rpcRing.shift();
  return window.electronAPI.invoke(channel, ...args);
};

export const rpc = createRPCClient<RpcRouter>(invokeWithBreadcrumb);

function createRendererAdapter(): EmitterAdapter {
  return {
    emit: (eventName: string, data: unknown, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      window.electronAPI.eventSend(channel, data);
    },
    on: (eventName: string, cb: (data: unknown) => void, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      return window.electronAPI.eventOn(channel, cb);
    },
  };
}

export const events = createEventEmitter(createRendererAdapter());
