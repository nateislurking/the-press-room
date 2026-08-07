// contained-spawn.mjs — the shop's ONE contained model-spawn primitive.
//
// A model stage in this repo (picking the day's beats, writing the issue, composing a reply) runs
// inside a jail whose entire world is a single folder you hand it. It lives here, shared, on purpose:
// two copies of a security boundary drift, and the copy nobody remembers to harden is the one that
// lets something out. One jail, many callers, one place to fix.
//
// TWO INDEPENDENT LAYERS, because measurement showed one is not enough:
//
//   LAYER 1 — TOOL SCOPE (`--tools`). The agent gets only the tools you name. Measured: `--tools`
//     removes a tool from the built-in set outright (Bash/WebFetch come back "tool not available",
//     not "denied"), and headless `-p` denies anything un-allowlisted with no card to approve.
//
//   LAYER 2 — KERNEL FILESYSTEM FENCE (bubblewrap). Tool scope alone does NOT confine the
//     filesystem: a Read-only agent will read a file in its parent directory on the first try (the
//     Read tool escapes cwd, and a `--settings` allow list only ADDS to the user's settings). So the
//     fence is drawn by the kernel: an allowlisted root, the room bound at /room, /home masked to a
//     tmpfs. What is not bound does not exist inside the jail.
//     Masking /home also removes ~/.claude entirely — which is why no CLAUDE.md, hook, memory, or
//     MCP config from your world can reach a contained agent's context. Only the one credential file
//     you name is bound back, read-only, so the process can authenticate.
//
// REQUIRES bubblewrap (`bwrap`) and, on many kernels,
//   sysctl kernel.apparmor_restrict_unprivileged_userns = 0
// Verify before assuming this works on a given machine; docs/SECURITY.md covers the failure modes.
//
// NETWORK: the jail deliberately shares the host network namespace — the model must reach its own
// API to think. "No network" is drawn at the TOOL layer (no Bash, no WebFetch/WebSearch). The agent
// has no instrument that can open a socket.

import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { config, path as cfgPath, ROOT } from './config.mjs';

const CLAUDE_BIN = config.claudeBin;
const CREDS = cfgPath(config.credentials?.claudeCredentialsPath || '~/.claude/.credentials.json');
const CRASH_LOG = cfgPath(config.crashLog || 'state/spawn-crashes.log');
const HOME = homedir();

// Belt-and-suspenders permission rules. The jail already makes these paths nonexistent; these
// entries mean the profile still reads correctly if the jail is ever bypassed or unavailable.
// Built from config so nothing here is machine-specific: deny the credential trees, your repos, and
// the usual sensitive roots, plus the outbound tools.
// ★ EVERY PATH HERE WAS `/${HOME}/…` — and HOME is ALREADY absolute, so the profile that shipped read
// `Read(//home/…/.claude/**)`, with the hand-written `//proc/**` and `//etc/shadow` carrying the same
// doubled slash. Nobody has confirmed whether the permission matcher normalizes `//` or treats it as a
// path that never matches; the layer is belt-and-suspenders either way, so the bug was invisible while
// the jail held. But this list exists precisely FOR the case where the jail does not hold — a rule that
// only works when it is not needed is the worst kind. Paths are joined, not concatenated, and asserted
// in test/contained-spawn.test.mjs.
const abs = (...parts) => parts.join('/').replace(/\/+/g, '/');
export const DEFAULT_DENY = [
  `Read(${abs(HOME, '.claude/**')})`,
  `Read(${abs(HOME, '.ssh/**')})`,
  `Read(${abs(ROOT, '**')})`,
  `Read(${abs(cfgPath(config.worldRoot), '**')})`,
  'Read(/proc/**)',
  'Read(/etc/shadow)',
  'WebFetch', 'WebSearch', 'Bash', 'Task', 'Edit', 'NotebookEdit',
];

export function jailArgv(roomAbs, innerArgv) {
  const ro = (p) => (existsSync(p) ? ['--ro-bind', p, p] : []);
  return [
    // an allowlisted root: only these trees exist inside
    ...ro('/usr'), ...ro('/bin'), ...ro('/sbin'), ...ro('/lib'), ...ro('/lib64'),
    ...ro('/etc/ssl'), ...ro('/etc/ca-certificates'), ...ro('/etc/ca-certificates.conf'),
    ...ro('/etc/resolv.conf'), ...ro('/etc/hosts'), ...ro('/etc/nsswitch.conf'), ...ro('/etc/passwd'),
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    // /home is a blank tmpfs: credential dirs and your whole live tree cease to exist inside the jail.
    // Only the one credential file is bound back so the process can authenticate; the Read tool is
    // additionally denied on it (and Claude Code refuses it on its own).
    '--tmpfs', HOME,
    ...ro(CREDS),
    // the room — the one writable, persistent path in the jail
    '--bind', roomAbs, '/room',
    '--chdir', '/room',
    '--unshare-pid', '--unshare-uts', '--unshare-ipc', '--die-with-parent', '--new-session',
    // no host environment rides along
    '--clearenv',
    '--setenv', 'HOME', HOME,
    '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
    '--setenv', 'LANG', 'C.UTF-8',
    ...innerArgv,
  ];
}

