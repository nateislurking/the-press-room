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
//
// Two lane SHAPES, and the difference decides what "in the room" even means:
//   copied  — the builder stages a folder and copyFileSync's the contract plus its material in.
//             Every doc the contract says to read must appear among those copies.
//   inlined — the builder reads the contract and injects its TEXT into the prompt (compose.mjs does
//             this), and the room is the reading room, built separately from PUBLISHED material only.
//             The contract itself is therefore always present, but NOTHING else from this repo is —
//             so a reference to any repo file at all is dead on arrival.
const LANES = [
  { name: 'composer', builder: 'compose-digest.mjs', contracts: ['DIGEST-WRITER-CONTRACT.md'], shape: 'copied' },
  { name: 'selector', builder: 'select.mjs', contracts: ['BEATS.md'], shape: 'copied' },
  { name: 'reply composer', builder: 'compose.mjs', contracts: ['REPLY-WRITER-CONTRACT.md'], shape: 'inlined' },
];

// A contract INSTRUCTS the agent to open a doc only when it says so — not merely by naming it. So only
// lines carrying an actual read verb count. Flatten first, then look backwards from each filename,
// because these contracts are hard-wrapped and the real instruction can read "★ READ" at the end of
// one line with the filename at the start of the next.
const READ_VERB = /\b(read|see|consult|obey|follow|refer to)\b/i;
const LOOKBACK = 140;

// ★ THE REGEX USED TO BE /\b([A-Z][A-Za-z0-9-]*\.md)\b/ — uppercase-initial, .md only. That shape is
// exactly the set of files this project happens to name its contracts, so the test could only ever
// catch a contract pointing at another contract. It went blind to the reference that actually shipped
// broken: "see the tag block in `bin/build-site-archive.mjs`" — lowercase, .mjs, and pointing OUT of
// the room entirely. Match any filename with a code-or-doc extension, in any case, and let the
// classifier below decide what it means.
const FILENAME = /\b([A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|mjs|js|json|sh|txt|html))\b/g;

// Files the ROOM ITSELF produces or receives at runtime. They are not repo files and are never copied
// by a builder, so a contract naming them is correct, not broken.
const ROOM_ARTIFACTS = new Set([
  'FACTS.json', 'DIGEST.md', 'QUESTION.json', 'ANSWER.json',
  'CANDIDATES.json', 'SELECTION.json', 'EVIDENCE.md', 'BRIEF.md',
]);

// Every filename a contract tells its agent to open, split by where that file actually lives.
//   inContracts — resolves under contracts/, so a builder CAN copy it in. Checkable per lane.
//   outOfRoom   — resolves somewhere else in this repo (bin/, lib/, docs/, test/). No builder copies
//                 these into any room and none ever could; the agent is jailed. Always a dead
//                 reference, in every lane.
function referencedFiles(contractText, selfName) {
  const flat = contractText.replace(/\s+/g, ' ');
  const inContracts = new Set(), outOfRoom = new Set();
  for (const m of flat.matchAll(FILENAME)) {
    const n = m[1];
    if (/^\d/.test(n)) continue;                    // YYYY-MM-DD.md — an output, not a doc
    if (n === selfName) continue;                   // the contract naming itself
    if (ROOM_ARTIFACTS.has(n)) continue;            // produced in the room at runtime
    const before = flat.slice(Math.max(0, m.index - LOOKBACK), m.index);
    if (!READ_VERB.test(before)) continue;          // named in passing, not an instruction
    if (existsSync(join(CONTRACTS, n))) { inContracts.add(n); continue; }
    // Does it exist anywhere else in the repo? Search the folders a jailed agent cannot reach.
    for (const d of ['bin', 'lib', 'docs', 'test', 'examples', '']) {
      if (existsSync(join(ROOT, d, n))) { outOfRoom.add(d ? `${d}/${n}` : n); break; }
    }
  }
  return { inContracts: [...inContracts], outOfRoom: [...outOfRoom] };
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
    const refs = referencedFiles(readFileSync(contractPath, 'utf8'), contract);

    // Applies to EVERY lane shape. bin/, lib/, docs/ are outside every room by construction, so no
    // builder change could ever satisfy such a reference — the contract has to stop making it.
    test(`${lane.name}: ${contract} points at nothing outside the room`, () => {
      assert.deepStrictEqual(refs.outOfRoom, [],
        `${contract} tells the agent to read ${refs.outOfRoom.join(', ')}, which lives outside every ` +
        `room this repo builds. The agent is jailed in its folder — it cannot open bin/, lib/, or ` +
        `docs/, and no builder can copy them in. Put the material in the contract, or in a file ` +
        `under contracts/ that the builder copies.`);
    });

    if (lane.shape === 'copied') {
      test(`${lane.name}: every doc ${contract} names is copied into its room`, () => {
        const missing = refs.inContracts.filter((n) => !copied.has(n));
        assert.deepStrictEqual(missing, [],
          `${lane.builder} does not copy ${missing.join(', ')} into the staging room, but ${contract} ` +
          `tells the agent to read ${missing.length > 1 ? 'them' : 'it'}. The agent is contained — it ` +
          `cannot reach outside the room, so that instruction silently does nothing.`);
      });
    } else {
      // An inlined lane has no staging copies at all, so a reference to ANOTHER contract is just as
      // dead as one to bin/ — the reading room holds published material, never this repo's contracts.
      test(`${lane.name}: ${contract} names no sibling contract (nothing is staged for it)`, () => {
        assert.deepStrictEqual(refs.inContracts, [],
          `${contract} tells the agent to read ${refs.inContracts.join(', ')}, but ${lane.builder} ` +
          `inlines the contract text and stages no files — the reading room holds published material ` +
          `only. Fold what the agent needs into ${contract} itself.`);
      });
    }
  }

  if (lane.shape === 'copied') {
    test(`${lane.name}: its own contract is in the room`, () => {
      for (const c of lane.contracts) {
        if (!existsSync(join(CONTRACTS, c))) continue;
        assert.ok(copied.has(c), `${lane.builder} never copies ${c} in`);
      }
    });
  } else {
    test(`${lane.name}: its own contract is inlined into the prompt`, () => {
      for (const c of lane.contracts) {
        if (!existsSync(join(CONTRACTS, c))) continue;
        assert.match(builderSrc, /readFileSync\(\s*CONTRACT\s*,/,
          `${lane.builder} no longer reads ${c} into the prompt — the agent would be spawned with no ` +
          `contract at all, and nothing else in the room would tell it what it is doing.`);
      }
    });
  }
}

test('a referenced doc that vanishes from disk warns by name', () => {
  const src = readFileSync(join(BIN, 'compose-digest.mjs'), 'utf8');
  assert.match(src, /console\.warn\([^)]*\$\{ref\}/,
    'the composer no longer names the missing doc when it warns — a nameless warning is not actionable');
});
