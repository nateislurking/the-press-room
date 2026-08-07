#!/usr/bin/env node
/* ============================================================================
   check.js  --  the package's own consistency checker.  `node check.js`
   ----------------------------------------------------------------------------
   Run it before you commit. It exits 0 when everything agrees and NON-ZERO with
   a named failure when it doesn't, so it can sit in a pre-commit hook or CI.

   It hunts one class of bug: TWO THINGS THAT MUST AGREE, living in two files,
   with nothing checking that they still do. A rule with no checker is a hope.
   Every check below is one of those pairs:

     1. Every contract a builder copies into a model's room actually exists.
     2. Every relative doc cross-reference (a [text](path.md) link) resolves.
     3. Every config key the code reads is defined in lib/config.mjs AND
        documented in press-room.config.example.json — and vice versa.
     4. Nothing in bin/ or lib/ carries an absolute machine path (a leak tell),
        and the gate self-tests still pass.

   Node stdlib only. No dependencies, nothing to install.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const failures = [];
const notes = [];
let checksRun = 0;

const fail = (check, detail, fix) => failures.push({ check, detail, fix });
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
const exists = (rel) => { try { fs.statSync(path.join(ROOT, rel)); return true; } catch { return false; } };
const walk = (rel, filter) => {
  const out = [];
  const rec = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) rec(p);
      else if (!filter || filter(p)) out.push(p);
    }
  };
  try { rec(rel); } catch { /* dir absent */ }
  return out;
};

