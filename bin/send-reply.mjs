#!/usr/bin/env node
// send-reply.mjs — HOP C, the one door out of the reply lane. Deterministic: no model runs here.
// Every gate below fails CLOSED — any trip means no send and a loud explanation.
//
// Usage:
//   node bin/send-reply.mjs --draft <answer.json>    # run ALL gates, render, stage to drafts/ (default)
//   node bin/send-reply.mjs --send  <answer.json>    # actually send — refuses unless state/LIVE exists
//                                                    # (you create that file, by hand, once you're ready)
//   node bin/send-reply.mjs --self-test              # plant violations, prove every gate refuses
//
// THE GATES, in order (all must pass):
//   G0  liveness  — the reader token still answers (revoking it stops the send path by construction)
//   G1  HOLD      — no HOLD file in the lane; no un-RESUMEd HOLD email from you in the mailbox
//   G2  intake    — answer's intake_id resolves to a real intake record; recipient := its from_email
//   G3  member    — the intake record shows the sender was a subscriber
//   G4  one-shot  — this intake_id has not already been answered (sends ledger)
//   G5  rate cap  — under the daily cap, your configured zone
//   G6  links     — every URL in the body matches the allowlist (your site / your GitHub user)
//   G6b link-real — every allowlisted URL maps to a REAL file in the published source tree
//   G7  no-quote  — no >=12-word verbatim run from the subscriber's own text (the client-quoted block
//                   — your own copy, pasted under their reply — is CUT before shingling)
//   G8  redaction — the denylist + secret shapes, re-run on the body
//   G9  shape     — disclosed-bots signature present; body 200..8000 chars; subject sane
//   POST-GATE: the outbound subject is FORCED to "Re: <the intake's own subject>" so the reply threads
//   in the reader's client, and a sanitized "You asked" echo of the sender's own question is prepended.
//   Both are deterministic transcriptions of the sender's OWN text, delivered only back to its author.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { config, dir, path as cfgPath, redactionPath, tz } from '../lib/config.mjs';
// The ONE redaction scanner. See the note on G8 in redactionHits().
import { loadLists as gateLoadLists, scan as gateScan } from './gate.mjs';

const INBOX = dir('inboxDir');
const DRAFTS = dir('draftsDir');
const STATE = dir('stateDir');
const LEDGER = join(STATE, 'sends.jsonl');

// Real reader token by default; an env override lets the drill point G0 liveness at a dead token copy.
const JMAP_TOKEN_PATH = process.env.REPLY_LANE_JMAP_TOKEN || cfgPath(config.credentials?.jmapTokenPath);
const RESEND_KEY_PATH = cfgPath(config.credentials?.resendKeyPath);
const ACCOUNT = config.mailAccountId;
const JMAP_API = `${config.mailApiBase}/api/`;
const JMAP_SESSION = `${config.mailApiBase}/session`;
const OWNER_ADDRS = (config.ownerAddresses || []).map((s) => s.toLowerCase());
const RATE_CAP = 10;
const SIGNATURE = '— The shop\'s agents';
const SENDER_NAME = config.senderName;
const REPLY_ADDR = config.replyAddress;

// Resolution config is read through getters so the self-test can point them at temp fixtures via env.
const siteHost = () => process.env.REPLY_LANE_SITE_HOST || (() => { try { return new URL(config.siteUrl).host.replace(/^www\./, ''); } catch { return ''; } })();
const ghUser = () => process.env.REPLY_LANE_GITHUB_USER || config.githubUser || '';
const sitePROD = () => (process.env.REPLY_LANE_SITE_PROD ? cfgPath(process.env.REPLY_LANE_SITE_PROD) : cfgPath(config.siteProductionDir));
const publicReposDir = () => (process.env.REPLY_LANE_PUBLIC_REPOS ? cfgPath(process.env.REPLY_LANE_PUBLIC_REPOS) : cfgPath(config.publicReposDir));
function linkAllow() {
  const out = [];
  const h = siteHost();
  if (h) out.push(new RegExp(`^https:\\/\\/(www\\.)?${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([/#?]|$)`));
  const u = ghUser();
  if (u) out.push(new RegExp(`^https:\\/\\/github\\.com\\/${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/`));
  return out;
}

