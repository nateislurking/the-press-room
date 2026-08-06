#!/usr/bin/env node
// harvest.mjs — stage 1 (deterministic reader). One calendar day -> .staging/<date>.candidates.json
// CANDIDATES, not selections: judgment is stage 2. Raw candidate text may contain sensitive material,
// so staging is GITIGNORED; only the post-selection, post-gate facts/<date>.json is ever committed.
// Time law: transcript timestamps are UTC; normalized to your configured zone HERE, once.
// Usage: node harvest.mjs 2026-07-26 [--transcripts <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { config, dir, path as cfgPath, worldRoot, tz } from '../lib/config.mjs';

const ROOT = cfgPath('.');                      // repo root
const STAGING = dir('stagingDir');
const DATE = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE || '')) { console.error('usage: harvest.mjs YYYY-MM-DD'); process.exit(2); }
const ti = process.argv.indexOf('--transcripts');
const TRANSCRIPTS = ti > -1 ? process.argv[ti + 1] : cfgPath(config.transcriptsDir);

const centralDate = (utcIso) => new Date(utcIso).toLocaleDateString('en-CA', { timeZone: tz });
const centralTime = (utcIso) =>
  new Date(utcIso).toLocaleString('en-CA', { timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).replace(', ', 'T');

// ---- 1. transcripts -------------------------------------------------------
const turns = [];
if (TRANSCRIPTS && fs.existsSync(TRANSCRIPTS)) {
  for (const f of fs.readdirSync(TRANSCRIPTS).filter((x) => x.endsWith('.jsonl'))) {
    let lines; try { lines = fs.readFileSync(join(TRANSCRIPTS, f), 'utf8').split('\n'); } catch { continue; }
    let lastKeptUser = null;
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
      if (o.type === 'user') {
        if (text.length < 40) continue;
        turns.push({ said_at: centralTime(o.timestamp), who: 'operator', text: text.slice(0, 1500), session: f.slice(0, 8) });
        lastKeptUser = o.timestamp;
      } else if (o.type === 'assistant' && lastKeptUser) {
        // keep the machine's adjacent reply (within 15 min of a kept operator turn), as beat context
        if (new Date(o.timestamp) - new Date(lastKeptUser) < 15 * 60 * 1000 && text.length >= 40) {
          turns.push({ said_at: centralTime(o.timestamp), who: 'machine', text: text.slice(0, 900), session: f.slice(0, 8) });
          lastKeptUser = null; // one reply per kept turn
        }
      }
    }
  }
}
turns.sort((a, b) => a.said_at.localeCompare(b.said_at));

// ---- 2. session log (optional) --------------------------------------------
const sessionlog = [];
const SESSION_LOG = cfgPath(config.sources?.sessionLog);
if (SESSION_LOG && fs.existsSync(SESSION_LOG)) {
  try {
    const sl = fs.readFileSync(SESSION_LOG, 'utf8');
    for (const e of sl.split(/^## /m).slice(1)) {
      const heading = e.split('\n')[0];
      let match = heading.includes(DATE);
      // span headings like "2026-07-28→29": the end day also belongs
      const span = heading.match(/(\d{4}-\d{2})-(\d{2})→(\d{1,2})/);
      if (!match && span && `${span[1]}-${String(span[3]).padStart(2, '0')}` === DATE) match = true;
      if (match) sessionlog.push({ heading, body: e.slice(0, 7000) });
    }
  } catch { /* an unreadable session log is not fatal */ }
}

// ---- 3. git across the configured repos -----------------------------------
const commits = {};
let files_changed = 0;
for (const r of config.sourceRepos || []) {
  const repoDir = cfgPath(r.path, { base: worldRoot() });
  if (!fs.existsSync(join(repoDir, '.git'))) continue;
  try {
    const log = execFileSync('git', ['-C', repoDir, 'log',
      `--since=${DATE}T00:00:00`, `--until=${DATE}T23:59:59`,
      '--pretty=%h|%s', '--shortstat'], { encoding: 'utf8', env: { ...process.env, TZ: tz } });
    const subj = [];
    for (const ln of log.split('\n')) {
      const m = ln.match(/^([0-9a-f]{7,})\|(.*)$/);
      if (m) subj.push({ sha: m[1], subject: m[2] });
      const st = ln.match(/(\d+) files? changed/);
      if (st) files_changed += Number(st[1]);
    }
    if (subj.length) commits[r.name] = subj;
  } catch { /* a missing or unreadable repo is skipped, not fatal */ }
}

// ---- 4. bench ledger + shift logs (both optional) -------------------------
const bench = [];
const BENCH = cfgPath(config.sources?.benchLedger);
if (BENCH && fs.existsSync(BENCH)) {
  try {
    for (const e of fs.readFileSync(BENCH, 'utf8').split(/^## /m).slice(1)) {
      if (e.split('\n')[0].includes(DATE)) bench.push(e.slice(0, 3000));
    }
  } catch { /* not fatal */ }
}
const shifts = [];
const SHIFT_LOGS = cfgPath(config.sources?.shiftLogsDir);
if (SHIFT_LOGS && fs.existsSync(SHIFT_LOGS)) {
  for (const f of fs.readdirSync(SHIFT_LOGS).filter((x) => x.includes(DATE)))
    shifts.push({ file: f, text: fs.readFileSync(join(SHIFT_LOGS, f), 'utf8').slice(0, 2500) });
}

// ---- write staging --------------------------------------------------------
const out = {
  date: DATE, tz, stage: 'candidates',
  generated_at: new Date().toISOString(),
  coverage: {
    operator_turns: turns.filter((t) => t.who === 'operator').length,
    machine_turns: turns.filter((t) => t.who === 'machine').length,
    sessionlog_entries: sessionlog.length,
    repos_with_commits: Object.keys(commits).length,
    commit_count: Object.values(commits).flat().length,
    files_changed, bench_sections: bench.length, shift_files: shifts.length,
  },
  sessionlog, commits, bench, shifts, turns,
};
fs.mkdirSync(STAGING, { recursive: true });
const outPath = join(STAGING, `${DATE}.candidates.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`${DATE}  operator:${out.coverage.operator_turns} machine:${out.coverage.machine_turns} log:${out.coverage.sessionlog_entries} commits:${out.coverage.commit_count} files:${files_changed} bench:${bench.length} shifts:${shifts.length}  -> ${path.relative(ROOT, outPath)}`);
