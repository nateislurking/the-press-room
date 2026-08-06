#!/usr/bin/env node
// shift.mjs — THE REPLY-LANE SHIFT: the scheduled runner that automates intake -> compose -> gate ->
// DRAFT for real subscribers. DRAFT-FIRST by design: this script NEVER sends. It stages a fully-gated
// draft and pings you; the send is your word, run as `node bin/send-reply.mjs --send answers/<id>.json`
// (which re-runs every gate, including the HOLD-email check, at send time). Full auto is a deliberate
// later decision, not a flag someone can quietly set.
//
// Modeled on the nightly shape: fail-closed, file-based stop, still-log-and-beat so an off-box
// dead-man watcher never reads a deliberate stand-down as a dead box.
//
//   STOP:  the lane's HOLD file (./HOLD) stands the shift down entirely.
//   SPEND: each compose = 1 model spawn on your subscription. Cap 3 composes per run; a failed compose
//          is marked and NEVER silently retried — clearing a failure is a human act.
//   ZONES: this runner touches only typed records. The untrusted body is read exclusively inside the
//          jailed composer (compose.mjs).
//
// Usage:
//   node bin/shift.mjs             sweep, compose new work, gate, stage drafts, notify
//   node bin/shift.mjs --dry-run   sweep + list what WOULD compose; no spawns, no notify

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, dir, path as cfgPath, tz } from '../lib/config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INBOX = dir('inboxDir');
const STATE = dir('stateDir');
const ANSWERS = dir('answersDir');
const LEDGER = join(STATE, 'sends.jsonl');
const SHIFT_STATE = join(STATE, 'shift-state.json');
const LOG = join(STATE, 'shift.log');
const COMPOSE_CAP = 3;
const DESK_URL = process.env.REPLY_DESK_URL || config.deskUrl || '';

const DRY = process.argv.includes('--dry-run');

const stamp = () => new Date().toLocaleString('en-CA', { timeZone: tz, hour12: false }).replace(',', '');
function log(msg) {
  const line = `${stamp()} ${msg}`;
  console.log(line);
  try { mkdirSync(STATE, { recursive: true }); appendFileSync(LOG, line + '\n'); } catch { /* logging must never break the run */ }
}
function beat(note) {
  if (!config.beatCommand) return;
  try { execFileSync('bash', ['-c', config.beatCommand, 'beat', 'reply-shift', note], { encoding: 'utf8', timeout: 30000 }); }
  catch { log('beat: could not record (non-fatal)'); }
}
// A QUIET per-reply nudge — one notification carrying a count and the desk link, never a subscriber's
// words. Point config.notifyCommand at your own low-priority phone ping; empty => no ping (the draft
// still waits on disk).
function notify(headline) {
  if (DRY || !config.notifyCommand) { if (DRY) log(`DRY — would notify: "${headline}"`); return; }
  try { execFileSync('bash', ['-c', config.notifyCommand, 'notify', headline], { encoding: 'utf8', timeout: 30000 }); }
  catch { log('notify: ping failed (non-fatal — the draft still waits)'); }
}
function run(cmd, args, opts = {}) { return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts }); }
function die(msg, detail) {
  log(`REFUSED — ${msg}`);
  if (detail) log(String(detail).trim().slice(0, 1500));
  beat(`refused: ${msg}`.slice(0, 120));
  process.exit(1);
}

// ---------------------------------------------------------------- the stop
if (existsSync(cfgPath('HOLD'))) {
  log('shift fired (HOLD stands — lane stood down, nothing swept, nothing composed)');
  beat('held — stood down by design');
  process.exit(0);
}

// ---------------------------------------------------------------- 1. sweep the mailbox
try { for (const l of run('node', [join(HERE, 'intake-sweep.mjs')]).trim().split('\n')) log('  ' + l); }
catch (e) { die('intake sweep failed', (e.stdout || '') + (e.stderr || '')); }

// ---------------------------------------------------------------- 2. find unanswered work
const state = existsSync(SHIFT_STATE) ? JSON.parse(readFileSync(SHIFT_STATE, 'utf8')) : { handled: {} };
const ledger = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : '';
const work = [];
let newNonMember = 0;
for (const f of (existsSync(INBOX) ? readdirSync(INBOX) : []).sort()) {
  if (!f.endsWith('.json')) continue;
  const path = join(INBOX, f);
  const rec = JSON.parse(readFileSync(path, 'utf8'));
  if (rec.schema !== 'reply-lane/intake@1' || !rec.id) continue;
  if (ledger.includes(`"intake_id":"${rec.id}"`)) continue;          // answered (G4's truth)
  if (state.handled[rec.id]) continue;                               // already drafted/failed/skipped
  if (!(rec.membership && (rec.membership.daily || rec.membership.general))) {
    state.handled[rec.id] = { outcome: 'skipped_non_member', from: rec.from_email, at: new Date().toISOString() };
    newNonMember++;
    log(`  non-member email from ${rec.from_email} — no reply (silence outward), held visible for review`);
    continue;
  }
  work.push({ path, rec });
}

