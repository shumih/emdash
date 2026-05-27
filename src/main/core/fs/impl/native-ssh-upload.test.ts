import { describe, expect, it } from 'vitest';
import { buildNativeSshArgs, type NativeSshUploadTarget } from './native-ssh-upload';

const base: NativeSshUploadTarget = { host: 'dev.internal', port: 22, username: 'tony' };

describe('buildNativeSshArgs', () => {
  it('uses the config alias as the destination when present', () => {
    const args = buildNativeSshArgs({ ...base, alias: 'dev-server' }, 'cat > /tmp/x');
    expect(args.slice(-3)).toEqual(['--', 'dev-server', 'cat > /tmp/x']);
    expect(args).toContain('-l');
    expect(args[args.indexOf('-l') + 1]).toBe('tony');
  });

  it('falls back to the raw host when there is no alias', () => {
    const args = buildNativeSshArgs(base, 'cat > /tmp/x');
    expect(args.slice(-3)).toEqual(['--', 'dev.internal', 'cat > /tmp/x']);
  });

  it('pins the authenticated port', () => {
    const args = buildNativeSshArgs({ ...base, port: 2222 }, 'cat');
    expect(args[args.indexOf('-p') + 1]).toBe('2222');
  });

  it('stays non-interactive and reuses connections', () => {
    const args = buildNativeSshArgs(base, 'cat').join(' ');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('ControlMaster=auto');
    expect(args).toContain('-C');
  });

  it('adds an explicit jump host only without an alias', () => {
    const withAlias = buildNativeSshArgs({ ...base, alias: 'dev', proxyJump: 'bastion' }, 'cat');
    expect(withAlias).not.toContain('-J');

    const withoutAlias = buildNativeSshArgs({ ...base, proxyJump: 'bastion' }, 'cat');
    expect(withoutAlias[withoutAlias.indexOf('-J') + 1]).toBe('bastion');
  });
});
