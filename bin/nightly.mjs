#!/usr/bin/env node
// nightly.mjs — THE OVERNIGHT DIGEST RUN, in the order that matters:
//
//   1. REVIEW the day      harvest (deterministic) -> select (contained, typed) -> redaction gate
//   2. WRITE the markdown  compose (contained, typed input only) -> redaction gate
//   3. PUBLISH THE WEB     render --web -> build the archive -> (optionally) commit + push the site
//   4. BUILD THE EMAIL     render -> your configured send command  (skipped unless configured)
//
// ★ WHY THAT ORDER MATTERS, and it is not cosmetic: the archive page goes live BEFORE the email
//   exists. The reply lane's citation gate refuses an answer citing an issue that is not yet
//   published, so publishing first means every citation to today's issue resolves by the time any
//   subscriber can reply to it.
//
// FAIL-CLOSED THROUGHOUT. Any gate refusal stops the run before the next step; a day that cannot pass
// the redaction gate simply does not publish, and it raises rather than degrading.
//
// THE THREE STOPS, all file-based (in the working root):
//   - PAUSE           stops every run until deleted.
//   - KILL-<date>     kills exactly one day. You do not edit issues; you kill them.
//   - HOLD-<date>     composes everything, publishes NOTHING, and waits for your review. Release with
//                     --release, or kill it. A paused/held run still logs (and beats, if configured),
//                     so an off-box dead-man watcher does not read a deliberate stop as a dead box.
//
// The email dispatch and the heartbeat are DELIBERATELY not shipped here — they hold your send
// credential and your notification channel. Point config.sendDailyCommand / config.beatCommand at your
// own scripts; empty => that step is skipped and logged, never faked.
//
// Usage:
//   node bin/nightly.mjs [--date YYYY-MM-DD] [--yesterday] [--send] [--dry-run] [--force] [--release]

import { existsSync, appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, dir, path as cfgPath, ROOT, tz } from '../lib/config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = cfgPath(config.siteProductionDir);       // '' when no live site is configured
const LOG = join(dir('stateDir'), 'nightly.log');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const di = argv.indexOf('--date');
const centralDay = (offsetDays = 0) => {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return now.toLocaleDateString('en-CA', { timeZone: tz });
};
const DATE = di > -1 ? argv[di + 1] : centralDay(has('--yesterday') ? -1 : 0);
const DRY = has('--dry-run');
const SEND = has('--send');

const stamp = () => new Date().toLocaleString('en-CA', { timeZone: tz, hour12: false }).replace(',', '');
function log(msg) {
  const line = `${stamp()} [${DATE}] ${msg}`;
  console.log(line);
  try { mkdirSync(dir('stateDir'), { recursive: true }); appendFileSync(LOG, line + '\n'); } catch { /* logging must never break the run */ }
}
function beat(note) {
  if (!config.beatCommand) return;
  try { execFileSync('bash', ['-c', config.beatCommand, 'beat', 'nightly-digest', note], { encoding: 'utf8', timeout: 30000 }); }
  catch { log('beat: could not record (non-fatal)'); }
}
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
}
function die(msg, detail) {
  log(`REFUSED — ${msg}`);
  if (detail) log(String(detail).trim().slice(0, 1500));
  beat(`refused: ${msg}`.slice(0, 120));
  process.exit(1);
}

// ---------------------------------------------------------------- the stops
if (existsSync(join(ROOT, 'PAUSE'))) {
  log('nightly fired (PAUSED — stood down, nothing composed, nothing sent). Flag: ./PAUSE');
  beat('paused — stood down by design');
  process.exit(0);
}
if (existsSync(join(ROOT, `KILL-${DATE}`))) {
  log(`nightly fired (KILL-${DATE} present — this day is killed; nothing publishes)`);
  beat(`killed: ${DATE}`);
  process.exit(0);
}
const HOLD_FILE = join(ROOT, `HOLD-${DATE}`);
const RELEASING = has('--release');
if (RELEASING && existsSync(HOLD_FILE)) { rmSync(HOLD_FILE); log(`HOLD-${DATE} released — publishing this day now`); }
const HELD = !RELEASING && existsSync(HOLD_FILE);
if (HELD) log(`HOLD-${DATE} present — composing for review; NOTHING will be published or sent`);

log(`nightly START — mode: ${HELD ? 'HELD FOR REVIEW (compose only)' : DRY ? 'DRY-RUN' : SEND ? 'PUBLISH + SEND' : 'PUBLISH + BUILD (no send)'}`);