export function claudeArgv(prompt, { model, tools, deny = DEFAULT_DENY } = {}) {
  return [
    CLAUDE_BIN, '-p',
    '--model', model,
    '--tools', tools,
    '--settings', JSON.stringify({ permissions: { defaultMode: 'acceptEdits', deny } }),
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--output-format', 'text',
    prompt,
  ];
}

// How long an exit still counts as "died on the way up" rather than "ran and failed". A real compose
// takes 90–170s; the transient this guards against dies in under five seconds.
const FAST_DEATH_MS = 15_000;

// Everything we can learn about a dead spawn, written somewhere it survives the throw. The point is
// to capture stdout AND the signal AND the duration, not just a truncated stderr — a killed spawn and
// a failed one look identical until you record the signal, and the observed transient printed empty
// stderr, so the one field a naive throw keeps is the one field that is blank.
function recordCrash(label, r, secs, attempt) {
  const block = [
    `=== ${new Date().toLocaleString('en-CA', { timeZone: config.timezone, hour12: false })} · ${label} · attempt ${attempt} ===`,
    `status=${r.status}  signal=${r.signal || 'none'}  secs=${secs}  error=${r.error ? r.error.message : 'none'}`,
    `--- stdout (${(r.stdout || '').length} chars) ---`, (r.stdout || '(empty)').slice(0, 8000),
    `--- stderr (${(r.stderr || '').length} chars) ---`, (r.stderr || '(empty)').slice(0, 8000),
    '',
  ].join('\n');
  try { mkdirSync(dirname(CRASH_LOG), { recursive: true }); appendFileSync(CRASH_LOG, block); } catch { /* never let logging be the failure */ }
  return block;
}

// Spawn a contained agent whose entire world is `roomAbs`. Throws on non-zero exit or timeout.
//
// RETRY POLICY — ONE retry, and only for a FAST DEATH. A spawn that RAN (slow failure, timeout, or
// any exit past FAST_DEATH_MS) throws immediately: a spawn costs real money and a silent retry would
// hide a containment failure. A spawn that dies in under fifteen seconds having produced nothing has
// done no work, so retrying it costs approximately nothing. The retry is LOUD by construction — it
// always writes a crash record and always prints — so it can never become a quiet papering-over.
// PREFLIGHT. bwrap and claude are both spawned via PATH, so a missing prerequisite used to surface as
// a Node spawn error or a bwrap usage message — neither of which says "you have not installed the
// thing." A person setting this up for the first time is exactly the person who cannot tell those
// apart. Checked once per process, not per spawn.
let preflighted = false;
function preflight() {
  if (preflighted) return;
  const missing = [];
  const has = (bin, args) => { const r = spawnSync(bin, args, { encoding: 'utf8' }); return !r.error; };

  if (!has('bwrap', ['--version'])) missing.push(
    'bwrap (bubblewrap) is not on your PATH.\n' +
    '  This is the jail. Without it nothing contained can run — no digest compose, no reply compose.\n' +
    '  Debian/Ubuntu: sudo apt install bubblewrap · Fedora: sudo dnf install bubblewrap\n' +
    '  Some kernels also need a sysctl — see docs/SECURITY.md.\n' +
    '  The deterministic stages (harvest, render, the gates, every checker) do not need it.');

  // claudeBin may be an absolute path from config, or a bare name resolved on PATH. Try both shapes.
  if (!(existsSync(CLAUDE_BIN) || has(CLAUDE_BIN, ['--version']))) missing.push(
    `the claude binary was not found at "${CLAUDE_BIN}".\n` +
    '  This is the model. Install Claude Code and sign in, then either put it on your PATH or set\n' +
    '  "claudeBin" in press-room.config.json to its absolute path (`which claude` will tell you).');

  if (missing.length) {
    throw new Error(
      `missing prerequisite${missing.length > 1 ? 's' : ''} for a contained spawn:\n\n  - ` +
      missing.join('\n\n  - ') + '\n');
  }
  preflighted = true;
}

export function spawnContained(roomAbs, prompt, {
  model, tools, deny, label = 'agent', timeoutMs = 10 * 60 * 1000,
} = {}) {
  preflight();
  const argv = jailArgv(roomAbs, claudeArgv(prompt, { model, tools, deny }));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const r = spawnSync('bwrap', argv, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    const ms = Date.now() - started;
    const secs = (ms / 1000).toFixed(1);
    if (!r.error && r.status === 0) return { stdout: r.stdout || '', stderr: r.stderr || '', secs, attempts: attempt };

    const block = recordCrash(label, r, secs, attempt);
    const fast = ms < FAST_DEATH_MS;
    if (attempt === 1 && fast) {
      // Loud on purpose: this line is the only thing standing between "we retried" and "it silently worked".
      console.error(`${label}: died in ${secs}s (status=${r.status} signal=${r.signal || 'none'}) — FAST DEATH, retrying ONCE. Full capture: ${CRASH_LOG}`);
      continue;
    }
    if (r.error) throw new Error(`${label}: spawn failed — ${r.error.message}\nfull capture: ${CRASH_LOG}`);
    throw new Error(
      `${label}: exited ${r.status} after ${secs}s${attempt > 1 ? ' (SECOND attempt — the retry failed too)' : ''}\n` +
      `${block}\nfull capture: ${CRASH_LOG}`);
  }
}
