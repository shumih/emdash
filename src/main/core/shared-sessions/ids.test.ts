import { describe, expect, it } from 'vitest';
import { appliedSessionId, deterministicUuid, shareIdForConversation } from './ids';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deterministicUuid', () => {
  it('produces a valid RFC-4122 version-5 shaped UUID', () => {
    expect(deterministicUuid('hello')).toMatch(UUID_RE);
  });

  it('is stable for the same input and differs for different inputs', () => {
    expect(deterministicUuid('a')).toBe(deterministicUuid('a'));
    expect(deterministicUuid('a')).not.toBe(deterministicUuid('b'));
  });
});

describe('shareIdForConversation / appliedSessionId', () => {
  it('are deterministic (enabling idempotent re-share and re-apply)', () => {
    expect(shareIdForConversation('conv-1')).toBe(shareIdForConversation('conv-1'));
    expect(appliedSessionId('ref-1', 'claude')).toBe(appliedSessionId('ref-1', 'claude'));
  });

  it('separates target providers and refs', () => {
    expect(appliedSessionId('ref-1', 'claude')).not.toBe(appliedSessionId('ref-1', 'codex'));
    expect(appliedSessionId('ref-1', 'claude')).not.toBe(appliedSessionId('ref-2', 'claude'));
    expect(appliedSessionId('ref-1', 'claude')).toMatch(UUID_RE);
  });
});
