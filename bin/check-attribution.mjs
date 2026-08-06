#!/usr/bin/env node
// check-attribution.mjs — the quote SPEAKER-COLOR gate.
//
// Rust is the operator's voice ALONE. Each "From the microphone" beat's quote must carry a marker
// that matches the beat's `source`, because the renderer colors purely off that marker:
//     source "operator" ->  "> "   quote line  ->  renders RUST  = the operator (you)
//     source "machine"  ->  ">> "  quote line  ->  renders GREEN = the shop quoting itself
// If the marker and the source disagree, a quote renders in the wrong speaker's color (a machine
// self-own would wear the operator's rust). This refuses the compile.
//
// Usage:
//   import { checkAttribution } from './check-attribution.mjs'   -> checkAttribution(md, beats) => string[]
//   node bin/check-attribution.mjs <YYYY-MM-DD>                  -> check a composed issue (exit 1 on any problem)
//   node bin/check-attribution.mjs --self-test                  -> plant mismatches, PROVE they're caught
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// md: the digest markdown. beats: facts.beats (each may carry {quote, source}).
// Returns a list of human-readable problems; empty = clean.
export function checkAttribution(md, beats) {
  const problems = [];
  const body = norm(md);
  const openers = md.split('\n').map((l) => l.match(/^(>>?)\s+(\S.*)$/)).filter(Boolean);
  for (const b of beats || []) {
    if (!b.quote) continue;                       // beats without a quote (e.g. a disclosure) never color
    const q = norm(b.quote);
    if (!body.includes(q)) continue;              // "quote missing/paraphrased" is the verbatim gate's job
    const opener = openers.find((m) => q.startsWith(norm(m[2])) && norm(m[2]).length >= 12);
    if (!opener) continue;                        // couldn't align a marker line; verbatim already held
    const marker = opener[1];
    const want = b.source === 'machine' ? '>>' : '>';
    if (marker !== want) {
      problems.push(b.source === 'machine'
        ? `source="machine" quote uses "> " (the operator's rust) — a shop self-own must use ">> " (green): "${String(b.quote).slice(0, 50)}…"`
        : `source="${b.source}" quote uses ">> " (shop green) — an operator quote must use "> " (rust): "${String(b.quote).slice(0, 50)}…"`);
    }
  }
  return problems;
}

function selfTest() {
  const beats = [
    { source: 'machine', quote: 'You were right and I invented a fact instead of asking — dropping it now.' },
    { source: 'operator', quote: 'that log line is a build flag, it is not a product name' },
  ];
  const good = [
    '## From the microphone',
    '>> You were right and I invented a fact instead of asking — dropping it now.',
    '— morning, us conceding a miss',
    '**Our note:** a clean, avoidable miss.',
    '',
    '> that log line is a build flag, it is not a product name',
    '— afternoon, reading a build log aloud',
    '**Our note:** voice-to-text turned a flag into a product.',
  ].join('\n');
  // Two regressions, one in each direction:
  const machineAsRust = good.replace('>> You were right', '> You were right');   // shop wearing the operator's rust
  const operatorAsGreen = good.replace('> that log line', '>> that log line');    // operator wearing shop green

  let ok = true;
  const pass = checkAttribution(good, beats);
  console.log(pass.length === 0 ? '✓ correct markers pass clean' : `✗ FALSE POSITIVE on clean issue: ${JSON.stringify(pass)}`);
  if (pass.length) ok = false;

  const r1 = checkAttribution(machineAsRust, beats);
  const caught1 = r1.some((p) => /source="machine"/.test(p));
  console.log(caught1 ? '✓ CAUGHT a machine self-own wearing the rust' : '✗ MISSED machine-as-rust');
  if (!caught1) ok = false;

  const r2 = checkAttribution(operatorAsGreen, beats);
  const caught2 = r2.some((p) => /must use "> " \(rust\)/.test(p));
  console.log(caught2 ? '✓ CAUGHT an operator quote wearing shop green' : '✗ MISSED operator-as-green');
  if (!caught2) ok = false;

  return ok;
}

// Run standalone only when invoked directly (not when imported by compose-digest.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { dir } = await import('../lib/config.mjs');
  const arg = process.argv[2];
  if (arg === '--self-test') {
    const ok = selfTest();
    console.log(ok ? 'SELF-TEST PASS — the gate fails when it must and passes when it should' : 'SELF-TEST FAIL');
    process.exit(ok ? 0 : 1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arg || '')) { console.error('usage: check-attribution.mjs <YYYY-MM-DD> | --self-test'); process.exit(2); }
  const md = readFileSync(join(dir('digestsDir'), `${arg}.md`), 'utf8');
  const facts = JSON.parse(readFileSync(join(dir('factsDir'), `${arg}.json`), 'utf8'));
  const problems = checkAttribution(md, facts.beats);
  if (problems.length) {
    console.log(`✗ ${arg} — ${problems.length} attribution problem(s):`);
    for (const p of problems) console.log('   ' + p);
    console.log('ATTRIBUTION: FAIL — a quote would render in the wrong speaker’s color. Fix the marker.');
    process.exit(1);
  }
  console.log(`✓ ${arg} — every mic quote's color matches its beat source`);
  process.exit(0);
}
