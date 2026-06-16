import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSshCommand } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import type { SshConnectionManagerEvent } from '@main/core/ssh/lifecycle/ssh-connection-manager';
import { subscriptionService } from '@main/core/subscriptions/subscription-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { AgentSessionConfig } from '@shared/agent-session';
import { buildProviderSessionName, type Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { listClaudeSessionIds, reconcileClaudeSessionId } from '../claude-transcript-locator';
import { setProviderSessionId } from '../setProviderSessionId';
import { buildAgentSessionCommand } from './agent-command';
import { scheduleInitialPromptInjection } from './keystroke-injection';
import { resolveProviderEnv } from './provider-env';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;

type TrackedSession = {
  conversation: Conversation;
  initialSize: { cols: number; rows: number };
};

export class SshConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private respawnCounts = new Map<string, number>();
  private trackedSessions = new Map<string, TrackedSession>();
  private readonly projectId: string;
  private readonly taskPath: string;
  private readonly taskId: string;
  private readonly taskName: string;
  private readonly taskEnvVars: Record<string, string>;
  private readonly tmux: boolean = false;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly proxy: SshClientProxy;
  private readonly connectionId: string;
  private readonly _handleReconnect: (evt: SshConnectionManagerEvent) => void;

  constructor({
    projectId,
    taskPath,
    taskId,
    taskName,
    taskEnvVars = {},
    tmux = false,
    shellSetup,
    ctx,
    proxy,
    connectionId,
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
    taskName: string;
    taskEnvVars?: Record<string, string>;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    proxy: SshClientProxy;
    connectionId: string;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.taskName = taskName;
    this.taskEnvVars = taskEnvVars;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.proxy = proxy;
    this.connectionId = connectionId;
    this._handleReconnect = (evt: SshConnectionManagerEvent) => {
      if (evt.type === 'reconnected' && evt.connectionId === this.connectionId) {
        this.rehydrate().catch((e: unknown) => {
          log.error('SshConversationProvider: rehydrate failed after reconnect', {
            taskId: this.taskId,
            connectionId: this.connectionId,
            error: String(e),
          });
        });
      }
    };
    sshConnectionManager.on('connection-event', this._handleReconnect);
  }

  async startSession(
    conversation: Conversation,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    isResuming: boolean = false,
    initialPrompt?: string
  ): Promise<void> {
    const sessionId = makePtySessionId(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    this.knownSessionIds.add(sessionId);
    this.trackedSessions.set(sessionId, { conversation, initialSize });

    if (this.sessions.has(sessionId)) return;

    await claudeTrustService.maybeAutoTrustSsh({
      providerId: conversation.providerId,
      cwd: this.taskPath,
      ctx: this.ctx,
      remoteFs: new SshFileSystem(this.proxy, '/'),
    });

    const providerConfig = await providerOverrideSettings.getItem(conversation.providerId);
    const { command, args } = buildAgentSessionCommand({
      providerId: conversation.providerId,
      providerConfig,
      autoApprove: conversation.autoApprove,
      model: conversation.model,
      reasoningEffort: conversation.reasoningEffort,
      // Resume by the real CLI session id once captured; the tondash conversation
      // id is not reliably persisted under by the CLI (see provider-session-id).
      sessionId:
        isResuming && conversation.providerSessionId
          ? conversation.providerSessionId
          : conversation.id,
      sessionName: buildProviderSessionName({
        taskName: this.taskName,
        conversationTitle: conversation.title,
        providerId: conversation.providerId,
      }),
      isResuming,
      initialPrompt,
    });
    const providerEnv = resolveProviderEnv(providerConfig, {
      providerId: conversation.providerId,
      autoApprove: conversation.autoApprove,
      extraEnv: await subscriptionService.resolveEnv(
        conversation.subscriptionId,
        conversation.providerId
      ),
    });

    const tmuxSessionName = this.tmux ? makeTmuxSessionName(sessionId) : undefined;

    const cfg: AgentSessionConfig = {
      taskId: this.taskId,
      conversationId: conversation.id,
      providerId: conversation.providerId,
      command,
      args,
      cwd: this.taskPath,
      shellSetup: this.shellSetup,
      tmuxSessionName,
      autoApprove: conversation.autoApprove ?? false,
      resume: isResuming,
    };

    const profile = await this.proxy.getRemoteShellProfile();
    const sshCommand = resolveSshCommand(
      'agent',
      cfg,
      { ...providerEnv, ...this.taskEnvVars },
      profile
    );

    // SSH sessions don't have hooks wired, so the only way to recover the real
    // Claude session id is to diff the remote transcript dir. Snapshot it before
    // the session starts writing so we can attribute the new transcript to it.
    const reconcileSessionId = conversation.providerId === 'claude';
    let remoteFs: SshFileSystem | undefined;
    let sessionIdsBefore = new Set<string>();
    if (reconcileSessionId) {
      try {
        const remoteHome = await resolveRemoteHome(this.ctx);
        remoteFs = new SshFileSystem(this.proxy, remoteHome);
        sessionIdsBefore = await listClaudeSessionIds(remoteFs, this.taskPath);
      } catch (err) {
        log.warn('SshConversationProvider: failed to snapshot remote transcripts', {
          conversationId: conversation.id,
          error: String(err),
        });
        remoteFs = undefined;
      }
    }

    const result = await openSsh2Pty(this.proxy, {
      id: sessionId,
      command: sshCommand,
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    if (!result.success) {
      log.error('SshConversationProvider: failed to open SSH channel', {
        sessionId,
        error: result.error.message,
      });
      throw new Error(result.error.message);
    }

    const pty = result.data;

    // hooks not supported yet, rely on classifier for visual indicator
    wireAgentClassifier({
      pty,
      providerId: conversation.providerId,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
    });

    pty.onExit(({ exitCode }) => {
      ptySessionRegistry.unregister(sessionId);
      const wasActive = this.sessions.has(sessionId);
      this.sessions.delete(sessionId);
      events.emit(agentSessionExitedChannel, {
        sessionId,
        projectId: conversation.projectId,
        conversationId: conversation.id,
        taskId: conversation.taskId,
        exitCode,
      });
      // When SSH is disconnected, the channel close is just collateral damage —
      // don't respawn (it would fail with SSH down). The reconnect listener
      // will call rehydrate() once SSH is back to bring this session up again.
      const shouldRespawn = wasActive && this.proxy.isConnected;
      if (shouldRespawn && !this.tmux) {
        const count = (this.respawnCounts.get(sessionId) ?? 0) + 1;
        this.respawnCounts.set(sessionId, count);

        if (count > MAX_RESPAWNS && !isResuming) {
          log.error('SshConversationProvider: respawn limit reached, giving up', {
            conversationId: conversation.id,
          });
          this.respawnCounts.delete(sessionId);
          return;
        }

        const resumeNext = isResuming && count <= MAX_RESPAWNS;
        if (count > MAX_RESPAWNS) this.respawnCounts.set(sessionId, 0);

        setTimeout(() => {
          this.startSession(conversation, initialSize, resumeNext, initialPrompt).catch((e) => {
            log.error('SshConversationProvider: respawn failed', {
              conversationId: conversation.id,
              error: String(e),
            });
          });
        }, 500);
      }
    });

    ptySessionRegistry.register(sessionId, pty, {
      metadata: { providerId: conversation.providerId, title: conversation.title, isRemote: true },
    });
    this.sessions.set(sessionId, pty);
    scheduleInitialPromptInjection({ pty, conversation, initialPrompt, isResuming });

    // Discover the real session id Claude wrote on the remote host and persist it
    // for future --resume. This is the sole capture path for SSH (no hooks).
    if (reconcileSessionId && remoteFs) {
      const fs = remoteFs;
      void reconcileClaudeSessionId({
        fs,
        cwd: this.taskPath,
        before: sessionIdsBefore,
        isAlive: () => this.sessions.get(sessionId) === pty,
        onResolved: async (realSessionId) => {
          await setProviderSessionId(conversation.id, realSessionId);
        },
      });
    }

    telemetryService.capture('agent_run_started', {
      provider: conversation.providerId,
      project_id: conversation.projectId,
      task_id: conversation.taskId,
      conversation_id: conversation.id,
    });
  }

  async stopSession(conversationId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    this.knownSessionIds.delete(sessionId);
    this.trackedSessions.delete(sessionId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('SshAgentProvider: error killing PTY', { sessionId, error: String(e) });
      }
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
    if (this.tmux) {
      await killTmuxSession(this.ctx, makeTmuxSessionName(sessionId));
    }
  }

  /**
   * Re-open SSH PTYs for tracked sessions that are no longer alive (e.g. after
   * an SSH reconnect closed all channels). Uses isResuming=true so the agent
   * picks up its previous conversation rather than starting fresh.
   */
  async rehydrate(): Promise<void> {
    const entries = Array.from(this.trackedSessions.entries());
    await Promise.all(
      entries.map(async ([sessionId, { conversation, initialSize }]) => {
        if (this.sessions.has(sessionId)) return;
        this.respawnCounts.delete(sessionId);
        await this.startSession(conversation, initialSize, true).catch((e) => {
          log.error('SshConversationProvider: rehydrate failed', {
            conversationId: conversation.id,
            error: String(e),
          });
        });
      })
    );
  }

  async destroyAll(): Promise<void> {
    sshConnectionManager.off('connection-event', this._handleReconnect);
    const sessionIds = Array.from(this.knownSessionIds);
    await this.detachAll();
    if (this.tmux) {
      await Promise.all(sessionIds.map((id) => killTmuxSession(this.ctx, makeTmuxSessionName(id))));
    }
    this.knownSessionIds.clear();
    this.trackedSessions.clear();
  }

  async detachAll(): Promise<void> {
    for (const [sessionId, pty] of this.sessions) {
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
    }
    this.sessions.clear();
  }
}
