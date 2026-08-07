#!/usr/bin/env node
// render.mjs — stage 5, deterministic. digests/<date>.md -> out/<date>.html
// digest.md conventions:
//   # <headline>
//   <!-- meta: date=YYYY-MM-DD reconstructed=true|false dek="..." tags="slug slug" -->
//   normal paragraphs / ## sections / **bold** *em* `code` [links](url)
//   a paragraph starting "**Steal this if it's useful:**"  -> the steal-this card
//   ## From the microphone   -> the microphone card: "> quote" (operator, rust) / ">> quote"
//        (machine, green) lines, an attribution line starting "— " right after, then note paragraphs
//   ## Ask us about any of this  -> the dark reply card (content-reactive paragraph)
// Counts strip: read from facts/<date>.json (post-gate) when present.
// KILL-<date> in the working root refuses the render.
//
// The default look (cream ground, shop green, a rust accent, Barlow) is a theme, not a secret — edit
// the colors here to make it yours. Every URL and the signup endpoint come from config.
import fs from 'node:fs';
import { join } from 'node:path';
import { config, dir, ROOT } from '../lib/config.mjs';

const OUT = dir('outDir');
const LINKBACK = config.siteUrl;
const BIWEEKLY = config.newsletterUrl;
const SUBSCRIBE = config.subscribeEndpoint;          // empty => the signup box is omitted
const SENDER = config.senderName;
const linkbackHost = (() => { try { return new URL(LINKBACK).host.replace(/^www\./, ''); } catch { return LINKBACK; } })();

const DATE = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE || '')) { console.error('usage: render.mjs YYYY-MM-DD'); process.exit(2); }
if (fs.existsSync(join(ROOT, `KILL-${DATE}`))) { console.error(`KILL-${DATE} present — issue killed, not rendering.`); process.exit(1); }

const md = fs.readFileSync(join(dir('digestsDir'), `${DATE}.md`), 'utf8');
let facts = null;
try { facts = JSON.parse(fs.readFileSync(join(dir('factsDir'), `${DATE}.json`), 'utf8')); } catch {}
if (!facts) console.error(`⚠ no facts/${DATE}.json — the counts strip (commits · files · repos) will be OMITTED. Create it before sending.`);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code style="font:600 14px/1.4 \'JetBrains Mono\',Consolas,monospace;background:#FBF4E2;border:1px solid #DAD0B6;border-radius:4px;padding:1px 5px;color:#1A1F18;">$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" style="color:#0077C0;text-decoration:none;">$1</a>');

// ---- parse ---------------------------------------------------------------
let headline = 'From the shop floor', dek = '';
const sections = [{ name: null, blocks: [] }];
for (const raw of md.split('\n')) {
  const line = raw.trimEnd();
  const meta = line.match(/<!--\s*meta:\s*(.*?)-->/);
  if (meta) {
    const d = meta[1].match(/dek="([^"]*)"/); if (d) dek = d[1];
    continue;
  }
  if (line.startsWith('# ') && headline === 'From the shop floor') { headline = line.slice(2).trim(); continue; }
  if (line.startsWith('## ')) { sections.push({ name: line.slice(3).trim(), blocks: [] }); continue; }
  const cur = sections[sections.length - 1];
  if (line.trim() === '>') {
    const last = cur.blocks[cur.blocks.length - 1];
    if (last && last.t === 'quote' && last.open) last.text += ' &nbsp;/&nbsp; ';
    continue;
  }
  // `>> ` = a machine-voiced quote (green, never rust). Checked BEFORE `> ` because a machine quote
  // is still a quote; only the ink differs.
  if (line.startsWith('>> ')) {
    const last = cur.blocks[cur.blocks.length - 1];
    if (last && last.t === 'quote' && last.open) last.text += ' ' + line.slice(3).trim();
    else cur.blocks.push({ t: 'quote', speaker: 'machine', text: line.slice(3).trim(), open: true });
    continue;
  }
  if (line.startsWith('> ')) {
    const last = cur.blocks[cur.blocks.length - 1];
    if (last && last.t === 'quote' && last.open) last.text += ' ' + line.slice(2).trim();
    else cur.blocks.push({ t: 'quote', speaker: 'operator', text: line.slice(2).trim(), open: true });
    continue;
  }
  if (line.startsWith('=> ')) { cur.blocks.push({ t: 'flow', text: line.slice(3).trim() }); continue; }
  if (!line.trim()) { const last = cur.blocks[cur.blocks.length - 1]; if (last) last.open = false; continue; }
  if (line.startsWith('— ') || line.startsWith('&mdash; ')) { cur.blocks.push({ t: 'attr', text: line.replace(/^(—|&mdash;)\s*/, '') }); continue; }
  const last = cur.blocks[cur.blocks.length - 1];
  const isSteal = /^\*\*Steal this/i.test(line.trim());
  if (last && last.t === 'p' && last.open && !isSteal) { last.text += ' ' + line.trim(); continue; }
  cur.blocks.push({ t: isSteal ? 'steal' : 'p', text: line.trim(), open: true });
}

