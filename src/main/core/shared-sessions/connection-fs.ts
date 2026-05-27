import os from 'node:os';
import { and, eq } from 'drizzle-orm';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { db } from '@main/db/client';
import { conversations, tasks, workspaces, type ConversationRow } from '@main/db/schema';

export interface ConnectionFs {
  /** Filesystem rooted at the connection's home directory. */
  homeFs: FileSystemProvider;
  /** null for the local machine, otherwise the SSH connection id. */
  host: string | null;
}

/**
 * Build a home-rooted filesystem for a project's connection: local disk for
 * local projects, SFTP-over-SSH (rooted at the remote $HOME) for SSH projects.
 */
export async function resolveConnectionFs(projectId: string): Promise<ConnectionFs> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  if (project.type === 'local') {
    return { homeFs: new LocalFileSystem(os.homedir()), host: null };
  }

  const proxy = await sshConnectionManager.connect(project.connectionId);
  const ctx = new SshExecutionContext(proxy);
  const remoteHome = await resolveRemoteHome(ctx);
  return { homeFs: new SshFileSystem(proxy, remoteHome), host: project.connectionId };
}

/** Absolute working directory the task's agents ran in (its workspace path). */
export async function getTaskCwd(projectId: string, taskId: string): Promise<string> {
  const [taskRow] = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!taskRow?.workspaceId) throw new Error(`Task has no workspace: ${taskId}`);

  const [wsRow] = await db
    .select({ path: workspaces.path })
    .from(workspaces)
    .where(eq(workspaces.id, taskRow.workspaceId))
    .limit(1);
  if (!wsRow?.path) throw new Error(`Workspace has no path for task: ${taskId}`);

  return wsRow.path;
}

export async function getConversationRow(conversationId: string): Promise<ConversationRow> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) throw new Error(`Conversation not found: ${conversationId}`);
  return row;
}
