// config.mjs — the ONE config loader for the whole press room.
//
// Every machine-specific value in this repo — where your transcripts live, what address the daily
// goes out as, which model composes, where your credentials sit — is a config key with a sane
// default, resolved here and nowhere else. There are no machine paths baked into the code; if you
// find one, it is a bug.
//
// It reads, in order: press-room.config.json (yours), then press-room.config.example.json (the
// shipped starter), then the built-in DEFAULTS below. An absent config file is fine — an empty {}
// boots something that works offline. Keys beginning with "_" are treated as inline documentation
// and ignored (same convention as the example file).
//
// No dependencies — Node standard library only, same as the rest of the repo.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
// The repo root. lib/ sits directly under it, and bin/ does too, so every relative default below
// resolves against this one anchor.
export const ROOT = resolve(join(HERE, '..'));

// Built-in defaults. The rule: an empty config must boot. Anything that reaches OUT of the repo
// (transcripts, the live site, credentials, the send command) defaults to empty/off, and the code
// degrades honestly rather than crashing when it is missing. Anything internal (data folders, the
// contract paths) defaults to a working in-repo location.
const DEFAULTS = {
  // --- who the shop is, on the outside -------------------------------------------------------
  senderName: 'The Shop',                       // display name on the daily digest
  senderAddress: 'daily@example.com',           // From: on the daily digest
  replyAddress: 'replies@example.com',          // From: / Reply-To: on reply-lane answers
  ownerAddresses: ['you@example.com'],          // your own addresses — HOLD/RESUME control mail comes from here
  ignoreFrom: ['support@example.com'],          // service mail never treated as a subscriber question

  // --- the public surfaces -------------------------------------------------------------------
  siteUrl: 'https://example.com',               // your site root — archive links, the citation allowlist
  newsletterUrl: 'https://example.com/newsletter',
  githubUser: '',                               // GitHub user/org whose repo permalinks may be cited; empty => no repo citations allowed
  subscribeEndpoint: '',                        // POST endpoint for the archive signup box; empty => the box is omitted

  // --- the model -----------------------------------------------------------------------------
  model: 'claude-sonnet-5',                     // brain for every contained model stage. Pin an explicit id, never an alias.

  // --- filesystem: external inputs & outputs -------------------------------------------------
  transcriptsDir: '',                           // Claude Code transcript dir the digest harvests; empty => no transcript source
  siteProductionDir: '',                        // where rendered archive/fixes pages are written; empty => only ./out/ is written
  publicReposDir: '',                           // directory holding local clones of your public repos (for citation-real checks)
  fixesPage: '',                                // the public "what changed" page build-fixes-day writes onto; empty => derived from siteProductionDir/fixes.html, else skipped

  // repos scanned for the day's git activity (harvest, fixes). Each: { name, path }.
  // path is relative to worldRoot unless absolute.
  worldRoot: '..',                              // the folder that contains your repos (defaults to the repo's parent)
  sourceRepos: [],                              // e.g. [{ "name": "my-app", "path": "my-app" }]
  productRepos: [],                             // subset whose user-visible changes feed the fixes page

  // optional extra evidence the digest harvests, each empty => that source is skipped
  sources: {
    sessionLog: '',                             // a markdown journal whose ## sections carry a date
    benchLedger: '',                            // a markdown ledger of repair/bug work (## dated sections)
    shiftLogsDir: '',                           // dir of per-day log files from an unattended background shift
  },

  // public repos admitted into the reply composer's reading room (each: { dest, path })
  publicRepos: [],                              // e.g. [{ "dest": "repos/the-press-room", "path": "the-press-room" }] under publicReposDir

  // --- data folders (internal; defaults work out of the box) ---------------------------------
  contractsDir: 'contracts',
  redactionFile: 'redaction/REDACTION.md',      // copy redaction/REDACTION.example.md here and edit it
  digestsDir: 'digests',
  factsDir: 'facts',
  receiptsDir: 'receipts',
  outDir: 'out',
  stagingDir: '.staging',
  inboxDir: 'inbox',
  answersDir: 'answers',
  draftsDir: 'drafts',
  stateDir: 'state',
  readingRoomDir: 'reading-room',

  // --- credentials (PATHS ONLY — never values; you supply the files) -------------------------
  credentials: {
    jmapTokenPath: '',                          // Fastmail JMAP read-only token file (reply-lane intake)
    mailerliteKeyPath: '',                      // MailerLite API key file (list-membership check)
    resendKeyPath: '',                          // Resend API key file (the one send credential)
    claudeCredentialsPath: '~/.claude/.credentials.json',   // bound read-only into the jail so a contained agent can authenticate
  },
  mailAccountId: '',                            // your JMAP account id (intake + HOLD-email check)
  mailApiBase: 'https://api.fastmail.com/jmap', // JMAP session/api base
  mailboxProvider: 'fastmail',                  // informational
  mailGroups: { daily: 'Daily', general: 'General' },   // MailerLite group names that count as "a subscriber"
  sendProviderUrl: 'https://api.resend.com/emails',
  membershipApiBase: 'https://connect.mailerlite.com/api',

  // --- the model jail (bubblewrap) -----------------------------------------------------------
  claudeBin: '/usr/bin/claude',
  crashLog: 'state/spawn-crashes.log',          // where a dead contained spawn is recorded

  // --- external command hooks (the machinery this repo deliberately does NOT ship) -----------
  // These are shell commands the orchestrators call for steps that live outside the shop shape:
  // dispatching the daily email, the off-box dead-man heartbeat, the phone ping. Empty => the step
  // is skipped and logged, never faked.
  sendDailyCommand: '',                         // dispatch the daily subscriber email; receives the date as its first argument
  beatCommand: '',                              // heartbeat: receives a label and a note
  notifyCommand: '',                            // phone ping: receives a headline, a title, a priority
  deskUrl: '',                                  // review-desk URL shown in the shift ping

  // --- timezone ------------------------------------------------------------------------------
  timezone: 'America/Chicago',                  // the shop's clock; all UTC→local normalization uses this
};

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function stripUnderscores(v) {
  // Drop `_`-prefixed documentation keys, recursively.
  if (Array.isArray(v)) return v.map(stripUnderscores);
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) if (!k.startsWith('_')) out[k] = stripUnderscores(val);
    return out;
  }
  return v;
}

