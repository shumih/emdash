import type { RawBundle } from '@shared/shared-sessions';

/**
 * Claude transcript lines each carry a top-level `sessionId`. Resuming a copy
 * under a new filename whose internal id disagrees can trip the lossy
 * respawn-fresh fallback (see RESUME_FAILURE_WINDOW_MS in local-conversation.ts),
 * so rewrite every line's `sessionId` to match the new filename. Lines that
 * don't parse as JSON are passed through untouched (preserves trailing newline).
 */
export function rewriteClaudeSessionId(bundle: RawBundle, newSessionId: string): RawBundle {
  const file = bundle.files[0];
  if (!file) throw new Error('Transcript bundle has no files');

  const text = Buffer.from(file.base64, 'base64').toString('utf8');
  const rewritten = text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (typeof obj.sessionId === 'string') obj.sessionId = newSessionId;
        return JSON.stringify(obj);
      } catch {
        return line;
      }
    })
    .join('\n');

  const base64 = Buffer.from(rewritten, 'utf8').toString('base64');
  return { ...bundle, files: [{ relName: file.relName, base64 }] };
}
