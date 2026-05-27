import { describe, expect, it } from 'vitest';
import { extractClipboardImageFiles } from './terminal-image-paths';

function makeFile(name: string, type: string, size = 100, lastModified = 1): File {
  // jsdom File honors name/type/lastModified; size derives from the blob parts.
  return new File([new Uint8Array(size)], name, { type, lastModified });
}

function makeClipboard(files: File[]): DataTransfer {
  const items = files.map((file) => ({
    kind: 'file' as const,
    type: file.type,
    getAsFile: () => file,
  }));
  return { items } as unknown as DataTransfer;
}

describe('extractClipboardImageFiles', () => {
  it('returns image files from the clipboard', () => {
    const png = makeFile('shot.png', 'image/png');
    expect(extractClipboardImageFiles(makeClipboard([png]))).toEqual([png]);
  });

  it('ignores non-image file entries', () => {
    const doc = makeFile('notes.txt', 'text/plain');
    expect(extractClipboardImageFiles(makeClipboard([doc]))).toEqual([]);
  });

  it('dedupes the same image exposed as multiple identical entries', () => {
    const a = makeFile('shot.png', 'image/png', 100, 5);
    const b = makeFile('shot.png', 'image/png', 100, 5);
    expect(extractClipboardImageFiles(makeClipboard([a, b]))).toHaveLength(1);
  });

  it('keeps genuinely different images', () => {
    const a = makeFile('a.png', 'image/png', 100, 5);
    const b = makeFile('b.png', 'image/png', 200, 9);
    expect(extractClipboardImageFiles(makeClipboard([a, b]))).toHaveLength(2);
  });
});
