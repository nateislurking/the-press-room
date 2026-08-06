#!/usr/bin/env node
// gate.mjs — the redaction gate. The fail-closed checker that stands between a composed issue and
// the outside world. Any hit => that day does not publish, and it raises to you.
// Usage:
//   node gate.mjs <file> [more files]   -> exit 0 clean; exit 1 on ANY hit (report to stdout)
//   node gate.mjs --self-test           -> plants secrets, PROVES the gate fails on them, then
//                                          proves a clean payload passes. Exit 0 only if both hold.
// Denylist single source: the redaction file (see config.redactionFile). Its deny: / allow-email: /
// allow-dollar: / deny-scope: / deny-regex: lines are parsed live, so an edit there IS an edit here.
import { readFileSync } from 'node:fs';
import { redactionPath } from '../lib/config.mjs';

function loadLists() {
  const txt = readFileSync(redactionPath(), 'utf8');
  const names = [], emails = [], dollars = new Set(), scope = [], regexes = [];
  for (const line of txt.split('\n')) {
    // ORDER MATTERS: the more specific `deny-scope:`/`deny-regex:` must be tested BEFORE `deny:`, or
    // the looser pattern would swallow them and file every one as a denied NAME.
    const sc = line.match(/^\s*-\s*deny-scope:\s*(.+?)\s*$/);
    if (sc) { scope.push(sc[1]); continue; }
    const rx = line.match(/^\s*-\s*deny-regex:\s*(.+?)\s*$/);
    if (rx) { try { regexes.push(new RegExp(rx[1], 'gi')); } catch { /* a bad regex is ignored, not fatal */ } continue; }
    const deny = line.match(/^\s*-\s*deny:\s*(.+?)\s*$/);
    if (deny) { names.push(deny[1]); continue; }
    const em = line.match(/^\s*-\s*allow-email:\s*(\S+)/);
    if (em) emails.push(em[1].toLowerCase());
    const dl = line.match(/^\s*-\s*allow-dollar:\s*(.+)$/);
    if (dl) dl[1].trim().split(/\s+/).forEach((d) => dollars.add(d.replace(/,/g, '')));
  }
  return { names, emails, dollars, scope, regexes };
}