// ---------------------------------------------------------------- 1. review the day
const factsPath = join(dir('factsDir'), `${DATE}.json`);
const digestPath = join(dir('digestsDir'), `${DATE}.md`);
try {
  log('step 1/4 — reviewing the day (harvest → select → gate)');
  run('node', [join(HERE, 'harvest.mjs'), DATE]);
  if (existsSync(factsPath) && !has('--force')) log('  facts already exist — keeping them (pass --force to re-select)');
  else run('node', [join(HERE, 'select.mjs'), DATE], { stdio: 'inherit' });
} catch (e) { die('step 1 (review) failed', (e.stdout || '') + (e.stderr || '')); }
if (!existsSync(factsPath)) die('step 1 produced no facts file');

// ---------------------------------------------------------------- 2. write the markdown
try {
  log('step 2/4 — writing the issue (contained compose → gate)');
  if (existsSync(digestPath) && !has('--force')) log('  digest already exists — keeping it (pass --force to re-compose)');
  else run('node', [join(HERE, 'compose-digest.mjs'), DATE, ...(has('--force') ? ['--force'] : [])], { stdio: 'inherit' });
} catch (e) { die('step 2 (compose) failed — the day does not publish', (e.stdout || '') + (e.stderr || '')); }
if (!existsSync(digestPath)) die('step 2 produced no digest');

// ---------------------------------------------------------------- 3. publish the web archive
try {
  log('step 3/4 — rendering + building the web archive');
  run('node', [join(HERE, 'render.mjs'), DATE, '--web']);
  run('node', [join(HERE, 'build-site-archive.mjs')]);
} catch (e) { die('step 3 (render/archive build) failed', (e.stdout || '') + (e.stderr || '')); }

if (HELD) log('  HELD — archive rendered to disk for your review, NOT published');
else if (DRY) log('  DRY-RUN — not publishing the site');
else if (!SITE || !existsSync(join(SITE, '.git'))) log('  no site git repo configured (config.siteProductionDir) — archive rendered to disk only, publish it yourself');
else {
  try {
    const dirty = run('git', ['-C', SITE, 'status', '--porcelain', 'archive']).trim()
      || run('git', ['-C', SITE, 'status', '--porcelain', 'website/production/archive']).trim();
    if (!dirty) log('  archive already current — nothing to push');
    else {
      // Stage only the archive path that changed: this job never sweeps other work into its commit.
      const archPath = existsSync(join(SITE, 'website/production/archive')) ? 'website/production/archive' : 'archive';
      run('git', ['-C', SITE, 'add', archPath]);
      run('git', ['-C', SITE, 'commit', '-m', `Archive: publish the ${DATE} issue`]);
      run('git', ['-C', SITE, 'push']);
      log(`  archive PUSHED LIVE — ${config.siteUrl}/archive/${DATE}.html`);
    }
  } catch (e) { die('step 3 (site push) failed — NOT sending an email for an unpublished issue', (e.stdout || '') + (e.stderr || '')); }
}

// ---------------------------------------------------------------- 4. build + (optionally) send the email
try {
  log(`step 4/4 — building the subscriber email${SEND ? ' and SENDING' : ' (build only)'}`);
  run('node', [join(HERE, 'render.mjs'), DATE]);
} catch (e) { die('step 4 (email render) failed', (e.stdout || '') + (e.stderr || '')); }

if (HELD) log('  HELD — no email dispatched');
else if (DRY) log('  DRY-RUN — not dispatching');
else if (!SEND) log('  build only — pass --send to dispatch via config.sendDailyCommand');
else if (!config.sendDailyCommand) log('  no config.sendDailyCommand set — email rendered to out/, NOT dispatched (this repo does not hold your send credential)');
else {
  try {
    const out = run('bash', ['-c', `${config.sendDailyCommand} "$1"`, 'send', DATE]);
    for (const l of out.trim().split('\n')) if (l) log('  ' + l);
  } catch (e) { die('step 4 (send command) failed', (e.stdout || '') + (e.stderr || '')); }
}

if (HELD) {
  log('nightly DONE — HELD FOR YOUR REVIEW. Nothing published, nothing sent.');
  log(`  read it:  digests/${DATE}.md`);
  log(`  release:  node bin/nightly.mjs --date ${DATE} --send --release`);
  log(`  or kill:  touch KILL-${DATE}`);
  beat(`held: ${DATE} composed, awaiting review`);
} else {
  log(`nightly DONE — ${SEND ? 'issue published and dispatched' : 'issue published; email built'}`);
  beat(`ok: ${DATE} ${SEND ? 'published+sent' : 'published+built'}`);
}
