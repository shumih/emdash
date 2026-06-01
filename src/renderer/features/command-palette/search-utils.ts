import type { SearchItem } from '@shared/search';

/**
 * Re-ranks FTS5 results in three tiers:
 *   1. Commands always come first when they match — they're intent-driven and
 *      cheaper to mis-rank than to bury under content. (Commands have no
 *      projectId, so without this tier they'd lose context-affinity to every
 *      file in the current project.)
 *   2. Items in the active project (tasks, conversations, files) ranked above
 *      out-of-project hits.
 *   3. Within a tier, BM25 (lower = better) breaks ties.
 */
export function applyContextAffinity(
  items: SearchItem[],
  context: { projectId?: string }
): SearchItem[] {
  const isCommand = (x: SearchItem) => (x.kind === 'command' ? 1 : 0);
  const inContext = (x: SearchItem) =>
    x.projectId === context.projectId && context.projectId != null ? 1 : 0;
  return [...items].sort((a, b) => {
    const cmd = isCommand(b) - isCommand(a);
    if (cmd !== 0) return cmd;
    const ctx = inContext(b) - inContext(a);
    if (ctx !== 0) return ctx;
    return a.score - b.score;
  });
}