// ---- html pieces ---------------------------------------------------------
const P = (t) => `<p style="margin:0 0 16px;font:400 17px/1.65 Barlow,Arial,sans-serif;color:#1A1F18;">${t}</p>`;
const H2 = (t) => `<h2 style="margin:30px 0 12px;font:700 22px/1.2 'Barlow Condensed',Barlow,Arial,sans-serif;color:#00471B;">${t}</h2>`;
const STEAL = (t) => `
<div style="background:#F4EAD0;border-left:6px solid #00471B;border-radius:10px;padding:16px 20px;margin:22px 0 24px;">
  <p style="margin:0;font:400 16px/1.6 Barlow,Arial,sans-serif;color:#16301E;">${t}</p>
</div>`;
// COLOR ENCODES THE SPEAKER — rust is ALWAYS the operator's words; the shop's own quotes render in
// shop green, never rust. The gray note beneath is the machine's commentary either way.
const QUOTE_INK = { operator: '#C05828', machine: '#00471B' };
const QUOTE_CARD = (q, attr, note, speaker = 'operator') => `
<div style="background:#ffffff;border:1px solid #DAD0B6;border-radius:12px;padding:18px 22px;margin:18px 0;">
  <p style="margin:0 0 ${attr ? '8' : '10'}px;font:600 17px/1.55 Barlow,Arial,sans-serif;color:${QUOTE_INK[speaker] || QUOTE_INK.operator};">&ldquo;${q}&rdquo;</p>
  ${attr ? `<p style="margin:0 0 10px;font:600 11.5px/1.4 'JetBrains Mono',Consolas,monospace;color:#5C5A30;">&mdash; ${attr}</p>` : ''}
  ${note ? `<p style="margin:0;font:400 14.5px/1.58 Barlow,Arial,sans-serif;color:#535B4C;">${note}</p>` : ''}
</div>`;

const PILL = 'display:inline-block;border-radius:8px;padding:7px 13px;margin:3px 0;';
const flowStep = (s) => {
  s = s.trim();
  if (s.startsWith('#')) return `<span style="${PILL}background:#C05828;color:#fff;">${inline(s.slice(1).trim())}</span>`;
  if (s.startsWith('+')) return `<span style="${PILL}background:#00471B;color:#EEF3EA;">${inline(s.slice(1).trim())}</span>`;
  if (s.startsWith('!')) return `<span style="${PILL}background:#fff;border:1px solid #C05828;color:#C05828;">${inline(s.slice(1).trim())}</span>`;
  return `<span style="${PILL}background:#fff;border:1px solid #DAD0B6;">${inline(s)}</span>`;
};
const FLOW_CARD = (lanes) => `
<div style="background:#FBF4E2;border:1px solid #DAD0B6;border-radius:14px;padding:24px 26px;margin:24px 0;">
  ${lanes.map((lane, i) => `<div style="font:600 15px/2.0 Barlow,Arial,sans-serif;color:#1A1F18;${
    i ? 'margin-top:18px;padding-top:18px;border-top:1px solid #E6DCC2;' : ''
  }">${
    lane.split(' -> ').map(flowStep).join('<span style="color:#9A9270;">&nbsp;&rarr;&nbsp;</span>')
  }</div>`).join('\n')}
</div>`;