if (!work.length) {
  if (!DRY) writeFileSync(SHIFT_STATE, JSON.stringify(state, null, 2) + '\n');
  if (newNonMember && !DRY) notify(`${newNonMember} non-subscriber email(s) held — no reply owed`);
  log(`shift DONE — nothing new to answer${newNonMember ? ` (${newNonMember} non-subscriber held)` : ''}`);
  beat(newNonMember ? `ok: 0 new, ${newNonMember} non-member held` : 'ok: 0 new');
  process.exit(0);
}

const batch = work.slice(0, COMPOSE_CAP);
if (work.length > batch.length) log(`  ${work.length} waiting, composing ${batch.length} this run (cap ${COMPOSE_CAP}) — the rest ride the next shift`);
if (DRY) {
  for (const { rec } of batch) log(`  DRY — would compose: ${rec.id} from ${rec.from_email} (1 spawn)`);
  log('shift DONE (dry-run) — no spawns, no state written');
  process.exit(0);
}

// ---------------------------------------------------------------- 3. fresh reading room (once)
try { run('node', [join(HERE, 'build-reading-room.mjs')]); }
catch (e) { die('reading-room build failed — composing against a stale room is refused', (e.stdout || '') + (e.stderr || '')); }

// ---------------------------------------------------------------- 4. compose -> gate -> draft
let drafted = 0, refused = 0, failed = 0, flagged = 0;
for (const { path, rec } of batch) {
  const answerPath = join(ANSWERS, `${rec.id.replace(/[^A-Za-z0-9]/g, '')}.json`);
  try {
    log(`  composing ${rec.id} (contained, 1 spawn)…`);
    for (const l of run('node', [join(HERE, 'compose.mjs'), '--intake', path]).trim().split('\n')) log('    ' + l);
  } catch (e) {
    failed++;
    const why = ((e.stdout || '') + (e.stderr || '')).trim();
    state.handled[rec.id] = {
      outcome: 'compose_failed', at: new Date().toISOString(),
      reason: (why.split('\n').find((l) => /^Error:/.test(l.trim())) || why.split('\n').slice(-1)[0] || '').slice(0, 400),
    };
    log(`  COMPOSE FAILED for ${rec.id} — marked; will NOT auto-retry (clear state/shift-state.json to retry by hand)`);
    log(why.slice(0, 800));
    continue;
  }
  const answer = JSON.parse(readFileSync(answerPath, 'utf8'));
  if (answer.flag) { flagged++; log(`  ⚠ composer flagged this one: ${answer.flag}`); }
  try {
    for (const l of run('node', [join(HERE, 'send-reply.mjs'), '--draft', answerPath]).trim().split('\n')) log('    ' + l);
    drafted++;
    state.handled[rec.id] = { outcome: 'drafted', answer: answerPath, flag: answer.flag || null, at: new Date().toISOString() };
  } catch (e) {
    refused++;
    const why = ((e.stdout || '') + (e.stderr || '')).trim();
    const gateLines = why.split('\n').filter((l) => l.trim().startsWith('✗')).join(' · ');
    state.handled[rec.id] = {
      outcome: 'gate_refused', answer: answerPath, at: new Date().toISOString(),
      reason: (gateLines || why.split('\n').slice(-2).join(' ')).slice(0, 400),
    };
    log(`  GATE REFUSED the draft for ${rec.id} — answer kept for eyes, nothing staged:`);
    log(why.slice(0, 800));
  }
}
writeFileSync(SHIFT_STATE, JSON.stringify(state, null, 2) + '\n');

// ---------------------------------------------------------------- 5. one headline, counts only
const bits = [];
if (drafted) bits.push(`${drafted} draft${drafted > 1 ? 's' : ''} staged for your send`);
if (flagged) bits.push(`${flagged} flagged injection-suspect`);
if (refused) bits.push(`${refused} gate-refused`);
if (failed) bits.push(`${failed} compose-failed`);
if (newNonMember) bits.push(`${newNonMember} non-subscriber held`);
const deskCount = drafted + flagged;   // real cards on the desk
const handCount = refused + failed;    // no draft staged — needs a hand
let where = '';
if (deskCount && handCount) where = `${deskCount} on the desk${DESK_URL ? ` (${DESK_URL})` : ''} · ${handCount} need a hand (state/shift-state.json)`;
else if (deskCount) where = DESK_URL ? `clear on the desk: ${DESK_URL}` : 'clear the staged drafts';
else if (handCount) where = 'needs a hand (not on the desk): state/shift-state.json';
if (deskCount || handCount) notify(`${bits.join(' · ')} — ${where}`);
log(`shift DONE — ${bits.join(' · ')}`);
beat(`ok: ${bits.join(', ')}`.slice(0, 120));