// ---- 1. contracts a builder copies must exist -------------------------------
(function contractsExist() {
  checksRun++;
  const CONTRACTS = 'contracts';
  for (const bf of walk('bin', (p) => p.endsWith('.mjs'))) {
    const src = read(bf);
    const named = new Set();
    for (const m of src.matchAll(/copyFileSync\(\s*join\([^)]*?['"]([A-Za-z0-9_.-]+\.md)['"]/g)) named.add(m[1]);
    for (const m of src.matchAll(/for\s*\(\s*const\s+\w+\s+of\s*\[([^\]]*)\]/g))
      for (const q of m[1].matchAll(/['"]([A-Za-z0-9_.-]+\.md)['"]/g)) named.add(q[1]);
    for (const name of named) {
      // only care about ones that resolve against contracts/ (the room material)
      if (exists(`${CONTRACTS}/${name}`)) continue;
      // a copyFileSync from a non-contracts source (e.g. RECENT-ROWS.html generated in the room) is fine
      if (/RECENT-ROWS|CANDIDATES|FACTS|EVIDENCE|BRIEF|ROWS|SELECTION|DIGEST|QUESTION|ANSWER|README/.test(name)) continue;
      fail('contracts', `${bf} copies "${name}" into a model's room, but contracts/${name} does not exist`,
        `create contracts/${name}, or fix the reference in ${bf}`);
    }
  }
})();

// ---- 2. relative doc cross-references resolve -------------------------------
(function docLinksResolve() {
  checksRun++;
  for (const md of walk('', (p) => p.endsWith('.md'))) {
    const src = read(md);
    const dir = path.dirname(md);
    for (const m of src.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      let target = m[1].split('#')[0].trim();
      if (!target || /^(https?:|mailto:)/.test(target)) continue;       // external
      if (!/\.(md|json|mjs|js|sh|html)$/.test(target)) continue;         // only file-ish links
      const resolved = path.normalize(path.join(dir, target));
      if (!exists(resolved)) fail('doc-links', `${md} links "${target}" which resolves to ${resolved} — not found`,
        `fix the link or add the file`);
    }
  }
})();

// ---- 3. config keys: read by code <=> defined <=> documented ---------------
//
// THREE directions, not one. The header has always promised "and vice versa"; only the first leg was
// ever implemented, and the documentation leg was a note() — printed, never failing. So a key could be
// deleted from the example, or invented in the example and read by nobody, and this file still exited
// 0. Both were reproduced on the shipped tree: senderAddress was documented, defaulted, and read by
// NOTHING (the daily send is dispatched by an external hook), and mailboxProvider was defaulted and
// read by nothing while being absent from the example entirely.
//
//   A. read by code      -> must be defined in DEFAULTS      (a typo'd key silently reads undefined)
//   B. defined in DEFAULTS -> must be documented in example   (an undocumented knob is not a knob)
//   C. documented in example -> must be read by code          (a dead knob is a promise nothing keeps)
(function configKeys() {
  const cfgSrc = read('lib/config.mjs') || '';
  const exampleSrc = read('press-room.config.example.json') || '';

  // keys the code reads: config.X , dir('X')
  const readByCode = new Set();
  for (const cf of walk('bin', (p) => p.endsWith('.mjs')).concat(walk('lib', (p) => p.endsWith('.mjs')))) {
    const src = read(cf);
    for (const m of src.matchAll(/(?<![.\w/'"-])config\.([a-zA-Z][a-zA-Z0-9]*)/g)) readByCode.add(m[1]);
    for (const m of src.matchAll(/\bdir\(\s*['"]([a-zA-Z0-9]+)['"]\s*\)/g)) readByCode.add(m[1]);
  }

  // Filename fragments the `config.X` regex picks up out of comments and path strings ("config.mjs",
  // "config.json"). These are never config keys. NOTE what is NOT here any more: `timezone`, a real
  // top-level scalar read in four scripts, which sat in this list and exempted itself from every leg.
  const notKeys = new Set(['mjs', 'json', 'js', 'html', 'example']);

  // Top-level keys actually declared in DEFAULTS, read from the source between `const DEFAULTS = {`
  // and its closing brace, at one level of indentation only — nested keys belong to their parent.
  const defaults = new Set();
  const dBlock = cfgSrc.split(/const DEFAULTS = \{/)[1] || '';
  let depth = 1;
  for (const line of dBlock.split('\n')) {
    const m = line.match(/^  ([a-zA-Z][a-zA-Z0-9]*)\s*:/);
    if (depth === 1 && m) defaults.add(m[1]);
    depth += (line.match(/[{[]/g) || []).length - (line.match(/[}\]]/g) || []).length;
    if (depth <= 0) break;
  }

  // Top-level keys in the example, minus the `_`-prefixed documentation entries.
  let example = new Set();
  try { example = new Set(Object.keys(JSON.parse(exampleSrc)).filter((k) => !k.startsWith('_'))); }
  catch (e) { fail('config', `press-room.config.example.json is not valid JSON: ${e.message}`, 'fix the JSON'); }

  const documented = (k) => example.has(k) || new RegExp(`"_${k}"`).test(exampleSrc);

  // --- A. read by code -> defined -----------------------------------------------------------
  for (const key of readByCode) {
    if (notKeys.has(key)) continue;
    checksRun++;
    if (!defaults.has(key)) fail('config', `code reads config.${key} but lib/config.mjs DEFAULTS defines no such key`,
      `add ${key} to DEFAULTS in lib/config.mjs, or fix the misspelling at the read site`);
  }

  // --- B. defined -> documented in the example ----------------------------------------------
  for (const key of defaults) {
    checksRun++;
    if (!documented(key)) fail('config', `lib/config.mjs defines config.${key} but press-room.config.example.json never mentions it`,
      `add "${key}" (and a "_${key}" line saying what it does) to press-room.config.example.json, or drop the default`);
  }

  // --- C. documented -> read by code ---------------------------------------------------------
  // The leg the header promised and the file never had. A key in the example is a promise to the
  // reader that setting it does something; if nothing reads it, that promise is false.
  for (const key of example) {
    checksRun++;
    if (!readByCode.has(key)) fail('config', `press-room.config.example.json documents "${key}" but no code in bin/ or lib/ ever reads config.${key}`,
      `wire ${key} up at the place it is supposed to matter, or delete it from the example and from DEFAULTS`);
    if (!defaults.has(key)) fail('config', `press-room.config.example.json documents "${key}" but lib/config.mjs DEFAULTS has no such key`,
      `add ${key} to DEFAULTS so an absent config still boots, or remove it from the example`);
  }
})();

// ---- 4. no absolute machine path in code, and the gates still self-test ----
(function noLeaksAndGatesPass() {
  checksRun++;
  for (const cf of walk('bin', (p) => p.endsWith('.mjs')).concat(walk('lib', (p) => p.endsWith('.mjs')))) {
    const src = read(cf);
    // an absolute /home/<user>/ or /Users/<user>/ literal in code is the leak tell (the drill's
    // deliberately-fabricated canary path is the one allowed exception).
    src.split('\n').forEach((ln, i) => {
      if (cf.endsWith('drill.mjs')) return;                     // canary path is intentional
      const m = ln.match(/['"`]\/(home|Users)\/[a-z]/i);
      if (m) fail('leak', `${cf}:${i + 1} carries an absolute machine path literal (${m[0]})`, 'replace it with a config key');
    });
  }
  for (const st of [['bin/gate.mjs', '--self-test'], ['bin/send-reply.mjs', '--self-test'], ['bin/check-attribution.mjs', '--self-test']]) {
    checksRun++;
    try { execFileSync('node', st, { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) {
      // Print the lines that FAILED. This used to be .slice(-300) — the tail of the output, which in
      // a self-test that prints one line per case is the last few PASSING cases. It reliably showed
      // everything except the thing that broke.
      const out = ((e.stdout || '') + (e.stderr || '')).toString();
      const bad = out.split('\n').filter((l) => /✗|MISSED|FAIL|Error/.test(l));
      fail('self-test', `${st.join(' ')} did not pass`,
        (bad.length ? bad : out.trim().split('\n').slice(0, 6)).join('\n              ').slice(0, 800));
    }
  }
})();

// ---- 5. the digest contract's tag table matches the archive's vocabulary ----
// A pair created by fixing the dead `see bin/build-site-archive.mjs` reference: the composer is jailed,
// so the tag vocabulary had to be written into the contract, which means the same list now lives in
// two files. That is precisely the shape this checker exists to police.
(function tagVocabularyAgrees() {
  checksRun++;
  const archive = read('bin/build-site-archive.mjs') || '';
  const contract = read('contracts/DIGEST-WRITER-CONTRACT.md') || '';
  const block = (archive.split('const TAG_LABEL = new Map([')[1] || '').split(']);')[0];
  const inCode = [...block.matchAll(/\[\s*'([a-z-]+)'/g)].map((m) => m[1]);
  const inContract = [...contract.matchAll(/^\s*\|\s*`([a-z-]+)`\s*\|/gm)].map((m) => m[1]);
  if (!inCode.length) return fail('tags', 'could not find TAG_LABEL in bin/build-site-archive.mjs', 'has the map been renamed?');
  if (!inContract.length) return fail('tags', 'could not find the tag table in contracts/DIGEST-WRITER-CONTRACT.md', 'has the table been removed?');
  const missing = inCode.filter((t) => !inContract.includes(t));
  const extra = inContract.filter((t) => !inCode.includes(t));
  if (missing.length) fail('tags', `TAG_LABEL has ${missing.join(', ')} but the writer's contract does not offer ${missing.length > 1 ? 'them' : 'it'}`,
    'add the row to the table in contracts/DIGEST-WRITER-CONTRACT.md — the composer cannot pick a tag it was never shown');
  if (extra.length) fail('tags', `the writer's contract offers ${extra.join(', ')} but TAG_LABEL does not carry ${extra.length > 1 ? 'them' : 'it'}`,
    'add it to TAG_LABEL in bin/build-site-archive.mjs — the archive drops unknown tags with a warning');
})();

// ---- report -----------------------------------------------------------------
for (const n of notes) console.log(`  note: ${n}`);
if (failures.length === 0) {
  console.log(`✓ check.js — ${checksRun} checks, everything agrees.`);
  process.exit(0);
}
console.log(`✗ check.js — ${failures.length} problem(s) across ${checksRun} checks:\n`);
for (const f of failures) {
  console.log(`  [${f.check}] ${f.detail}`);
  if (f.fix) console.log(`         fix: ${f.fix}`);
}
process.exit(1);