function renderNormalSection(sec) {
  const out = [];
  if (sec.name) out.push(H2(inline(sec.name)));
  for (let i = 0; i < sec.blocks.length; i++) {
    const b = sec.blocks[i];
    if (b.t === 'flow') {
      const lanes = [b.text];
      while (sec.blocks[i + 1] && sec.blocks[i + 1].t === 'flow') { lanes.push(sec.blocks[++i].text); }
      out.push(FLOW_CARD(lanes));
      continue;
    }
    if (b.t === 'steal') out.push(STEAL(inline(b.text)));
    else if (b.t === 'quote') {
      let attr = '', note = '';
      let next = sec.blocks[i + 1];
      if (next && next.t === 'attr') { attr = inline(next.text); i++; next = sec.blocks[i + 1]; }
      if (next && next.t === 'p' && !/^\*\*Steal this/i.test(next.text)) { note = inline(next.text); i++; }
      out.push(QUOTE_CARD(inline(b.text), attr, note, b.speaker));
    } else if (b.t === 'attr') out.push(`<p style="margin:-8px 0 14px;font:600 11.5px/1.4 'JetBrains Mono',Consolas,monospace;color:#5C5A30;">&mdash; ${inline(b.text)}</p>`);
    else out.push(P(inline(b.text)));
  }
  return out.join('\n');
}
const renderMicSection = renderNormalSection;

function renderAskSection(sec) {
  const text = sec.blocks.filter((b) => b.t === 'p').map((b) => inline(b.text)).join('</p><p style="margin:8px 0 0;font:400 15px/1.6 Barlow,Arial,sans-serif;color:#CFE0D0;">');
  return `
<div style="background:#00310F;border-radius:12px;padding:18px 20px;margin:0 0 26px;">
  <p style="margin:0 0 8px;font:600 11px/1.4 'JetBrains Mono',Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:#9CC6A4;">
    Ask us about any of this
  </p>
  <p style="margin:0;font:400 15px/1.6 Barlow,Arial,sans-serif;color:#CFE0D0;">${text}</p>
</div>`;
}

// ---- assemble ------------------------------------------------------------
const c = (facts && (facts.counts || facts)) || {};
const stats = [
  DATE,
  c.commits != null ? `${c.commits} commits` : null,
  c.files_changed != null ? `${c.files_changed} files changed` : null,
  c.repos_touched != null ? `${c.repos_touched} repos` : null,
].filter(Boolean).join(' &nbsp;&middot;&nbsp; ');

const body = sections.map((sec) => {
  const n = (sec.name || '').toLowerCase();
  if (n.startsWith('from the microphone')) return renderMicSection(sec);
  if (n.startsWith('ask us')) return renderAskSection(sec);
  return renderNormalSection(sec);
}).join('\n');

// --web: the archive/site variant — adds the signup capture under the nameplate. Email variant omits
// it (forms don't work in email clients). If no subscribeEndpoint is configured, there is no box.
const WEB = process.argv.includes('--web');
const HAS_SIGNUP = WEB && !!SUBSCRIBE;
const SIGNUP = HAS_SIGNUP ? '<div class="shop-signup" data-source="shop-floor-door"></div>' : '';
const WEB_HEAD = HAS_SIGNUP
  ? '<link rel="stylesheet" href="assets/shop.css">\n<script src="assets/shop-signup.js" defer></script>'
  : '';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>From the Shop Floor &mdash; ${esc(headline)}</title>
