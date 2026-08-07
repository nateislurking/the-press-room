#!/usr/bin/env node
// receipts.mjs — stage 1 of the RECEIPTS pipeline: the conversation record behind each digest topic,
// published for the reply lane to cite. Deterministic assembler, judgment-free: one calendar day ->
// .staging/<date>.receipt-draft.md — the FULL day's exchange, timestamped and speaker-labeled, with
// bigger per-turn caps than harvest (receipts exist to show the whole back-and-forth, not beats).
// Staging is GITIGNORED: raw turns may hold sensitive passing material.
//
// The pipeline (mirrors harvest -> compose -> gate):
//   node bin/receipts.mjs 2026-07-29        -> .staging/2026-07-29.receipt-draft.md
//   [ the curate step — BY HAND today ]     -> receipts/2026-07-29.md
//   node bin/gate.mjs receipts/2026-07-29.md  -> MUST exit 0 before the file is committed/published
//
// ⚠ THE MIDDLE STAGE IS NOT BUILT. contracts/CURATOR-CONTRACT.md describes a contained curator that
// would do it, and nothing in this repo spawns a model against that contract — no script, not the
// nightly run. This file writes the draft and stops. You curate it yourself, then gate it. Do not
// skip the gate: receipts/ is admitted into the reply composer's reading room, so whatever lands
// there is quotable at strangers. See docs/ARCHITECTURE.md.
// Time law: UTC -> your configured zone here, once, same as harvest.

import fs from 'node:fs';
import { join } from 'node:path';
import { config, dir, path as cfgPath, tz } from '../lib/config.mjs';

const STAGING = dir('stagingDir');
const DIGESTS = dir('digestsDir');
const DATE = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE || '')) { console.error('usage: receipts.mjs YYYY-MM-DD'); process.exit(2); }
const ti = process.argv.indexOf('--transcripts');
const TRANSCRIPTS = ti > -1 ? process.argv[ti + 1] : cfgPath(config.transcriptsDir);
const TURN_CAP = 4000; // receipts want the whole exchange; harvest's 1500/900 is a beats cap

const centralDate = (utcIso) => new Date(utcIso).toLocaleDateString('en-CA', { timeZone: tz });
const centralClock = (utcIso) => new Date(utcIso).toLocaleTimeString('en-US',
  { timeZone: tz, hour12: true, hour: 'numeric', minute: '2-digit' });

const turns = [];
if (TRANSCRIPTS && fs.existsSync(TRANSCRIPTS)) {
  for (const f of fs.readdirSync(TRANSCRIPTS).filter((x) => x.endsWith('.jsonl'))) {
    let lines; try { lines = fs.readFileSync(join(TRANSCRIPTS, f), 'utf8').split('\n'); } catch { continue; }
    for (const line of lines) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!o.timestamp || !o.message) continue;
      if (centralDate(o.timestamp) !== DATE) continue;
      const c = o.message.content;
      let text = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
      text = (text || '').trim();
      if (!text) continue;
      if (text.startsWith('<') || text.startsWith('[Image:') || text.startsWith('Caveat:')) continue;
      if (text.includes('tool_use_id')) continue;
      if (o.type !== 'user' && o.type !== 'assistant') continue;
      if (text.length < 25) continue;
      turns.push({
        ts: o.timestamp, clock: centralClock(o.timestamp),
        who: o.type === 'user' ? 'OPERATOR' : 'MACHINE',
        session: f.slice(0, 8),
        text: text.slice(0, TURN_CAP) + (text.length > TURN_CAP ? '\n[... turn truncated at 4000 chars]' : ''),
      });
    }
  }
}
turns.sort((a, b) => a.ts.localeCompare(b.ts));

// The day's digest issue provides the curator's topic spine (its section headers).
let topics = [];
const issuePath = join(DIGESTS, `${DATE}.md`);
if (fs.existsSync(issuePath)) {
  topics = [...fs.readFileSync(issuePath, 'utf8').matchAll(/^## (.+)$/gm)].map((m) => m[1]);
}

const lines = [];
lines.push('<!-- RECEIPT DRAFT — staging, GITIGNORED, pre-curation, pre-gate. Never publish this file. -->');
lines.push(`# Receipt draft — ${DATE} (${turns.length} turns, ${new Set(turns.map((t) => t.session)).size} sessions)`);
lines.push('');
lines.push(`Topic spine from the issue (${fs.existsSync(issuePath) ? `digests/${DATE}.md` : 'NO ISSUE — curator picks topics'}):`);
for (const t of topics) lines.push(`- ${t}`);
lines.push('');
let lastSession = null;
for (const t of turns) {
  if (t.session !== lastSession) { lines.push('', '---', `session ${t.session}`, '---', ''); lastSession = t.session; }
  lines.push(`**${t.clock} — ${t.who}:**`, '', t.text, '');
}
fs.mkdirSync(STAGING, { recursive: true });
const outPath = join(STAGING, `${DATE}.receipt-draft.md`);
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`${DATE}  turns:${turns.length} sessions:${new Set(turns.map((t) => t.session)).size} topics:${topics.length}  -> .staging/${DATE}.receipt-draft.md (${Math.round(fs.statSync(outPath).size / 1024)} KB)`);
console.log('');
console.log('This is a RAW DRAFT, not a publishable receipt. The curate step is not automated:');
console.log(`  1. read .staging/${DATE}.receipt-draft.md and cut it down yourself`);
console.log('     (contracts/CURATOR-CONTRACT.md is the standard to curate to)');
console.log(`  2. write the result to ${config.receiptsDir}/${DATE}.md`);
console.log(`  3. node bin/gate.mjs ${config.receiptsDir}/${DATE}.md   <- must exit 0 before you publish`);