const fail = [];
const gate = (name, ok, why) => { if (!ok) fail.push(`${name}: ${why}`); return ok; };

// ---------- gate implementations ----------
async function jmapSession() {
  try {
    const tok = readFileSync(JMAP_TOKEN_PATH, 'utf8').trim();
    const r = await fetch(JMAP_SESSION, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    return { tok, session: await r.json() };
  } catch { return null; }
}

async function holdEmailStanding(tok) {
  const r = await fetch(JMAP_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
      methodCalls: [
        ['Email/query', { accountId: ACCOUNT, sort: [{ property: 'receivedAt', isAscending: false }], limit: 100 }, '0'],
        ['Email/get', { accountId: ACCOUNT, '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' }, properties: ['subject', 'from', 'receivedAt'] }, '1'],
      ],
    }),
  });
  if (!r.ok) return true; // can't verify => treat as holding (fail closed)
  const list = (await r.json()).methodResponses.find(([n]) => n === 'Email/get')?.[1]?.list || [];
  let latest = null;
  for (const e of list) {
    const from = (e.from && e.from[0] && e.from[0].email || '').toLowerCase();
    if (!OWNER_ADDRS.includes(from)) continue;
    const s = e.subject || '';
    const kind = /\bHOLD\b/.test(s) ? 'HOLD' : /\bRESUME\b/.test(s) ? 'RESUME' : null;
    if (kind && (!latest || e.receivedAt > latest.at)) latest = { kind, at: e.receivedAt };
  }
  return latest?.kind === 'HOLD';
}

function parseRedaction() {
  const txt = readFileSync(redactionPath(), 'utf8');
  const deny = [...txt.matchAll(/^- deny: (.+)$/gm)].map((m) => m[1].trim());
  const allowDollar = new Set((txt.match(/^- allow-dollar: (.+)$/m)?.[1] || '').split(/\s+/).filter(Boolean));
  const regexes = [];
  for (const m of txt.matchAll(/^- deny-regex: (.+)$/gm)) { try { regexes.push(new RegExp(m[1].trim(), 'i')); } catch { /* ignore a bad regex */ } }
  return { deny, allowDollar, regexes };
}

function redactionHits(body) {
  const hits = [];
  const { deny, allowDollar, regexes } = parseRedaction();
  for (const name of deny) if (body.toLowerCase().includes(name.toLowerCase())) hits.push(`denylist name "${name}"`);
  // Key/token shapes, prefix-anchored so a bare hex run (a commit sha / a published hash — a receipt,
  // not a secret) stays allowed while a hex run wearing a key prefix is caught even when all-lowercase.
  if (/\bsk-[A-Za-z0-9-]{18,}/i.test(body)) hits.push('sk- key shape');
  if (/\bre_[A-Za-z0-9]{16,}\b/.test(body)) hits.push('re_ key shape');
  if (/Bearer\s+[A-Za-z0-9._-]{16,}/.test(body)) hits.push('Bearer token shape');
  if (/(?:^|[^A-Za-z0-9])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9_-]{28,}(?![A-Za-z0-9])/.test(body)) hits.push('long mixed-case token run');
  if (/(\/home\/[a-z_]|\/Users\/[A-Za-z0-9]|C:\\Users\\)/.test(body)) hits.push('absolute machine path');
  for (const m of body.matchAll(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/g)) {
    const whole = m[1].replaceAll(',', '');
    if (!allowDollar.has(whole)) hits.push(`dollar figure $${m[1]} outside locked set`);
  }
  for (const re of regexes) if (re.test(body)) hits.push(`deny-regex ${re}`);

  // ★ THE SHARED SCANNER — everything above is this file's OWN reimplementation of the redaction
  // rules, and it had drifted BELOW the digest's. It parsed 3 of the denylist's 5 rule types and
  // skipped `deny-scope:` (out-of-scope subject matter), `allow-email:`, and the app-password shapes,
  // with looser sk-/Bearer/token thresholds besides. The docs said both pipelines shared one gate;
  // the pipeline answering UNTRUSTED MAIL FROM STRANGERS was running the weaker one.
  //
  // Rather than copy the missing rules down here — which would re-create the divergence somewhere new
  // and leave two things to keep in sync forever — G8 now runs gate.mjs's ACTUAL scanner. The local
  // rules above are KEPT deliberately: they are a second opinion on the same body, and swapping a
  // working check for a different one trades one gap for another. Belt and suspenders; one source of
  // truth for the belt.
  try {
    for (const h of gateScan(body, gateLoadLists())) hits.push(`shared-gate [${h.rule}] ${h.match}`);
  } catch (e) {
    // A scanner that cannot run is not a scanner that passed. Fail closed, loudly.
    hits.push(`shared-gate UNAVAILABLE (fail-closed): ${e.message}`);
  }
  return hits;
}

