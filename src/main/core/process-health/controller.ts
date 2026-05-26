import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { recordHealthEvent } from './process-health-monitor';

export const processHealthController = createRPCController({
  /**
   * Append a renderer-side diagnostic record to the process-health log, so
   * user actions (image paste, large PTY output bursts) sit alongside the
   * main-process memory/crash samples in one greppable file.
   */
  record: (record: Record<string, unknown> & { kind: string }) => {
    recordHealthEvent(record);
    return ok();
  },
});
