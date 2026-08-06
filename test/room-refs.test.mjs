// room-refs.test.mjs — every file a contained agent is TOLD to read must be IN its room.
//
// THE MISTAKE THIS CATCHES: a contract is updated to say "★ READ PUBLIC-SURFACES.md for the full map"
// and that file is never copied into the composer's staging room. The composer is CONTAINED; its whole
// world is that folder. So it is told to link the day's public asset while holding no map of what the
// assets are, emits no link, and the link gate refuses the whole day.
//
// An instruction and the material it refers to have to travel together, and a jail turns that from
// good manners into a hard requirement. A contract line pointing at a file the agent cannot open is
// worse than no line at all — it reads as satisfied and isn't.
//
// This asserts the staging rooms are complete. It reads the BUILDERS, not a hand-kept list, so a new
// reference added to a contract fails here until somebody copies the file in.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dir, ROOT } from '../lib/config.mjs';

const BIN = join(ROOT, 'bin');
const CONTRACTS = dir('contractsDir');

// Which builder assembles which agent's room, and which contract that agent is handed.
const LANES = [
  { name: 'composer', builder: 'compose-digest.mjs', contracts: ['DIGEST-WRITER-CONTRACT.md'] },
  { name: 'selector', builder: 'select.mjs', contracts: ['BEATS.md'] },
];

// A contract INSTRUCTS the agent to open a doc only when it says so — not merely by naming it. So only
// lines carrying an actual read verb count. Flatten first, then look backwards from each filename,
// because these contracts are hard-wrapped and the real instruction can read "★ READ" at the end of
// one line with the filename at the start of the next.
const READ_VERB = /\b(read|see|consult|obey|follow|refer to)\b/i;
const LOOKBACK = 140;
function referencedDocs(contractText) {
  const flat = contractText.replace(/\s+/g, ' ');
  const names = new Set();
  for (const m of flat.matchAll(/\b([A-Z][A-Za-z0-9-]*\.md)\b/g)) {
    const n = m[1];
    if (/^\d/.test(n)) continue;                    // YYYY-MM-DD.md — an output, not a doc
    if (!existsSync(join(CONTRACTS, n))) continue;  // lives elsewhere — not a room question
    const before = flat.slice(Math.max(0, m.index - LOOKBACK), m.index);
    if (READ_VERB.test(before)) names.add(n);
  }
  return [...names];
}

// ASK WHAT THE BUILDER COPIES, NOT WHAT IT MENTIONS — a plain src.includes(name) passes on the
// builder's own comment or an error string that names the file while the copy is gone. Extract the
// real copy targets from the two shapes the builders use, and nothing else can satisfy it.
function copiedDocs(builderSrc) {
  const out = new Set();
  for (const m of builderSrc.matchAll(/copyFileSync\(\s*join\([^)]*?['"]([A-Za-z0-9_.-]+\.md)['"]/g)) out.add(m[1]);
  for (const m of builderSrc.matchAll(/for\s*\(\s*const\s+\w+\s+of\s*\[([^\]]*)\]/g)) {
    for (const q of m[1].matchAll(/['"]([A-Za-z0-9_.-]+\.md)['"]/g)) out.add(q[1]);
  }
  return out;
}

for (const lane of LANES) {
  const builderSrc = readFileSync(join(BIN, lane.builder), 'utf8');
  const copied = copiedDocs(builderSrc);

  for (const contract of lane.contracts) {
    const contractPath = join(CONTRACTS, contract);
    if (!existsSync(contractPath)) continue;

    test(`${lane.name}: every doc ${contract} names is copied into its room`, () => {
      const missing = referencedDocs(readFileSync(contractPath, 'utf8'))
        .filter((n) => n !== contract)
        .filter((n) => !copied.has(n));
      assert.deepStrictEqual(missing, [],
        `${lane.builder} does not copy ${missing.join(', ')} into the staging room, but ${contract} ` +
        `tells the agent to read ${missing.length > 1 ? 'them' : 'it'}. The agent is contained — it ` +
        `cannot reach outside the room, so that instruction silently does nothing.`);
    });
  }

  test(`${lane.name}: its own contract is in the room`, () => {
    for (const c of lane.contracts) {
      if (!existsSync(join(CONTRACTS, c))) continue;
      assert.ok(copied.has(c), `${lane.builder} never copies ${c} in`);
    }
  });
}

test('a referenced doc that vanishes from disk warns by name', () => {
  const src = readFileSync(join(BIN, 'compose-digest.mjs'), 'utf8');
  assert.match(src, /console\.warn\([^)]*\$\{ref\}/,
    'the composer no longer names the missing doc when it warns — a nameless warning is not actionable');
});
