import { describe, expect, it } from 'vitest';
import type { RawBundle } from '@shared/shared-sessions';
import { rewriteClaudeSessionId } from './fork-transcript';

function bundle(text: string): RawBundle {
  return {
    provider: 'claude',
    files: [{ relName: 'old.jsonl', base64: Buffer.from(text, 'utf8').toString('base64') }],
    meta: { sourceSessionId: 'old' },
  };
}

function decode(b: RawBundle): string {
  return Buffer.from(b.files[0].base64, 'base64').toString('utf8');
}

describe('rewriteClaudeSessionId', () => {
  it('rewrites the sessionId on every JSON line', () => {
    const text = [
      JSON.stringify({ type: 'user', sessionId: 'old', uuid: 'a' }),
      JSON.stringify({ type: 'assistant', sessionId: 'old', uuid: 'b' }),
    ].join('\n');

    const out = decode(rewriteClaudeSessionId(bundle(text), 'new'));
    const lines = out.split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(lines.every((l) => l.sessionId === 'new')).toBe(true);
    expect(lines.map((l) => l.uuid)).toEqual(['a', 'b']);
  });

  it('preserves a trailing newline', () => {
    const text = `${JSON.stringify({ sessionId: 'old' })}\n`;
    const out = decode(rewriteClaudeSessionId(bundle(text), 'new'));
    expect(out.endsWith('\n')).toBe(true);
  });

  it('passes through lines that are not valid JSON', () => {
    const text = ['not json', JSON.stringify({ sessionId: 'old' })].join('\n');
    const out = decode(rewriteClaudeSessionId(bundle(text), 'new'));
    const [first, second] = out.split('\n');
    expect(first).toBe('not json');
    expect((JSON.parse(second) as { sessionId: string }).sessionId).toBe('new');
  });

  it('leaves lines without a sessionId untouched', () => {
    const text = JSON.stringify({ type: 'summary', uuid: 'x' });
    const out = decode(rewriteClaudeSessionId(bundle(text), 'new'));
    expect(JSON.parse(out)).toEqual({ type: 'summary', uuid: 'x' });
  });
});
