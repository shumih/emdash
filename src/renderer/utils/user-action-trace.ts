import { rpc } from '@renderer/lib/ipc';

// Lightweight user-action timing. Each span emits one record at end() with the
// total duration and per-step breakdown into the process-health JSONL log
// (kind: 'user_action'), so slow paths can be diagnosed post-hoc with jq.

export type UserActionSpan = {
  step(name: string, extra?: Record<string, unknown>): void;
  end(extra?: Record<string, unknown>): void;
};

type StepRecord = {
  name: string;
  ms: number;
  cum_ms: number;
  extra?: Record<string, unknown>;
};

export function traceUserAction(
  action: string,
  metadata: Record<string, unknown> = {}
): UserActionSpan {
  const startedAt = performance.now();
  let lastStepAt = startedAt;
  const steps: StepRecord[] = [];
  let ended = false;

  return {
    step(name, extra) {
      const now = performance.now();
      const record: StepRecord = {
        name,
        ms: Math.round(now - lastStepAt),
        cum_ms: Math.round(now - startedAt),
      };
      if (extra) record.extra = extra;
      steps.push(record);
      lastStepAt = now;
    },
    end(extra) {
      if (ended) return;
      ended = true;
      const total_ms = Math.round(performance.now() - startedAt);
      void rpc.processHealth
        .record({
          kind: 'user_action',
          action,
          total_ms,
          steps,
          metadata: { ...metadata, ...(extra ?? {}) },
        })
        .catch(() => {});
    },
  };
}

/**
 * Wrap an async function in a user-action span. Auto-ends with status=ok on
 * resolve, status=error on throw. The span is passed to the callback so the
 * caller can record intermediate steps.
 */
export async function withUserActionTrace<T>(
  action: string,
  metadata: Record<string, unknown> | undefined,
  fn: (span: UserActionSpan) => Promise<T>
): Promise<T> {
  const span = traceUserAction(action, metadata ?? {});
  try {
    const result = await fn(span);
    span.end({ status: 'ok' });
    return result;
  } catch (e) {
    span.end({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
