#!/usr/bin/env node
// compose-digest.mjs — STAGE 4 of the digest pipeline.
//
// Turns `facts/<date>.json` into `digests/<date>.md`. This stage has NO access to the transcripts,
// the repos, or the network: its whole world is a room holding the typed facts file and the writer's
// contract. That is the point — if a fact is not in the typed file it cannot appear in the digest,
// which is what makes the digest impossible to hallucinate into.
//
// Runs in the shared kernel jail (lib/contained-spawn.mjs). Note the asymmetry with stage 2: SELECT
// reads untrusted transcript text and so is contained to protect the SHOP; COMPOSE reads only
// already-gated typed facts and is contained to protect the OUTPUT — it cannot reach past its
// evidence even if it wanted to.
//
// Usage: node bin/compose-digest.mjs 2026-07-30 [--model <id>] [--keep-room]
// Writes digests/<date>.md, then runs the redaction gate on it and refuses on any hit.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnContained } from '../lib/contained-spawn.mjs';
import { checkAttribution } from './check-attribution.mjs';
import { config, dir, path as cfgPath } from '../lib/config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGING = dir('stagingDir');
const CONTRACTS = dir('contractsDir');
const TOOLS = 'Read,Grep,Glob,Write';

// The site host + production tree come from config. If the site host is set, the composer is required
// to link the day's public face; if the production tree is set, the link must resolve to a real page.
let SITE_HOST = '';
try { SITE_HOST = new URL(config.siteUrl).host.replace(/^www\./, ''); } catch { SITE_HOST = ''; }
const SITE_PROD = cfgPath(config.siteProductionDir);

const DATE = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE || '')) { console.error('usage: compose-digest.mjs YYYY-MM-DD'); process.exit(2); }
const mi = process.argv.indexOf('--model');
const MODEL = mi > -1 ? process.argv[mi + 1] : config.model;
const KEEP = process.argv.includes('--keep-room');

const factsPath = join(dir('factsDir'), `${DATE}.json`);
if (!existsSync(factsPath)) { console.error(`no facts at ${factsPath} — run: node bin/select.mjs ${DATE}`); process.exit(1); }
const facts = JSON.parse(readFileSync(factsPath, 'utf8'));

// Resolve the destination and refuse a clobber BEFORE spawning anything.
const oi = process.argv.indexOf('--out');
const digestPath = oi > -1 ? resolve(process.argv[oi + 1]) : join(dir('digestsDir'), `${DATE}.md`);
if (oi === -1 && existsSync(digestPath) && !process.argv.includes('--force')) {
  console.error(`REFUSED: digests/${DATE}.md already exists. Re-composing would fork the published record from the file. Pass --force to replace it, or --out <path> to write a copy elsewhere.`);
  process.exit(1);
}

