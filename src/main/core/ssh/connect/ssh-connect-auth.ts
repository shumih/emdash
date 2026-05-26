// Auth assembly: password, key, and agent selection with IdentitiesOnly filtering.
import ssh2, {
  type ConnectConfig,
  type IdentityCallback,
  type ParsedKey,
  type PublicKeyEntry,
  type SignCallback,
  type SigningRequestOptions,
} from 'ssh2';
import type { SshConfig } from '@shared/ssh';
import {
  resolveAgentSocketFromResolved,
  type ResolvedSshConfig,
} from '../config/resolve-ssh-config';
import type { SshConnectDeps, SshConnectInput } from './resolve-ssh-connect-config';

// NOTE: `BaseAgent` must be pulled off the runtime namespace (not imported as a
// type-only symbol). ssh2 gates custom agents with `agent instanceof BaseAgent`, so an
// agent that only structurally implements the interface is silently discarded.
const { utils, BaseAgent } = ssh2;

export interface AuthResult {
  config: Partial<ConnectConfig>;
  agentSocketPath?: string;
}

function expandTilde(filePath: string): string {
  if (filePath === '~') return process.env.HOME ?? filePath;
  if (filePath.startsWith('~/')) return `${process.env.HOME ?? ''}${filePath.slice(1)}`;
  return filePath;
}

type AgentPublicKey = ParsedKey | Buffer | string | PublicKeyEntry;

function comparablePublicKey(key: AgentPublicKey): ParsedKey | Buffer | string {
  if (typeof key === 'object' && 'pubKey' in key) {
    const pubKey = key.pubKey;
    if (typeof pubKey === 'object' && 'pubKey' in pubKey) {
      return pubKey.pubKey;
    }
    return pubKey;
  }
  return key;
}

class IdentityFilteredAgent extends BaseAgent {
  readonly kind = 'identity-filtered-agent';
  declare getStream?: InstanceType<typeof BaseAgent>['getStream'];

  constructor(
    readonly socketPath: string,
    private readonly agent: InstanceType<typeof BaseAgent>,
    private readonly allowedKeys: ParsedKey[]
  ) {
    super();
    if (agent.getStream) {
      this.getStream = agent.getStream.bind(agent);
    }
  }

  getIdentities(callback: IdentityCallback): void {
    this.agent.getIdentities((error, keys) => {
      if (error) {
        callback(error);
        return;
      }
      callback(
        undefined,
        keys?.filter((key) =>
          this.allowedKeys.some((allowedKey) => allowedKey.equals(comparablePublicKey(key)))
        ) ?? []
      );
    });
  }

  sign(
    pubKey: string | Buffer | ParsedKey,
    data: Buffer,
    optionsOrCallback?: SigningRequestOptions | SignCallback,
    callback?: SignCallback
  ): void {
    if (typeof optionsOrCallback === 'function') {
      this.agent.sign(pubKey, data, optionsOrCallback);
      return;
    }
    this.agent.sign(pubKey, data, optionsOrCallback ?? {}, callback);
  }
}

async function readIdentityKey(path: string, deps: SshConnectDeps): Promise<ParsedKey | undefined> {
  const data = await deps.readFile(expandTilde(path), 'utf-8').catch(() => undefined);
  if (!data) return undefined;
  const parsed = utils.parseKey(data);
  return parsed instanceof Error ? undefined : parsed;
}

async function readIdentityKeys(paths: string[], deps: SshConnectDeps): Promise<ParsedKey[]> {
  const keys: ParsedKey[] = [];
  for (const path of paths) {
    const publicKey = await readIdentityKey(`${path}.pub`, deps);
    const key = publicKey ?? (await readIdentityKey(path, deps));
    if (key) keys.push(key);
  }
  return keys;
}

/**
 * Returns the contents of the first IdentityFile that holds a usable on-disk private key.
 *
 * OpenSSH with `IdentitiesOnly yes` signs with the configured IdentityFile directly when the
 * agent does not hold that key. We mirror that by offering the on-disk key alongside the agent,
 * so connections still succeed when the resolved IdentityAgent (e.g. 1Password) lacks the key.
 */
