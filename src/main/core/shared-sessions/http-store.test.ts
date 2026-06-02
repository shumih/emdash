import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawBundle } from '@shared/shared-sessions';

// The module under test pulls in @main/db/client transitively (settings store)
// whose module-load opens a real SQLite DB via electron's app.getPath — crashes
// under plain Node. Stub it; the tests construct HttpSessionShareStore with
// their own resolveConfig and never touch the DB.
vi.mock('@main/db/client', () => ({ db: {}, sqlite: {} }));
vi.mock('electron', () => ({ safeStorage: {}, app: { getPath: () => '/tmp' } }));

import { HttpSessionShareStore, SessionSharingDisabledError } from './http-store';

const bundle = (): RawBundle => ({
  provider: 'claude',
  files: [{ relName: 's.jsonl', base64: 'aGV5' }],
  meta: { sourceSessionId: 'sess' },
});

function mockFetch(impl: (input: string, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(impl as typeof fetch);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('HttpSessionShareStore.save', () => {
  it('POSTs to /sessions with the bundle and returns the ref', async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchSpy = mockFetch(async (url, init) => {
      captured.url = url;
      captured.init = init;
      return jsonResponse(200, { ref: 'abc123', url: 'https://example/abc123' });
    });

    const store = new HttpSessionShareStore(async () => ({
      enabled: true,
      baseUrl: 'http://example.com/v1',
    }));
    const result = await store.save({ shareId: 'sid-1', bundle: bundle() });

    expect(result).toEqual({ ref: 'abc123', url: 'https://example/abc123' });
    expect(captured.url).toBe('http://example.com/v1/sessions');
    expect(captured.init?.method).toBe('POST');
    expect(captured.init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(captured.init?.body as string)).toEqual({
      shareId: 'sid-1',
      bundle: bundle(),
    });
    fetchSpy.mockRestore();
  });

  it('trims trailing slashes from the base URL', async () => {
    const captured: { url?: string } = {};
    mockFetch(async (url) => {
      captured.url = url;
      return jsonResponse(200, { ref: 'r' });
    });
    const store = new HttpSessionShareStore(async () => ({
      enabled: true,
      baseUrl: 'http://example.com/v1///',
    }));
    await store.save({ shareId: 's', bundle: bundle() });
    expect(captured.url).toBe('http://example.com/v1/sessions');
  });

  it('throws SessionSharingDisabledError when the kill switch is off', async () => {
    mockFetch(async () => jsonResponse(200, { ref: 'r' }));
    const store = new HttpSessionShareStore(async () => ({
      enabled: false,
      baseUrl: 'http://example.com/v1',
    }));
    await expect(store.save({ shareId: 's', bundle: bundle() })).rejects.toBeInstanceOf(
      SessionSharingDisabledError
    );
  });

  it('throws SessionSharingDisabledError when no endpoint is configured', async () => {
    const store = new HttpSessionShareStore(async () => ({ enabled: true, baseUrl: '' }));
    await expect(store.save({ shareId: 's', bundle: bundle() })).rejects.toBeInstanceOf(
      SessionSharingDisabledError
    );
  });

  it('throws on non-2xx responses', async () => {
    mockFetch(async () => new Response('nope', { status: 500, statusText: 'Server Error' }));
    const store = new HttpSessionShareStore(async () => ({
      enabled: true,
      baseUrl: 'http://example.com/v1',
    }));
    await expect(store.save({ shareId: 's', bundle: bundle() })).rejects.toThrow(/500/);
  });

  it('throws when the response omits a ref', async () => {
    mockFetch(async () => jsonResponse(200, { url: 'http://example/x' }));
    const store = new HttpSessionShareStore(async () => ({
      enabled: true,
      baseUrl: 'http://example.com/v1',
    }));
    await expect(store.save({ shareId: 's', bundle: bundle() })).rejects.toThrow(/no ref/i);
  });
});

describe('HttpSessionShareStore.get', () => {
  it('GETs /sessions/{ref}?target=<provider> and returns the converted bundle', async () => {
    const captured: { url?: string } = {};
    const expected = bundle();
    mockFetch(async (url) => {
      captured.url = url;
      return jsonResponse(200, expected);
    });
    const store = new HttpSessionShareStore(async () => ({
      enabled: true,
      baseUrl: 'http://example.com/v1',
    }));
    const result = await store.get('abc/123', { targetProvider: 'codex' });
    expect(result).toEqual(expected);
    expect(captured.url).toBe('http://example.com/v1/sessions/abc%2F123?target=codex');
  });

  it('returns null on 404 (not an error)', async () => {
    mockFetch(async () => new Response('', { status: 404 }));
    const store = new HttpSessionShareStore(async () => ({
      enabled: true,
      baseUrl: 'http://example.com/v1',
    }));
    expect(await store.get('missing', { targetProvider: 'claude' })).toBeNull();
  });

  it('throws on other non-2xx responses', async () => {
    mockFetch(async () => new Response('boom', { status: 502 }));
    const store = new HttpSessionShareStore(async () => ({
      enabled: true,
      baseUrl: 'http://example.com/v1',
    }));
    await expect(store.get('r', { targetProvider: 'claude' })).rejects.toThrow(/502/);
  });
});
