import { describe, expect, it } from 'vitest';
import { extractShareRef } from './share-ref';

describe('extractShareRef', () => {
  it('passes a bare ref through', () => {
    expect(extractShareRef('abc123')).toBe('abc123');
    expect(extractShareRef('  abc123  ')).toBe('abc123');
  });

  it('takes the last path segment of a full URL', () => {
    expect(extractShareRef('http://code.d/s/abc123')).toBe('abc123');
    expect(extractShareRef('https://share.example.com/v1/sessions/xyz')).toBe('xyz');
  });

  it('strips query and fragment', () => {
    expect(extractShareRef('http://code.d/s/abc123?q=1&r=2')).toBe('abc123');
    expect(extractShareRef('http://code.d/s/abc123#frag')).toBe('abc123');
    expect(extractShareRef('http://code.d/s/abc123?q=1#frag')).toBe('abc123');
  });

  it('handles trailing slashes', () => {
    expect(extractShareRef('http://code.d/s/abc123/')).toBe('abc123');
  });

  it('falls back to the literal input when a URL has no path segment', () => {
    // Better to 404 server-side than to silently use the host as the ref.
    expect(extractShareRef('http://code.d/')).toBe('http://code.d/');
    expect(extractShareRef('http://code.d/?q=1')).toBe('http://code.d/?q=1');
  });

  it('returns empty when given empty input', () => {
    expect(extractShareRef('')).toBe('');
    expect(extractShareRef('   ')).toBe('');
  });

  it('handles refs containing dots (sha-style)', () => {
    expect(extractShareRef('JOYVBCyx0qIZqw1yr-Sqqw')).toBe('JOYVBCyx0qIZqw1yr-Sqqw');
    expect(extractShareRef('http://code.d/s/JOYVBCyx0qIZqw1yr-Sqqw')).toBe(
      'JOYVBCyx0qIZqw1yr-Sqqw'
    );
  });
});
