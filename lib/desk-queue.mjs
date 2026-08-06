// desk-queue.mjs — the "what is waiting" logic for the reply lane.
//
// PORTED SURFACE ONLY. In the original shop this lived in a standalone review-desk server; the desk
// itself (a browser UI) is a separate machine and is NOT part of this repo. What is ported is the one
// function the shipped tooling actually uses: listPending(), read by bin/pending-count.mjs so a
// morning roll-up can fold "and N replies waiting" into a single ping. One source of truth for
// "pending", no dependencies.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './config.mjs';

const ANSWERS = dir('answersDir');
const DRAFTS = dir('draftsDir');
const INBOX = dir('inboxDir');
const STATE = dir('stateDir');
const LEDGER = join(STATE, 'sends.jsonl');
const HELD_DIR = join(STATE, 'held');

// The answer/draft files strip non-alphanumerics from the intake id, so a fileId resolves everything.
export const fileId = (id) => String(id).replace(/[^A-Za-z0-9]/g, '');

const ledgerText = () => (existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : '');

function findIntake(intakeId) {
  if (!existsSync(INBOX)) return null;
  for (const f of readdirSync(INBOX)) {
    if (!f.endsWith('.json')) continue;
    try { const rec = JSON.parse(readFileSync(join(INBOX, f), 'utf8')); if (rec.id === intakeId) return rec; }
    catch { /* skip an unreadable record */ }
  }
  return null;
}

// The subject that actually ships: "Re: <the intake's own subject>", leading Re: de-duped. The
// composer's invented subject never ships, so a queue shows the reader-true one.
export function shippedSubject(intake, answer) {
  const raw = (intake?.subject_quarantined || answer?.subject || '').trim().replace(/^(re:\s*)+/i, '');
  return 'Re: ' + raw;
}

// A reply is PENDING when it has a staged draft, has NOT been sent (not in the ledger), and is NOT
// held. Sent => it's in sends.jsonl. Held => a marker file in state/held/. Anything the shift produced
// that never got a draft (gate_refused, compose_failed) never appears here.
export function listPending() {
  if (!existsSync(ANSWERS)) return [];
  const led = ledgerText();
  const items = [];
  for (const f of readdirSync(ANSWERS)) {
    if (!f.endsWith('.json')) continue;
    const fid = f.replace(/\.json$/, '');
    let answer;
    try { answer = JSON.parse(readFileSync(join(ANSWERS, f), 'utf8')); } catch { continue; }
    const intakeId = answer.intake_id;
    if (!intakeId) continue;
    const draftPath = join(DRAFTS, `${fid}.html`);
    if (!existsSync(draftPath)) continue;                        // no staged draft (e.g. gate refused)
    if (led.includes(`"intake_id":"${intakeId}"`)) continue;     // already sent
    if (existsSync(join(HELD_DIR, fid))) continue;               // held
    const intake = findIntake(intakeId);
    items.push({
      fileId: fid,
      intakeId,
      to: intake?.from_email || '(recipient unknown — intake record missing)',
      subject: shippedSubject(intake, answer),
      receivedAt: intake?.received_at || '',
      flagged: answer.flag || null,
      draftPath,
    });
  }
  items.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
  return items;
}
