// `sudo` (allow-list from mode.sudoers) and `vault open <file> <passphrase>`.
import { createHash, timingSafeEqual } from 'node:crypto';
import { renderTokens, resolvePath } from '../vfs.js';
import { openOperand, parseArgs } from './util.js';

const DENIED = 'guest is not in the sudoers file. This incident will be reported.\n';
const BIN_PATH = /^\/(?:usr\/)?(?:local\/)?s?bin\/([^/]+)$/;

function entriesOf(mode) {
  const list = Array.isArray(mode.sudoers) ? mode.sudoers : [];
  return list.filter((entry) => entry && typeof entry.cmd === 'string' && entry.cmd !== '');
}

const baseName = (cmd) => (cmd.includes('/') ? (BIN_PATH.exec(cmd)?.[1] ?? cmd.slice(cmd.lastIndexOf('/') + 1)) : cmd);

function allowed(c, entry, cmd, args) {
  if (baseName(entry.cmd) !== baseName(cmd)) return false;
  if (!entry.pathPrefix) return true;
  const paths = args.filter((arg) => !arg.startsWith('-'));
  if (paths.length === 0) return false;
  return paths.every((arg) => `${resolvePath(c.rc.cwd, arg, c.rc.home)}/`.startsWith(entry.pathPrefix.endsWith('/') ? entry.pathPrefix : `${entry.pathPrefix}/`));
}

async function sudo(c) {
  const parsed = parseArgs(c.args, { flags: 'lnkvSEHVbis', values: 'ugCph', stopAtOperand: true, long: { list: 'l', 'non-interactive': 'n', user: 'u' } });
  if (parsed.error) {
    c.err(`sudo: ${parsed.error}\nusage: sudo [-lnE] [-u user] command\n`);
    return 1;
  }
  const { opts, operands } = parsed;
  const entries = entriesOf(c.rc.mode);
  if (opts.l) {
    if (entries.length === 0) { c.err(`Sorry, user ${c.rc.user} may not run sudo on ${c.rc.host}.\n`); return 1; }
    const lines = entries.map((entry) => {
      const path = entry.cmd.includes('/') ? entry.cmd : `/usr/bin/${entry.cmd}`;
      const prefix = entry.pathPrefix ? ` ${entry.pathPrefix.endsWith('/') ? entry.pathPrefix : `${entry.pathPrefix}/`}*` : '';
      return `    (root) NOPASSWD: ${path}${prefix}`;
    });
    c.out([
      `Matching Defaults entries for ${c.rc.user} on ${c.rc.host}:`,
      '    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin',
      '',
      `User ${c.rc.user} may run the following commands on ${c.rc.host}:`,
      ...lines, '',
    ].join('\n'));
    return 0;
  }
  if (opts.u && opts.u !== 'root') { c.err(`sudo: unknown user ${opts.u}\n`); return 1; }
  if (operands.length === 0) { c.err('usage: sudo [-lnE] [-u user] command\n'); return 1; }
  const [cmd, ...args] = operands;
  if (c.rc.fs.user !== 'root' && !entries.some((entry) => allowed(c, entry, cmd, args))) {
    c.err(DENIED);
    return 1;
  }
  const child = Object.create(c.rc);
  child.fs = c.rc.fs.withUser('root', 'root');
  child.user = 'root';
  const result = await c.rc.runCommand(child, cmd, args, c.stdin, c.tty);
  c.relay(result);
  return result.exit;
}

const digest = (text) => createHash('sha256').update(String(text)).digest();

function vault(c) {
  const [sub, ...rest] = c.args;
  if (sub !== 'open' || rest.length !== 2) {
    c.err('usage: vault open <file> <passphrase>\n');
    return 2;
  }
  const [target, passphrase] = rest;
  const found = openOperand(c, 'vault', target);
  if (!found) return 1;
  if (found.node.type === 'dir') { c.err(`vault: ${target}: Is a directory\n`); return 1; }
  if (!c.rc.fs.canRead(found.node)) { c.err(`vault: ${target}: Permission denied\n`); return 1; }
  const secret = found.node.vault;
  if (!secret) { c.err(`vault: ${target}: not a vault file\n`); return 1; }
  // The stored passphrase may hold seed tokens (a different one per team): render it before comparing.
  const expected = renderTokens(secret.passphrase, c.rc.flag);
  if (!timingSafeEqual(digest(passphrase), digest(expected))) {
    c.err('vault: wrong passphrase\n');
    return 1;
  }
  const plain = renderTokens(secret.plain, c.rc.flag);
  c.out(plain.endsWith('\n') ? plain : `${plain}\n`);
  return 0;
}

export const commands = { sudo, vault };