function deepMerge(base, over) {
  if (!isPlainObject(over)) return over;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function loadRaw() {
  for (const name of ['press-room.config.json', 'press-room.config.example.json']) {
    const p = join(ROOT, name);
    if (existsSync(p)) {
      try { return stripUnderscores(JSON.parse(readFileSync(p, 'utf8'))); }
      catch (e) { throw new Error(`${name} is not valid JSON: ${e.message}`); }
    }
  }
  return {};
}

export const config = deepMerge(DEFAULTS, loadRaw());

// Expand a configured path: '~' => home, relative => resolved against the repo root. Empty stays
// empty (callers treat "" as "not configured" and degrade).
export function path(p, { base = ROOT } = {}) {
  if (!p) return '';
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : join(base, p);
}

// A repo-root-relative data dir, resolved and ready to use.
export function dir(key) { return path(config[key]); }

// The folder that holds your source repos (worldRoot), resolved.
export function worldRoot() { return path(config.worldRoot); }

// Read a credential file named by config. Returns its first non-empty line trimmed, or throws a
// clear error naming the config key when the path is unset or unreadable — never a raw ENOENT.
export function readCredential(name) {
  const p = config.credentials?.[name];
  if (!p) throw new Error(`config.credentials.${name} is not set — this step needs a credential file. See press-room.config.example.json.`);
  const abs = path(p);
  try { return readFileSync(abs, 'utf8').split('\n').find((l) => l.trim())?.trim() || ''; }
  catch { throw new Error(`config.credentials.${name} points at ${abs}, which could not be read.`); }
}

// The redaction denylist file. If the configured one is absent, fall back to the shipped
// REDACTION.example.md sibling — so a fresh clone runs the gate self-tests and boots without the
// reader having copied the example into place yet.
export function redactionPath() {
  const p = path(config.redactionFile);
  if (existsSync(p)) return p;
  const ex = p.replace(/\.md$/, '.example.md');
  if (existsSync(ex)) return ex;
  return p; // absent — let the caller surface a clear error
}

export const tz = config.timezone;
