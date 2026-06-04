/**
 * Extract the storage `ref` from whatever the user pasted: a full share URL
 * (`http://code.d/s/abc123?x=1#frag`) or a bare ref (`abc123`).
 *
 * Strategy: try parsing as a URL and take the last non-empty path segment.
 * If parsing fails (no scheme), assume bare ref and pass through. We
 * deliberately do NOT try to recover from URL-shaped strings that lack a
 * usable path segment — better to send the literal so the server returns 404
 * than to silently use the host as the ref.
 */
export function extractShareRef(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0) return segments[segments.length - 1];
    return trimmed;
  } catch {
    return trimmed;
  }
}