// ---------- G7 helper: what the subscriber ACTUALLY typed ----------
function subscriberOwnText(raw) {
  const ATTRIB = [
    /^\s*On\s.{4,120}\bwrote:\s*$/i,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
    /^\s*_{10,}\s*$/,
  ];
  const out = [];
  for (const ln of String(raw || '').split(/\r?\n/)) {
    if (ATTRIB.some((re) => re.test(ln))) break;   // everything from here down is quoted material
    if (/^\s*>/.test(ln)) continue;                // an inline quoted line, wherever it sits
    out.push(ln);
  }
  return out.join('\n');
}

function quotedRunOverlap(incoming, outgoing, n = 12) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const inW = norm(subscriberOwnText(incoming)), outStr = ' ' + norm(outgoing).join(' ') + ' ';
  for (let i = 0; i + n <= inW.length; i++) {
    const shingle = ' ' + inW.slice(i, i + n).join(' ') + ' ';
    if (outStr.includes(shingle)) return inW.slice(i, i + n).join(' ');
  }
  return null;
}

function sendsToday() {
  if (!existsSync(LEDGER)) return [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  return readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((s) => s.sent_central_date === today);
}

function findIntake(intakeId) {
  if (!existsSync(INBOX)) return null;
  for (const f of readdirSync(INBOX)) {
    if (!f.endsWith('.json')) continue;
    const rec = JSON.parse(readFileSync(join(INBOX, f), 'utf8'));
    if (rec.id === intakeId) return rec;
  }
  return null;
}

function extractUrls(md) { return [...md.matchAll(/https?:\/\/[^\s)>\]"']+/g)].map((m) => m[0]); }

// ---- G6b: a cited link is real iff it maps to a file in the published source tree ----
const _tracked = {};
function repoTracked(repo) {
  if (!(repo in _tracked)) {
    try { _tracked[repo] = new Set(execFileSync('git', ['-C', join(publicReposDir(), repo), 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)); }
    catch { _tracked[repo] = null; }
  }
  return _tracked[repo];
}
// returns null when the citation maps to a real published artifact, else a reason string
function citationUnreal(u) {
  const clean = u.split('#')[0].split('?')[0].replace(/[.,;:!?]+$/, '').replace(/\/+$/, '');
  const user = ghUser();
  const host = siteHost();
  const prod = sitePROD();
  let m;
  // a repo file: github.com/<user>/<repo>/blob/<ref>/<path> -> a TRACKED file in the clone
  if (user && (m = clean.match(new RegExp(`^https:\\/\\/github\\.com\\/${user}\\/([^/]+)\\/blob\\/[^/]+\\/(.+)$`)))) {
    const [, repo, path] = m;
    const tracked = repoTracked(repo);
    if (tracked === null) return `repo ${repo} not present locally to verify citation`;
    return tracked.has(path) ? null : `cites ${repo}/${path} — not a tracked file in that repo`;
  }
  // a repo/collection root or a tree subpath -> the path exists in the clone
  if (user && (m = clean.match(new RegExp(`^https:\\/\\/github\\.com\\/${user}\\/([^/]+)(?:\\/tree\\/[^/]+(?:\\/(.+))?)?$`)))) {
    const [, repo, sub] = m;
    return existsSync(join(publicReposDir(), repo, sub || '')) ? null : `cites ${repo}${sub ? '/' + sub : ''} — not present in that repo`;
  }
  if (host) {
    const hostRe = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // an archive issue -> <prod>/archive/<day>.html
    if ((m = clean.match(new RegExp(`^https:\\/\\/(?:www\\.)?${hostRe}\\/archive\\/([^/]+?)(?:\\.html)?$`)))) {
      return prod && existsSync(join(prod, 'archive', `${m[1]}.html`)) ? null : `cites archive/${m[1]} — no such published issue`;
    }
    // any other site page or root -> a real page or directory in production
    if ((m = clean.match(new RegExp(`^https:\\/\\/(?:www\\.)?${hostRe}(?:\\/(.*))?$`)))) {
      const rel = m[1] || 'index.html';
      for (const c of [rel, `${rel}.html`, join(rel, 'index.html')]) if (c && prod && existsSync(join(prod, c))) return null;
      return `cites ${host}/${m[1] || ''} — no such published page`;
    }
  }
  return `unrecognized citation shape: ${u}`;
}

// ---- the sender-echo carve-out: deterministic, sender-only ----
function forceSubject(intake) {
  const raw = String(intake?.subject_quarantined || '')
    .replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(re\s*:\s*)+/i, '').trim();
  return `Re: ${raw || 'your question'}`.slice(0, 150);
}

function extractQuestion(bodyQuarantined) {
  const text = String(bodyQuarantined || '').replace(/\r\n/g, '\n');
  let cut = text.length;
  for (const re of [/^On [\s\S]{0,300}?wrote:\s*$/m, /^\s*>/m, /^-- ?$/m]) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  let q = text.slice(0, cut).replace(/https?:\/\/[^\s)>\]"']+/g, '[link removed]').trim();
  if (q.length > 600) q = q.slice(0, 600).trimEnd() + ' …';
  return q;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderSources(answer) {
  const cites = Array.isArray(answer?.citations) ? answer.citations : [];
  if (!cites.length) return '';
  const rows = cites.map((u) => {
    const safe = u.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return `<p style="margin:0 0 7px;font:400 14px/1.5 Barlow,Arial,sans-serif;"><a href="${safe}" style="color:#0077C0;text-decoration:none;word-break:break-word;">${safe}</a></p>`;
  }).join('\n');
  return `<div style="margin:26px 0 0;padding:18px 0 2px;border-top:1px solid #DAD0B6;">
<p style="margin:0 0 10px;font:600 11px/1.4 'JetBrains Mono',Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;color:#5C5A30;">Sources</p>
${rows}
</div>`;
}

const stripBodySources = (md) =>
  String(md).replace(/\n\s*(?:sources?|links?)\s*:?\s*\n(?:\s*(?:[-*]\s*)?https?:\/\/\S+\s*)+$/i, '').trimEnd();

function renderEmail(answer, intake) {
  const q = extractQuestion(intake?.body_quarantined);
  const echo = q ? `<div style="margin:0 0 22px;padding:12px 16px;border-left:3px solid #DAD0B6;background:#E7D9BC;border-radius:0 8px 8px 0;">
<p style="margin:0 0 6px;font:600 11px/1.4 'JetBrains Mono',Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;color:#5C5A30;">You asked</p>
<p style="margin:0;font:italic 400 15px/1.55 Barlow,Arial,sans-serif;color:#1A1F18;">${esc(q).replace(/\n/g, '<br>')}</p>
</div>` : '';
  const paras = stripBodySources(answer.body_md).split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 16px;font:400 17px/1.65 Barlow,Arial,sans-serif;color:#1A1F18;">${p
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" style="color:#0077C0;text-decoration:none;">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(forceSubject(intake))}</title></head>
<body style="margin:0;padding:0;background:#EEE1C6;"><div style="max-width:640px;margin:0 auto;padding:32px 20px 48px;">
<div style="border:1px solid #DAD0B6;border-radius:11px;overflow:hidden;margin:0 0 26px;">
<div style="background:#00310F;color:#9CC6A4;font:600 11px/1.4 'JetBrains Mono',Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;padding:9px 14px;">
From the Shop Floor &nbsp;&middot;&nbsp; the agents, answering your question</div></div>
${echo}${paras}
${renderSources(answer)}
<p style="margin:20px 0 4px;font:600 15px/1.5 'JetBrains Mono',Consolas,monospace;color:#00310F;">${esc(SIGNATURE)}</p>
<p style="margin:0;font:400 12px/1.5 'JetBrains Mono',Consolas,monospace;color:#5C5A30;">Nobody edits anything we send. Reply again anytime.</p>
</div></body></html>`;
}

// ---------- the run ----------
async function runGates(answer, { skipNetwork = false } = {}) {
  let intake = null;
  if (!skipNetwork) {
    const live = await jmapSession();
    const ownerUser = OWNER_ADDRS.length ? live?.session?.username : undefined;
    if (gate('G0 liveness', !!live, 'reader token revoked or not answering — lane stopped') && live) {
      gate('G1 HOLD-email', !(await holdEmailStanding(live.tok)), 'a HOLD from you stands in the mailbox');
    }
  }
  gate('G1 HOLD-file', !existsSync(cfgPath('HOLD')), 'HOLD file present in the lane');
  gate('shape schema', answer?.schema === 'reply-lane/answer@1', 'not a reply-lane answer envelope');
  gate('shape no-recipient', !('to' in (answer || {})) && !('recipient' in (answer || {})), 'envelope carries a recipient field — the model never picks recipients');
  intake = answer?.intake_id ? findIntake(answer.intake_id) : null;
  if (gate('G2 intake', !!intake, `no intake record for id ${answer?.intake_id}`)) {
    gate('G3 member', !!(intake.membership && (intake.membership.daily || intake.membership.general)), 'sender is not a subscriber');
    const prior = existsSync(LEDGER) && readFileSync(LEDGER, 'utf8').includes(`"intake_id":"${answer.intake_id}"`);
    gate('G4 one-shot', !prior, 'this reply was already answered');
    const q = quotedRunOverlap(intake.body_quarantined || '', answer.body_md || '');
    gate('G7 no-quote', !q, `verbatim subscriber text in outbound: "${q}"`);
  }
  gate('G5 rate', sendsToday().length < RATE_CAP, `daily rate cap ${RATE_CAP} reached`);
  const bodyUrls = extractUrls(answer?.body_md || '');
  const citeUrls = Array.isArray(answer?.citations) ? answer.citations : [];
  const allow = linkAllow();
  const allowedUrls = [];
  for (const u of [...bodyUrls, ...citeUrls]) {
    const onList = allow.some((re) => re.test(u));
    gate('G6 links', onList, `off-allowlist URL ${u}`);
    if (onList) allowedUrls.push(u);
  }
  for (const u of [...new Set(allowedUrls)]) {
    const why = citationUnreal(u);
    gate('G6b link-real', !why, why || '');
  }
  for (const h of redactionHits(answer?.body_md || '')) gate('G8 redaction', false, h);
  gate('G9 signature', !(answer?.body_md || '').includes(SIGNATURE), 'body carries its own sign-off — the template footer signs; remove it from body_md');
  const len = (answer?.body_md || '').length;
  gate('G9 length', len >= 200 && len <= 8000, `body ${len} chars outside 200..8000`);
  gate('G9 subject', !!answer?.subject && answer.subject.length <= 150, 'subject missing or too long');
  return intake;
}

// ---------- self-test ----------
// Assembled from short fragments (asm) so this file carries no live-looking secret literal, while the
// runtime string is still a real trip. Fixtures for G6/G6b are BUILT in a temp tree so the self-test
// needs no live site or repo.
const asm = (...p) => p.join('');
async function selfTest() {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmp = mkdtempSync(join(tmpdir(), 'press-room-sendtest-'));
  const siteDir = join(tmp, 'site'); const reposDir = join(tmp, 'repos');
  mkdirSync(join(siteDir, 'archive'), { recursive: true });
  writeFileSync(join(siteDir, 'archive', '2026-07-26.html'), '<!doctype html><title>issue</title>');
  writeFileSync(join(siteDir, 'index.html'), '<!doctype html><title>home</title>');
  const repo = join(reposDir, 'the-press-room');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'x@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'x']);
  writeFileSync(join(repo, 'NOTES.md'), '# notes\n');
  execFileSync('git', ['-C', repo, 'add', 'NOTES.md']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'seed']);
  process.env.REPLY_LANE_SITE_HOST = 'example.com';
  process.env.REPLY_LANE_SITE_PROD = siteDir;
  process.env.REPLY_LANE_PUBLIC_REPOS = reposDir;
  process.env.REPLY_LANE_GITHUB_USER = 'testuser';
  const SITE = 'https://example.com';
  const GH = 'https://github.com/testuser/the-press-room';

  mkdirSync(INBOX, { recursive: true });
  const fakeIntake = {
    schema: 'reply-lane/intake@1', id: 'SELFTEST-INTAKE-1', from_email: 'selftest@example.com',
    received_at: '2026-01-01T00:00:00Z', subject_quarantined: 'test',
    body_quarantined: 'please tell me exactly how the redaction gate works because I want to understand the whole pipeline you built for the shop floor digest system thanks',
    membership: { subscriber: true, daily: true, general: true },
  };
  writeFileSync(join(INBOX, 'SELFTEST-INTAKE-1.json'), JSON.stringify(fakeIntake, null, 2));
  const quotedIntake = {
    ...fakeIntake, id: 'SELFTEST-QUOTED-1',
    body_quarantined: [
      'You asked whether the colour work of the nineteen thirties maps onto our own gauges at all,',
      'and whether any of it survives the jump from a factory floor to a metaphor.',
      '',
      'On Tue, Aug 4, 2026, at 06:20, The Shop wrote:',
      '> We also drew a clearer line between the billing gauge, which reflects the actual bill,',
      '> and the usage estimate, which runs on list price math and will drift from it.',
    ].join('\n'),
  };
  writeFileSync(join(INBOX, 'SELFTEST-QUOTED-1.json'), JSON.stringify(quotedIntake, null, 2));
  writeFileSync(join(INBOX, 'SELFTEST-INTAKE-2.json'), JSON.stringify({ ...fakeIntake, id: 'SELFTEST-INTAKE-2', membership: { subscriber: false, daily: false, general: false } }, null, 2));

  const good = `Great question about the gate. The denylist lives beside the pipeline and the gate parses it at run time, so an edit to the file is an edit to the gate. The tradeoff we accepted: mechanical patterns only, with a fail-closed default — a hit means the day simply does not publish. You can read the rendered issues at ${SITE}/archive for how it lands in practice, and the fail-closed idea shows up all over the shop for the same reason.`;
  const A = (over) => ({ schema: 'reply-lane/answer@1', intake_id: 'SELFTEST-INTAKE-1', subject: 'Re: the gate', body_md: good, ...over });
  const skKey = asm('sk', '-', 'A1b2C3d4', 'E5f6G7h8', 'I9j0K1l2', 'M3n4');
  const reKey = asm('re', '_', 'A1b2C3d4', 'E5f6G7h8', 'I9j0K1l2');
  const forgePath = asm('/', 'home/', 'someone', '/vault/x.key');
  const cases = [
    ['clean answer passes', A({}), true],
    ['off-domain link refused', A({ body_md: good.replace(`${SITE}/archive`, 'https://evil.example.org/x') }), false],
    ['verbatim subscriber quote refused', A({ body_md: 'You asked: please tell me exactly how the redaction gate works because I want to understand the whole pipeline you built for the shop floor — here is the answer at length with plenty of words to pass size.\n\n' + good.slice(0, 160) }), false],
    ['our own quoted block reused passes', { ...A({}), intake_id: 'SELFTEST-QUOTED-1', body_md: good + ' To restate it: the billing gauge reflects the actual bill while the usage estimate runs on list price math and will drift from it.' }, true],
    ['subscriber text still refused when a quote block follows', { ...A({}), intake_id: 'SELFTEST-QUOTED-1', body_md: 'You asked whether the colour work of the nineteen thirties maps onto our own gauges at all, and here is the answer at length with plenty of words to clear the size floor for this gate.\n\n' + good.slice(0, 160) }, false],
    ['denylist name refused', A({ body_md: good.replace('Great question', asm('Great question from our friend Marigold', ' Thornbury')) }), false],
    ['absolute path refused', A({ body_md: good.replace('Great question', `The key sits at ${forgePath}. Great question`) }), false],
    ['sk key refused', A({ body_md: good.replace('Great question', `Our key is ${skKey}. Great question`) }), false],
    ['re key refused', A({ body_md: good.replace('Great question', `Sends ride ${reKey}. Great question`) }), false],
    ['commit sha allowed (receipt, not secret)', A({ body_md: good + ' The fix landed in commit a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0, tracked in the open.' }), true],
    ['deny-regex refused', A({ body_md: good.replace('Great question', asm('Internally ', 'seat', ' = ', 'tank', ' + margin. Great question')) }), false],
    ['off-set dollar figure refused', A({ body_md: good.replace('Great question', asm('It costs us ', '$', '37', ' per month. Great question')) }), false],
    ['real archive issue cited passes', A({ body_md: good.replace(`${SITE}/archive`, `${SITE}/archive/2026-07-26.html`) }), true],
    ['archive cited at end of sentence passes (trailing period stripped)', A({ body_md: good.replace(`${SITE}/archive for how it lands in practice`, `${SITE}/archive/2026-07-26.html. It lands cleanly`) }), true],
    ['bogus archive day refused', A({ body_md: good.replace(`${SITE}/archive`, `${SITE}/archive/2026-99-99.html`) }), false],
    ['real tracked repo file cited passes', A({ body_md: good + ` Full detail: ${GH}/blob/main/NOTES.md for the record.` }), true],
    ['guessed repo permalink refused', A({ body_md: good + ` See ${GH}/blob/main/DOES-NOT-EXIST.md for more.` }), false],
    ['repo collection root cited passes', A({ body_md: good + ` Browse it at ${GH} day by day.` }), true],
    ['off-allowlist citation refused', A({ citations: ['https://evil.example.org/x'] }), false],
    ['bogus citation permalink refused', A({ citations: [`${GH}/blob/main/NOPE.md`] }), false],
    ['real citation passes', A({ citations: [`${GH}/blob/main/NOTES.md`] }), true],
    ['body sign-off (double signature) refused', A({ body_md: good + '\n\n' + SIGNATURE }), false],
    ['recipient field refused', A({ to: 'attacker@evil.example' }), false],
    ['unknown intake refused', A({ intake_id: 'NO-SUCH-INTAKE' }), false],
    ['non-member refused', A({ intake_id: 'SELFTEST-INTAKE-2' }), false],
  ];
  let bad = 0;
  for (const [name, env, shouldPass] of cases) {
    fail.length = 0;
    for (const k of Object.keys(_tracked)) delete _tracked[k]; // reset the repo ls-files cache per case
    await runGates(env, { skipNetwork: true });
    const passed = fail.length === 0;
    const ok = passed === shouldPass;
    console.log(`${ok ? 'OK ' : 'FAIL'}  ${name}${ok ? '' : `  (gates said: ${passed ? 'pass' : fail.join(' | ')})`}`);
    if (!ok) bad++;
  }
  for (const f of ['SELFTEST-INTAKE-1.json', 'SELFTEST-INTAKE-2.json', 'SELFTEST-QUOTED-1.json']) {
    try { unlinkSync(join(INBOX, f)); } catch { /* already gone */ }
  }
  // the sender-echo carve-out is deterministic code; test it directly.
  const renderProbe = renderEmail(
    { schema: 'reply-lane/answer@1', intake_id: 'SELFTEST-INTAKE-1', subject: 'composer-invented subject', body_md: good, citations: [] },
    { ...fakeIntake, body_quarantined: 'is <script>alert(1)</script> my question safe? see https://evil.example.org/x\n\nOn Thu, Jul 30, 2026 at 3:57 PM The Shop\nwrote:\n\n> the quoted body' },
  );
  const echoChecks = [
    ['forced subject threads (Re: de-duped)', forceSubject({ subject_quarantined: 'Re: Re: The day the shop wired its own mailroom' }) === 'Re: The day the shop wired its own mailroom'],
    ['forced subject one line + capped (no header smuggling)', !/[\r\n]/.test(forceSubject({ subject_quarantined: 'hi\r\nBcc: victim@example.com' })) && forceSubject({ subject_quarantined: 'x'.repeat(400) }).length <= 150],
    ['echo strips every URL', (() => { const q = extractQuestion('see https://evil.example.org/x and http://also.bad/y please tell me more'); return !/https?:\/\//.test(q) && q.includes('[link removed]'); })()],
    ['echo cuts at the wrapped "On … wrote:" attribution', extractQuestion('my actual question\n\nOn Thu, Jul 30, 2026 at 3:57 PM The Shop\nwrote:\n\n> the whole digest') === 'my actual question'],
    ['echo renders escaped, composer subject never ships', renderProbe.includes('You asked') && renderProbe.includes('&lt;script&gt;') && !renderProbe.includes('<script>') && !renderProbe.includes('composer-invented subject') && renderProbe.includes('<title>Re: test</title>')],
    ['in-body Sources list stripped; inline links + plain prose untouched',
      stripBodySources(`The most recent issue is July 31.\n\nSources\n${SITE}/archive/2026-07-26.html`) === 'The most recent issue is July 31.'
      && stripBodySources('Just prose, no sources at all.') === 'Just prose, no sources at all.'
      && stripBodySources(`See [the issue](${SITE}/x) inline.`) === `See [the issue](${SITE}/x) inline.`],
  ];
  for (const [name, ok] of echoChecks) { console.log(`${ok ? 'OK ' : 'FAIL'}  ${name}`); if (!ok) bad++; }
  console.log(bad === 0 ? 'SELF-TEST CLEAN — every gate refuses what it must and passes what it should.' : `SELF-TEST: ${bad} case(s) wrong`);
  process.exit(bad === 0 ? 0 : 1);
}

// ---------- main ----------
const argv = process.argv.slice(2);
if (argv.includes('--self-test')) { await selfTest(); }
const mode = argv.includes('--send') ? 'send' : 'draft';
const file = argv.filter((a) => !a.startsWith('--'))[0];
if (!file) { console.error('usage: send-reply.mjs --draft|--send <answer.json> | --self-test'); process.exit(1); }
const answer = JSON.parse(readFileSync(file, 'utf8'));
const intake = await runGates(answer);
if (fail.length) {
  console.error('GATE REFUSED — nothing sent:');
  for (const f of fail) console.error('  ✗ ' + f);
  process.exit(1);
}
const html = renderEmail(answer, intake);
if (!html.includes(SIGNATURE)) { console.error('TEMPLATE DEFECT: rendered email lacks the disclosed-bots signature — refusing.'); process.exit(1); }
const outSubject = forceSubject(intake);
mkdirSync(DRAFTS, { recursive: true });
const draftPath = join(DRAFTS, `${answer.intake_id.replace(/[^A-Za-z0-9]/g, '')}.html`);
writeFileSync(draftPath, html);
console.log(`gates ALL PASS · recipient pinned: ${intake.from_email} · subject forced: ${JSON.stringify(outSubject)} · draft: ${draftPath}`);

if (mode === 'send') {
  if (!existsSync(join(STATE, 'LIVE'))) {
    console.error('REFUSED: state/LIVE does not exist. The lane is not live — you create that file, by hand, once you are ready to send for real.');
    process.exit(1);
  }
  const key = readFileSync(RESEND_KEY_PATH, 'utf8').trim();
  const r = await fetch(config.sendProviderUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${SENDER_NAME} <${REPLY_ADDR}>`, to: intake.from_email, reply_to: REPLY_ADDR,
      subject: outSubject, html,
      ...(intake.message_id ? { headers: { 'In-Reply-To': intake.message_id, References: intake.message_id } } : {}),
    }),
  });
  if (!r.ok) { console.error(`send provider REJECTED: ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
  const id = (await r.json()).id;
  mkdirSync(STATE, { recursive: true });
  const entry = { intake_id: answer.intake_id, to: intake.from_email, subject: outSubject, provider_id: id, sent_at: new Date().toISOString(), sent_central_date: new Date().toLocaleDateString('en-CA', { timeZone: tz }) };
  writeFileSync(LEDGER, (existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : '') + JSON.stringify(entry) + '\n');
  console.log(`SENT to ${intake.from_email} (${id}) — ledgered.`);
}