${WEB_HEAD}
</head>
<body style="margin:0;padding:0;background:#EEE1C6;">
<div style="max-width:640px;margin:0 auto;padding:32px 20px 48px;">

  <div style="border:1px solid #DAD0B6;border-radius:11px;overflow:hidden;margin:0 0 26px;">
    <div style="background:#00310F;color:#9CC6A4;font:600 11px/1.4 'JetBrains Mono',Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;padding:9px 14px;">
      From the Shop Floor &nbsp;&middot;&nbsp; written by the shop's agents, unedited
    </div>
    <div style="background:#FBF4E2;padding:9px 14px;font:600 11px/1.4 'JetBrains Mono',Consolas,monospace;letter-spacing:.08em;color:#5C5A30;">
      ${stats}
    </div>
  </div>

  ${SIGNUP}
  <h1 style="margin:0 0 6px;font:800 34px/1.1 'Barlow Condensed',Barlow,Arial,sans-serif;color:#00471B;">${inline(headline)}</h1>
  ${dek ? `<p style="margin:0 0 26px;font:400 15px/1.5 Barlow,Arial,sans-serif;color:#535B4C;">${inline(dek)}</p>` : '<p style="margin:0 0 18px;"></p>'}
  ${body}

  <p style="margin:0 0 16px;font:400 17px/1.6 Barlow,Arial,sans-serif;color:#1A1F18;">&mdash; The shop's agents</p>

  <p style="margin:0 0 16px;font:400 15px/1.6 Barlow,Arial,sans-serif;color:#1A1F18;">
    (Written by the shop's agents at the end of the day &mdash; unedited.${BIWEEKLY ? `
    <a href="${BIWEEKLY}" style="color:#0077C0;text-decoration:none;"><strong>The operator's own writing lives over here.</strong></a>` : ''})
  </p>

  <p style="margin:0;padding-top:14px;border-top:1px solid #DAD0B6;font:400 12.5px/1.6 Barlow,Arial,sans-serif;color:#535B4C;">
    Anything here is yours to take. Code under MIT, writing under CC BY 4.0. Just say where you got it:
    <a href="${LINKBACK}" style="color:#0077C0;text-decoration:none;">${linkbackHost}</a>
  </p>

</div>
</body>
</html>`;

const outDir = WEB ? join(OUT, 'web') : OUT;
fs.mkdirSync(outDir, { recursive: true });

// Write the shared assets once (idempotent) — the single source for the capture box. Only when a
// subscribe endpoint is configured.
if (HAS_SIGNUP) {
  const assets = join(outDir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(join(assets, 'shop.css'), `/* From the Shop Floor — shared archive styles. One
   signup implementation for every issue page; edit here, every page changes. */
.shop-signup{background:#fff;border:1px solid #DAD0B6;border-left:5px solid #C05828;border-radius:0 11px 11px 0;padding:16px 18px;margin:0 0 26px}
.shop-signup p{margin:0 0 9px;font:600 13.5px/1.45 Barlow,Arial,sans-serif;color:#00310F}
.shop-signup .eyebrow{margin:0 0 8px;font:600 11px/1.4 'JetBrains Mono',Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:#C05828}
.shop-signup .hook{margin:0 0 12px;font:400 15px/1.55 Barlow,Arial,sans-serif;color:#1A1F18}
.shop-signup .hook b{font-weight:600;color:#00310F}
.shop-signup form{display:flex;gap:8px;flex-wrap:wrap}
.shop-signup input{flex:1 1 220px;font:400 15px/1.4 Barlow,Arial,sans-serif;padding:9px 12px;border:1px solid #DAD0B6;border-radius:8px;background:#fff;color:#1A1F18}
.shop-signup button{font:600 14px/1.4 Barlow,Arial,sans-serif;background:#00471B;color:#EEF3EA;border:0;border-radius:8px;padding:9px 18px;cursor:pointer}
.shop-signup button:hover{background:#00310F}
.shop-signup .shop-note{margin:8px 0 0;font:400 12px/1.45 Barlow,Arial,sans-serif;color:#6B6A4A}
.shop-signup .hp{position:absolute;left:-9999px}
`);
  fs.writeFileSync(join(assets, 'shop-signup.js'), `// One capture implementation for the whole archive.
// Hydrates every <div class="shop-signup" data-source="..."></div> on the page.
(function () {
  var ENDPOINT = ${JSON.stringify(SUBSCRIBE)};
  document.querySelectorAll(".shop-signup").forEach(function (host) {
    var source = host.dataset.source || "shop-floor-door";
    host.innerHTML =
      '<p class="eyebrow">Reply and ask</p>' +
      '<p class="hook">Reply to any issue and the agents answer you the way they answer the operator — ' +
        'full depth: <b>reasoning, receipts, source code, even help standing up your own version of this.</b></p>' +
      '<form novalidate>' +
        '<input class="hp" type="text" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<input type="email" name="email" required placeholder="you@wherever.com" aria-label="Your email">' +
        '<button type="submit">Subscribe</button>' +
      '</form>' +
      '<p class="shop-note">Free. The journals in your inbox + a real answer when you ask. Nothing else, ever.</p>';
    host.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target, btn = f.querySelector("button"), note = host.querySelector(".shop-note");
      var email = f.email.value.trim();
      if (!email) return;
      btn.disabled = true; btn.textContent = "Sending...";
      fetch(ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, source: source, hp: f.hp.value })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) { btn.textContent = "Sent"; note.textContent = "Check your email and click confirm. That is the whole thing."; }
        else { btn.disabled = false; btn.textContent = "Try again"; note.textContent = "That did not go through. Try again in a moment."; }
      }).catch(function () {
        btn.disabled = false; btn.textContent = "Try again"; note.textContent = "That did not go through. Try again in a moment.";
      });
    });
  });
})();
`);
}
const outPath = join(outDir, `${DATE}.html`);
fs.writeFileSync(outPath, html);
console.log(`rendered -> ${outPath}`);
