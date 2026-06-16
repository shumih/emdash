import { recordHealthEvent } from '@main/core/process-health/process-health-monitor';

// Main-process mirror of the renderer user-action-trace. Records a single
// `kind: 'user_action'` line with total + per-step timing into the
// process-health JSONL log, so renderer-side spans and main-side spans live
// in the same greppable file.

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
      recordHealthEvent({
        kind: 'user_action',
        action,
        total_ms,
        steps,
        metadata: { ...metadata, ...(extra ?? {}), source: 'main' },
      });
    },
  };
}

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