const BRIEF = `# COMPOSE — write the day's issue

Your entire world is this folder. Read:

- \`FACTS.json\` — the typed, already-verified record of one day in the shop. **It is your ONLY
  source.** You have no transcripts, no repos, no network. If a fact is not in that file, it cannot
  appear in the issue — do not reach for anything you merely remember or assume.
- \`DIGEST-WRITER-CONTRACT.md\` — the voice and the laws. They bind you. Read before writing.
- \`PUBLIC-SURFACES.md\` — the map of every public page and repo you are allowed to link. **Read it
  before you write the opening**, because the link law below requires a link and this file is the only
  place you can learn what exists. \`TONE.md\` and \`BEATS.md\` are here too, referenced by the contract.

Write \`DIGEST.md\` in this folder, in exactly this shape:

\`\`\`
# <headline — plain, specific, no hype; what the day actually was>

<!-- meta: date=${DATE} reconstructed=${facts.reconstructed ? 'true' : 'false'} dek="<one sentence, plain>" tags="<1–3 slugs from the contract's tag table, space-separated>" -->

<opening paragraphs: the day in the machine's own voice>

## <a section per real thread of work>

<paragraphs>

**Steal this if it's useful:** <one genuinely reusable lesson from the day — only if the day has one>

## From the microphone

> <a beat whose source is "operator": the quote, copied VERBATIM — character for character>

— <time of day in words, e.g. "8:15 in the morning">, <a few words of context>

**Our note:** <the beat's machine_note, in your voice — concede where the operator was right>

>> <a beat whose source is "machine": the shop's OWN quote, VERBATIM — the line starts with two > >

— <time of day in words>, <a few words of context>

**Our note:** <the beat's machine_note, in your voice>

<repeat per beat — the marker follows each beat's \`source\` field, see law 7>

## Ask us about any of this

<a closing paragraph inviting a reply, reactive to what today actually held>
\`\`\`

## The laws that will be checked

1. **Quotes are VERBATIM from FACTS.json.** Copy each beat's \`quote\` exactly — never re-punctuate,
   trim inside, or tidy voice-to-text. This is checked mechanically and a mismatch refuses the run.
2. **Never name a beat's type.** The pool ("smartest", "dumbest", …) is internal. No bucket labels
   appear anywhere in the issue.
3. **The ledger runs both ways.** Where the day's record says the machine was wrong, say so plainly.
   Never manufacture balance either.
4. **No private names. No dollar figures except public prices. No keys, no credential paths, no
   machine paths.** A redaction gate runs on your output; a hit means the day does not publish.
5. **A quiet day is a normal issue**, not a failure — if \`beats\` is empty, omit the microphone
   section entirely and let the work stand alone. Never invent a beat to fill a slot.
6. **Nothing here sends.** You are writing a file.
7. **The quote marker follows the beat's \`source\` (checked mechanically).** \`source: "operator"\` →
   start the quote line with a single \`> \`; it renders in the operator's rust. \`source: "machine"\`
   (a beat where the shop is quoting ITSELF) → start the quote line with \`>> \`; it renders in shop
   green. **Rust is ALWAYS the operator's voice, never the machine's.** A marker that disagrees with
   the beat's source refuses the run.
8. **The meta line carries \`dek\` and \`tags\`, and NO \`kicker\`.** Tags come from the table in
   \`DIGEST-WRITER-CONTRACT.md\` — one to three slugs, space-separated. The archive's tag filter is
   built from this field alone, so an issue with no tags is invisible to every filter on the page.
${SITE_HOST ? `
9. **The issue MUST carry at least one in-body markdown link, and at least one of them MUST point
   at \`https://${SITE_HOST}/…\` (checked mechanically — this is the law that most often refuses a
   day).** The topic hook carries it: when the day's work has a public face, link that face. An
   off-site link alone does NOT satisfy this — a code host answers "where is the code," the site
   answers "where can I see it," and the issue owes the reader both. **Link only a surface listed in
   \`PUBLIC-SURFACES.md\`** — a guessed or remembered path is checked against the real published tree
   and refuses the run. If nothing from the day has a matching public page, link the closest true one
   (the archive, or the relevant product page) rather than shipping no link at all.

` : ''}Write the file, then stop. Output nothing else — the file is your deliverable.
`;

const room = join(STAGING, `compose-room-${DATE}`);
rmSync(room, { recursive: true, force: true });
mkdirSync(room, { recursive: true });
copyFileSync(factsPath, join(room, 'FACTS.json'));
copyFileSync(join(CONTRACTS, 'DIGEST-WRITER-CONTRACT.md'), join(room, 'DIGEST-WRITER-CONTRACT.md'));
// ★ EVERY FILE THE CONTRACT TELLS THE COMPOSER TO READ HAS TO BE IN THE ROOM. The composer is
// CONTAINED — its whole world is this folder — so a contract line saying "read X" is a dead reference
// unless X was copied in. The instruction and the material have to travel together.
for (const ref of ['PUBLIC-SURFACES.md', 'TONE.md', 'BEATS.md']) {
  const src = join(CONTRACTS, ref);
  if (existsSync(src)) copyFileSync(src, join(room, ref));
  else console.warn(`compose: DIGEST-WRITER-CONTRACT references ${ref} but it is not on disk — composer will work without it`);
}
writeFileSync(join(room, 'BRIEF.md'), BRIEF);

console.log(`compose ${DATE}: 1 contained spawn (${MODEL}) · ${facts.work?.length || 0} work item(s), ${facts.beats?.length || 0} beat(s)`);
const { secs } = spawnContained(resolve(room), BRIEF, { model: MODEL, tools: TOOLS, label: `compose ${DATE}` });

const outPath = join(room, 'DIGEST.md');
if (!existsSync(outPath)) { console.error(`COMPOSE FAILED (${secs}s): no DIGEST.md written`); process.exit(1); }
const md = readFileSync(outPath, 'utf8');

// ---- structural checks the renderer depends on ----
const bad = [];
if (!/^#[ \t]+\S/m.test(md)) bad.push('no `# headline` line');
if (!new RegExp(`<!--\\s*meta:[^>]*date=${DATE}`).test(md)) bad.push(`meta line missing or wrong date (must carry date=${DATE})`);
if (md.length < 800) bad.push(`suspiciously short (${md.length} chars)`);
// The beat pool is internal vocabulary — a leaked bucket label is a contract violation.
for (const t of ['smartest', 'dumbest', 'funniest', 'right_wrong_reason', 'out_of_depth', 'didnt_know',
  'machine_was_right', 'changed_their_mind', 'both_missed_it', 'who_was_right', 'machine_note']) {
  if (new RegExp(`\\b${t}\\b`).test(md)) bad.push(`leaks the internal beat vocabulary "${t}"`);
}
// ---- the public-link gate (only when a site host is configured) ----
if (SITE_HOST) {
  const bodyLinks = [...md.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
  const siteRe = new RegExp(`^https:\\/\\/(www\\.)?${SITE_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\/|$)`);
  const siteLinks = bodyLinks.filter((u) => siteRe.test(u));
  if (!bodyLinks.length) {
    bad.push(`no in-body link at all — the topic hook must link the day's matching public asset (see PUBLIC-SURFACES.md)`);
  } else if (!siteLinks.length) {
    bad.push(`links only off-site and never to ${SITE_HOST} — link the public FACE of the work too (PUBLIC-SURFACES.md)`);
  }
  // Never ship a guessed path. When the production tree is known, site links must resolve to a real file.
  if (SITE_PROD) {
    for (const u of [...new Set(siteLinks)]) {
      const rel = u.replace(siteRe, '').split(/[?#]/)[0];
      if (!rel) continue;                                   // the bare site root always exists
      const candidates = [join(SITE_PROD, rel), join(SITE_PROD, rel, 'index.html'), join(SITE_PROD, `${rel}.html`)];
      if (!candidates.some((p) => existsSync(p))) bad.push(`site link does not resolve to a real page: ${u}`);
    }
  }
}

// ---- the verbatim gate again, now facts -> digest ----
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const body = norm(md);
for (const b of facts.beats || []) {
  if (!b.quote) continue;
  if (!body.includes(norm(b.quote))) bad.push(`beat quote not carried verbatim into the issue: "${String(b.quote).slice(0, 70)}…"`);
}
// Attribution/speaker-color gate (rust = operator, green = shop) — the SAME code check-attribution.mjs
// self-tests, so the rule has a check that can be watched to fail.
for (const p of checkAttribution(md, facts.beats)) bad.push(p);
if (bad.length) {
  console.error(`COMPOSE REFUSED (${secs}s):`);
  for (const b of bad) console.error('  ✗ ' + b);
  process.exit(1);
}

mkdirSync(dirname(digestPath), { recursive: true });
writeFileSync(digestPath, md);
if (!KEEP) rmSync(room, { recursive: true, force: true });

try {
  execFileSync('node', [join(HERE, 'gate.mjs'), digestPath], { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  console.error(`REDACTION GATE REFUSED ${DATE} — the day does not publish. Raise it.`);
  console.error(((e.stdout || '') + (e.stderr || '')).trim().slice(0, 1200));
  process.exit(1);
}
console.log(`composed in ${secs}s · ${md.length} chars · quotes verbatim · gate clean`);
console.log(`digest: ${digestPath}`);
