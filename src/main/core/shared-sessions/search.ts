import { getConversations } from '@main/core/conversations/getConversations';
import { getProjects } from '@main/core/projects/operations/getProjects';
import {
  isShareProvider,
  type SearchSessionsQuery,
  type ShareSummary,
} from '@shared/shared-sessions';

/**
 * Discover shareable sessions across all of the app's projects and connections
 * (local + SSH). v1 sources this from tracked conversations — those that target
 * a shareable provider (claude/codex/cursor) and have a captured provider
 * session id, so their on-disk transcript can be located when shared.
 */
export async function searchSessions(query: SearchSessionsQuery = {}): Promise<ShareSummary[]> {
  const [convs, projects] = await Promise.all([getConversations(), getProjects()]);

  const hostByProject = new Map<string, string | null>(
    projects.map((p) => [p.id, p.type === 'ssh' ? p.connectionId : null])
  );

  const text = query.text?.trim().toLowerCase();
  const providerFilter = query.providers;
  const projectFilter = query.projectIds;

  const results: ShareSummary[] = [];
  for (const c of convs) {
    if (!isShareProvider(c.providerId)) continue;
    if (!c.providerSessionId) continue;
    if (providerFilter && !providerFilter.includes(c.providerId)) continue;
    if (projectFilter && !projectFilter.includes(c.projectId)) continue;
    if (text && !c.title.toLowerCase().includes(text)) continue;

    results.push({
      provider: c.providerId,
      providerSessionId: c.providerSessionId,
      host: hostByProject.get(c.projectId) ?? null,
      projectId: c.projectId,
      taskId: c.taskId,
      conversationId: c.id,
      title: c.title,
      updatedAt: c.lastInteractedAt ?? undefined,
    });
  }

  results.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return typeof query.limit === 'number' ? results.slice(0, query.limit) : results;
}