async function readFirstIdentityPrivateKey(
  paths: string[],
  deps: SshConnectDeps
): Promise<string | undefined> {
  for (const path of paths) {
    const data = await deps.readFile(expandTilde(path), 'utf-8').catch(() => undefined);
    if (!data) continue;
    const parsed = utils.parseKey(data);
    if (!(parsed instanceof Error) && parsed.isPrivateKey()) return data;
  }
  return undefined;
}

export async function resolveManualAgentSshConfig(
  host: string,
  deps: SshConnectDeps
): Promise<ResolvedSshConfig | undefined> {
  const direct = await deps.resolveSshConfig(host).catch(() => undefined);
  if (direct) {
    const agentSocket = resolveAgentSocketFromResolved(direct, deps.env);
    if (agentSocket.kind !== 'unset') return direct;
  }

  return (await deps.findSshConfigByHostName(host).catch(() => undefined)) ?? direct;
}

export async function buildAuthConfig(
  input: SshConnectInput,
  base: SshConfig,
  resolved: ResolvedSshConfig | undefined,
  deps: SshConnectDeps
): Promise<AuthResult> {
  switch (base.authType) {
    case 'password': {
      const password =
        input.kind === 'transient' ? input.config.password : await deps.getPassword(input.row.id);
      if (!password) throw new Error(`No password found for SSH connection '${base.name}'`);
      return { config: { password } };
    }

    case 'key': {
      const keyPath = base.privateKeyPath?.trim() || resolved?.identityFile[0];
      if (!keyPath)
        throw new Error(`Private key path is required for SSH connection '${base.name}'`);
      const privateKey = await deps.readFile(expandTilde(keyPath), 'utf-8');
      const passphrase =
        input.kind === 'transient'
          ? input.config.passphrase
          : await deps.getPassphrase(input.row.id);
      return { config: { privateKey, ...(passphrase ? { passphrase } : {}) } };
    }

    case 'agent': {
      const agentSocket = resolved
        ? resolveAgentSocketFromResolved(resolved, deps.env)
        : { kind: 'unset' as const };
      const agent =
        agentSocket.kind === 'socket'
          ? agentSocket.path
          : agentSocket.kind === 'disabled'
            ? undefined
            : deps.env.SSH_AUTH_SOCK;
      if (agentSocket.kind === 'disabled') {
        throw new Error(`SSH agent is disabled by SSH config for connection '${base.name}'`);
      }
      if (!agent) throw new Error(`SSH agent socket not found for connection '${base.name}'`);
      if (resolved?.identitiesOnly && resolved.identityFile.length > 0) {
        const identityKeys = await readIdentityKeys(resolved.identityFile, deps);
        const onDiskPrivateKey = await readFirstIdentityPrivateKey(resolved.identityFile, deps);
        if (identityKeys.length === 0 && !onDiskPrivateKey) {
          throw new Error(
            `IdentitiesOnly is enabled, but no IdentityFile keys could be loaded for SSH connection '${base.name}'`
          );
        }
        const passphrase = onDiskPrivateKey
          ? input.kind === 'transient'
            ? input.config.passphrase
            : await deps.getPassphrase(input.row.id)
          : undefined;
        return {
          config: {
            // Filtered agent for IdentityFile keys the agent actually holds, plus the on-disk
            // private key so keys absent from the agent still authenticate (OpenSSH parity).
            ...(identityKeys.length > 0
              ? { agent: new IdentityFilteredAgent(agent, deps.createAgent(agent), identityKeys) }
              : {}),
            ...(onDiskPrivateKey
              ? { privateKey: onDiskPrivateKey, ...(passphrase ? { passphrase } : {}) }
              : {}),
          },
          agentSocketPath: agent,
        };
      }
      return { config: { agent }, agentSocketPath: agent };
    }
  }
}