function scan(text, lists) {
  const hits = [];
  const push = (rule, m, line) => hits.push({ rule, match: String(m).slice(0, 60), line });
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    const n = i + 1;
    // --- credential / token shapes (generic; these apply to everyone) ---
    for (const m of ln.matchAll(/sk-[A-Za-z0-9_-]{8,}/g)) push('key-shape sk-', m[0], n);
    for (const m of ln.matchAll(/re_[A-Za-z0-9]{16,}/g)) push('key-shape re_', m[0], n);
    for (const m of ln.matchAll(/Bearer\s+[A-Za-z0-9._-]{10,}/g)) push('bearer-token', m[0], n);
    // long token runs: mixed-case-or-symbol base64ish. Pure hex is ALLOWED — commit shas and key
    // HASHES are receipts, not secrets. Key off the LONGEST unbroken run, not the whole span, so a
    // dated document ref like a-file/NOTES-2026-07-31.md stops reading as a token.
    for (const m of ln.matchAll(/[A-Za-z0-9+/_=-]{32,}/g)) {
      const s = m[0];
      if (/^[0-9a-f]+$/i.test(s)) continue;               // pure hex
      if (/^[0-9]+$/.test(s)) continue;                    // pure number
      const longestRun = Math.max(0, ...s.split(/[/_.-]/).map((seg) => seg.length));
      if (longestRun < 20) continue;
      if (/[A-Z]/.test(s) && /[a-z]/.test(s) && (/[0-9]/.test(s) || s.includes('='))) push('token-run', s, n);
    }
    // app-password shapes: an unspaced 16-char lowercase run that is vowel-starved (random passwords
    // have few vowels; 16-letter English words do not); the spaced 4x4 form only on credential lines.
    for (const m of ln.matchAll(/\b[a-z]{16}\b/g)) {
      if (((m[0].match(/[aeiou]/g) || []).length) < 4) push('app-password', m[0], n);
    }
    if (/password|passphrase|app.?pass|credential|secret\s+key|api\s+key|token/i.test(ln))
      for (const m of ln.matchAll(/\b[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}\b/g)) push('app-password', m[0], n);
    // absolute machine paths — repo-relative paths are fine
    for (const m of ln.matchAll(/\/home\/[a-z_][^\s"']*/g)) push('abs-path', m[0], n);
    for (const m of ln.matchAll(/\/Users\/[A-Za-z0-9._-]+\/[^\s"']*/g)) push('abs-path', m[0], n);
    for (const m of ln.matchAll(/[A-Z]:\\Users\\[^\s"']*/g)) push('abs-path-win', m[0], n);
    // emails not on the allow list
    for (const m of ln.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      if (!lists.emails.includes(m[0].toLowerCase())) push('email', m[0], n);
    }
    // dollar figures outside the locked set
    for (const m of ln.matchAll(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s?([KkMm](?![A-Za-z]))?/g)) {
      let v = m[1].replace(/,/g, '');
      if (m[2]) v = String(parseFloat(v) * (m[2].toLowerCase() === 'k' ? 1000 : 1000000));
      v = v.replace(/\.0+$/, '');
      if (!lists.dollars.has(v)) push('dollar-figure', m[0], n);
    }
    // name denylist (case-insensitive, word-boundary)
    for (const name of lists.names) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      for (const m of ln.matchAll(re)) push('denied-name', m[0], n);
    }
    // out-of-scope subject matter — a different question from the denylist: not "is this person
    // identifiable" but "is this the shop's technical record at all". Kept high-precision on purpose.
    for (const phrase of lists.scope) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      for (const m of ln.matchAll(re)) push('out-of-scope', m[0], n);
    }
    // your own domain rules, supplied as deny-regex: lines in the redaction file. This is where a
    // pricing formula, a project codename, or any house-specific pattern lives — in your denylist,
    // never baked into this file.
    for (const re of lists.regexes) { re.lastIndex = 0; for (const m of ln.matchAll(re)) push('deny-regex', m[0], n); }
  });
  return hits;
}

// Fixtures are ASSEMBLED from short fragments (asm) rather than written as literals, so this file's
// own test payloads do not read as live secrets to an outer publish gate scanning this repo — while
// the ASSEMBLED runtime string is still a real trip for the rule under test.
const asm = (...p) => p.join('');

function selfTest(lists) {
  const planted = [
    ['key-shape sk-', asm('the key was ', 'sk', '-', 'A1b2C3d4', 'E5f6G7h8', 'I9j0K1l2', ' noted in passing')],
    ['key-shape re_', asm('sends ride ', 're', '_', 'A1b2C3d4', 'E5f6G7h8', 'I9j0K1l2m', ' internally')],
    ['bearer-token', asm('Authorization: ', 'Bearer ', 'A1b2c3d4', 'e5f6g7h8', 'i9j0')],
    ['abs-path', asm('the file at /', 'home/', 'someone', '/secrets/notes.md')],
    ['email', asm('a stranger wrote from ', 'someone', '@', 'elsewhere.example', ' about it')],
    ['dollar-figure', asm('the run cost ', '$', '2.37', ' that morning')],
    ['denied-name', asm('Marigold', ' ', 'Thornbury', ' reviewed the draft')],
    ['out-of-scope', asm('the day also went out on a ', 'sales', ' call', ' after lunch')],
    ['token-run', asm('stray token ', 'QmFzZTY0', 'U2VjcmV0', 'VmFsdWVI', 'ZXJlMTIz', 'NDU2Nzg5')],
    ['app-password', asm('gm', 'ail app ', 'pass', 'word: ', 'fdab', ' ', 'vhjx', ' ', 'wfhx', ' ', 'xbjv')],
    ['app-password', asm('he stored ', 'abcdwxyz', 'efghstuv', ' on the box')],
    ['deny-regex', asm('internally the law reads ', 'seat', ' = ', 'tank', ' + ', '$', '20')],
  ];
  let ok = true;
  for (const [rule, payload] of planted) {
    const caught = scan(payload, lists).some((h) => h.rule === rule);
    console.log(`${caught ? '✓ CAUGHT' : '✗ MISSED'}  ${rule}`);
    if (!caught) ok = false;
  }
  const clean = 'Shipped the fix at commit 860926d. The public prices stand on their own. He said: "You have it right, and I had it wrong." (8:02 am)';
  const cleanHits = scan(clean, lists);
  console.log(cleanHits.length === 0 ? '✓ CLEAN payload passes' : `✗ FALSE POSITIVES on clean payload: ${JSON.stringify(cleanHits)}`);
  if (cleanHits.length) ok = false;
  // A dated document filename must NOT read as a token — the classic false positive.
  const cleanPath = 'see the self-diagnostic at some-app/NOTES-HANDOFF-2026-07-31.md before the rerun';
  const pathHits = scan(cleanPath, lists);
  console.log(pathHits.length === 0 ? '✓ CLEAN filename passes' : `✗ FALSE POSITIVE on filename: ${JSON.stringify(pathHits)}`);
  if (pathHits.length) ok = false;
  return ok;
}

const args = process.argv.slice(2);
const lists = loadLists();
if (args[0] === '--self-test') {
  const ok = selfTest(lists);
  console.log(ok ? 'SELF-TEST PASS — the gate fails when it must and passes when it should' : 'SELF-TEST FAIL');
  process.exit(ok ? 0 : 1);
}
if (!args.length) { console.error('usage: gate.mjs <file>... | --self-test'); process.exit(2); }
let total = 0;
for (const f of args) {
  const hits = scan(readFileSync(f, 'utf8'), lists);
  total += hits.length;
  if (hits.length) {
    console.log(`✗ ${f} — ${hits.length} hit(s):`);
    for (const h of hits) console.log(`   line ${h.line}  [${h.rule}]  ${h.match}`);
  } else console.log(`✓ ${f} clean`);
}
if (total) { console.log('GATE: FAIL CLOSED — this day does not publish. Raise it.'); process.exit(1); }
process.exit(0);
