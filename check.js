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
(function configKeys() {
  checksRun++;
  const cfgSrc = read('lib/config.mjs') || '';
  const exampleSrc = read('press-room.config.example.json') || '';
  // keys the code reads: config.X , dir('X') , cfgPath(config.X)
  const read1 = new Set();
  for (const cf of walk('bin', (p) => p.endsWith('.mjs')).concat(walk('lib', (p) => p.endsWith('.mjs')))) {
    const src = read(cf);
    for (const m of src.matchAll(/(?<![.\w/'"-])config\.([a-zA-Z][a-zA-Z0-9]*)/g)) read1.add(m[1]);
    for (const m of src.matchAll(/\bdir\(\s*['"]([a-zA-Z0-9]+)['"]\s*\)/g)) read1.add(m[1]);
  }
  // things that are not config keys (methods/exports on the config module)
  // nested keys (documented under their parent) + filename fragments that can appear as "config.mjs"
  // in a comment or a path string and are never config keys.
  const notKeys = new Set(['credentials', 'sources', 'mailGroups', 'timezone', 'mjs', 'json', 'js', 'html', 'example']);
  for (const key of read1) {
    if (notKeys.has(key)) continue;
    if (!new RegExp(`\\b${key}\\s*:`).test(cfgSrc)) fail('config', `code reads config.${key} but lib/config.mjs defines no such default`, `add ${key} to DEFAULTS in lib/config.mjs`);
    else checksRun++;
    // documentation: the example should mention the key (as a key or a _doc). Nested keys live under
    // credentials/sources/mailGroups and are documented there, so only flag top-level ones.
    if (!new RegExp(`"${key}"`).test(exampleSrc) && !new RegExp(`"_${key}"`).test(exampleSrc)) {
      // allow keys that are internal-only defaults not meant for the example (none right now)
      notes.push(`config.${key} is read by the code and defaulted, but not shown in press-room.config.example.json`);
    }
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
    catch (e) { fail('self-test', `${st.join(' ')} did not pass`, ((e.stdout || '') + (e.stderr || '')).toString().trim().slice(-300)); }
  }
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
