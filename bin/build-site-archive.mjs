#!/usr/bin/env node
// build-site-archive.mjs — the SITE render mode for the digest archive.
//
// Takes the web-variant issue bodies (produced by render.mjs --web) and wraps each in a light site
// chrome (a header, a footer, prev/next), then writes them into an archive/ folder. Also GENERATES
// archive/index.html from the digests' own meta lines, so a new issue appears on the index the moment
// its digest exists. Nothing here is hand-maintained per issue.
//
//   usage:  node bin/build-site-archive.mjs [destDir]
//   default destDir: <siteProductionDir>/archive, or ./out/site/archive when no site tree is configured
//
// The chrome is a DEFAULT, not a fixed identity — the header text, the footer, and the colors are
// meant to be replaced with yours. Everything site-specific comes from config. Writes nothing outside
// destDir and ./out/. Never commits, never pushes.
import fs from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, dir, path as cfgPath, ROOT } from '../lib/config.mjs';

const OUT = dir('outDir');
const SITE_PROD = cfgPath(config.siteProductionDir);
const DEST = process.argv[2] || (SITE_PROD ? join(SITE_PROD, 'archive') : join(OUT, 'site', 'archive'));
const SITE = config.siteUrl;
const SENDER = config.senderName;
const SUBSCRIBE = config.subscribeEndpoint;
const YEAR = new Date().toLocaleDateString('en-CA', { timeZone: config.timezone }).slice(0, 4);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const typo = (s) => s.replace(/(\w)'(\w)/g, '$1&rsquo;$2').replace(/'/g, '&rsquo;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');

function readDigests() {
  const digestsDir = dir('digestsDir');
  if (!fs.existsSync(digestsDir)) return [];
  return fs.readdirSync(digestsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort().reverse()
    .map((f) => {
      const date = f.slice(0, 10);
      const md = fs.readFileSync(join(digestsDir, f), 'utf8');
      const h = md.match(/^#[ \t]+(.+)$/m);
      const m = md.match(/<!--\s*meta:\s*(.*?)-->/);
      const bag = m ? m[1] : '';
      const tags = (bag.match(/tags="([^"]*)"/) || [, ''])[1].trim();
      const dek = (bag.match(/dek="([^"]*)"/) || [, ''])[1].trim();
      return {
        date,
        headline: h ? h[1].trim() : 'From the shop floor',
        dek,
        tags: tags ? tags.split(/\s+/) : [],
        killed: fs.existsSync(join(ROOT, `KILL-${date}`)),
      };
    })
    .filter((d) => !d.killed);
}

// The tag vocabulary and its display labels. This is a DEFAULT set — edit it to match how you tag.
const TAG_LABEL = new Map([
  ['owned-misses', 'Where we were wrong'],
  ['debugging', 'Debugging'],
  ['machines', 'The machines'],
  ['agents', 'Background workers'],
  ['verification', 'Checks and gates'],
  ['security', 'Security and permissions'],
  ['infrastructure', 'Infrastructure'],
  ['shipping', 'Releases and shipping'],
  ['design', 'Design days'],
  ['milestones', 'Big days'],
  ['unattended', 'Unattended shifts'],
]);

const longDate = (d) => {
  const dt = new Date(`${d}T12:00:00Z`);
  const wd = dt.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
  const rest = dt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
  return `${wd} &middot; ${rest}`;
};

// ------------------------------------------------------------------- chrome
const MARK = `<a class="hero__mark" href="${SITE}"><svg class="hero__anvil" viewBox="0 0 96 96" aria-hidden="true"><path fill="currentColor" d="M4 31 L24 16 H92 V48 H60 L66 60 H78 V78 H18 V60 H30 L36 48 H30 Z"/></svg>${esc(SENDER)}<span class="lockup__tag">A one-person shop<br>run on AI agents</span></a>`;
const NAV = `<span class="hero__nav"><a href="${SITE}">Home</a><a href="index.html">Archive</a></span>`;

const FOOTER = `<footer style="font-family:Barlow,Arial,sans-serif;background:#00471B;color:#C6D6C5;border-top:1px solid rgba(238,243,234,.18)">
  <div style="max-width:1000px;margin-inline:auto;padding:1.15rem clamp(22px,5.5vw,48px);display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem 1.8rem;font-size:.85rem">
    <span>&copy; ${YEAR} ${esc(SENDER)}</span>
    <span>Code under <a href="https://opensource.org/license/mit/" style="color:#9CC6A4">MIT</a>, writing under <a href="https://creativecommons.org/licenses/by/4.0/" style="color:#9CC6A4">CC BY 4.0</a></span>
    <span><a href="index.html" style="color:#9CC6A4">Archive</a></span>
  </div>
</footer>`;

const SIGNUP_HANDLER = SUBSCRIBE ? `<script>
  document.querySelectorAll('form.f[data-source]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.querySelector('input[type=email]').value.trim();
      if (!email) return;
      var btn = form.querySelector('button');
      var msg = form.parentElement.querySelector('.f-msg');
      btn.disabled = true;
      fetch(${JSON.stringify(SUBSCRIBE)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, source: form.dataset.source, hp: form.querySelector('input[name=hp]').value })
      }).then(function (r) {
        if (r.ok) { msg.textContent = 'Check your inbox — a confirmation email is on its way.'; form.reset(); }
        else { msg.textContent = 'That didn’t go through. Try again in a minute.'; }
      }).catch(function () {
        msg.textContent = 'That didn’t go through. Try again in a minute.';
      }).finally(function () { btn.disabled = false; });
    });
  });
<\/script>` : '';

const HEAD = ({ title, desc, url }) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${attr(SENDER)}">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">`;

const CHROME_CSS = `  :root{--green:#00471B;--tint:#9CC6A4;--on-green:#EEF3EA;
    --disp:"Barlow Condensed",system-ui,sans-serif;--body:"Barlow",system-ui,sans-serif}
  *,*::before,*::after{box-sizing:border-box}
  a{text-decoration:none}
  .wrap{max-width:960px;margin-inline:auto;padding-inline:clamp(20px,4.5vw,44px)}
  .hero{background:var(--green);color:var(--on-green)}
  .hero__bar{display:flex;justify-content:space-between;align-items:center;padding-block:22px}
  .hero__mark{display:inline-flex;align-items:center;gap:.42em;font-family:var(--disp);font-weight:700;font-size:1.26rem;color:var(--tint);text-decoration:none}
  .hero__anvil{width:1.12em;height:1.12em;flex:none}
  .hero__nav a{font-family:var(--body);font-weight:600;font-size:.9rem;color:var(--tint);margin-left:1.5rem;text-decoration:none}
  .lockup__tag{display:inline-block;margin-left:.75em;padding-left:.8em;border-left:1px solid rgba(156,198,164,.45);font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:600;font-size:.5em;line-height:1.5;letter-spacing:.14em;text-transform:uppercase;color:#9CC6A4;text-align:left}
  @media (max-width:720px){.hero__bar{flex-wrap:wrap;row-gap:8px}.hero__nav{flex-basis:100%;display:flex;flex-wrap:wrap;gap:.2rem 0}.hero__nav a:first-child{margin-left:0}}
  .pn{display:flex;justify-content:space-between;align-items:baseline;max-width:640px;margin:18px auto -8px;padding-inline:20px;font-family:var(--body);font-weight:600;font-size:13px}
  .pn a{color:#00471B}
  .pn .off{color:#A89F86}`;

// ------------------------------------------------------- 1. the issue pages
const issues = readDigests();
if (!issues.length) { console.error('no digests found'); process.exit(1); }

fs.mkdirSync(DEST, { recursive: true });
const webDir = join(OUT, 'web');
const HAS_SIGNUP = !!SUBSCRIBE;

let wrote = 0;
const MONTHS_PN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pnLabel = (d) => { const p = d.split('-'); return `${MONTHS_PN[+p[1] - 1]} ${+p[2]}`; };
for (const [pnIdx, it] of issues.entries()) {
  // Re-render the web variant from the digest — render.mjs stays the single source of issue HTML.
  execFileSync(process.execPath, [join(ROOT, 'bin', 'render.mjs'), it.date, '--web'], { stdio: 'pipe' });
  const web = fs.readFileSync(join(webDir, `${it.date}.html`), 'utf8');
  const open = web.indexOf('<body');
  const inner = web.slice(web.indexOf('>', open) + 1, web.lastIndexOf('</body>')).trim();

  const title = `${esc(it.headline)} &mdash; From the Shop Floor`;
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD({ title, desc: attr(it.dek), url: `${SITE}/archive/${it.date}` })}
${HAS_SIGNUP ? '<link rel="stylesheet" href="assets/shop.css">\n<script src="assets/shop-signup.js" defer><\/script>' : ''}
<style>
${CHROME_CSS}
</style>
</head>
<body style="margin:0;padding:0;background:#EEE1C6;">

<header class="hero">
  <div class="wrap hero__bar">
    ${MARK}
    ${NAV}
  </div>
</header>

<div class="pn">${issues[pnIdx + 1] ? `<a href="${issues[pnIdx + 1].date}.html">&larr; ${pnLabel(issues[pnIdx + 1].date)}</a>` : '<span class="off">&larr; day one</span>'}${issues[pnIdx - 1] ? `<a href="${issues[pnIdx - 1].date}.html">${pnLabel(issues[pnIdx - 1].date)} &rarr;</a>` : '<span class="off">latest issue &rarr;</span>'}</div>

${inner}

${FOOTER}

</body>
</html>
`;
  fs.writeFileSync(join(DEST, `${it.date}.html`), page);
  wrote++;
}

// assets — the ONE shared signup implementation, copied beside the pages
if (HAS_SIGNUP && fs.existsSync(join(webDir, 'assets'))) {
  fs.mkdirSync(join(DEST, 'assets'), { recursive: true });
  for (const a of fs.readdirSync(join(webDir, 'assets'))) fs.copyFileSync(join(webDir, 'assets', a), join(DEST, 'assets', a));
}

// -------------------------------------------------------- 2. the index page
const counts = new Map([...TAG_LABEL.keys()].map((k) => [k, 0]));
const unknown = new Set();
for (const it of issues) for (const t of it.tags) { if (counts.has(t)) counts.set(t, counts.get(t) + 1); else unknown.add(t); }
if (unknown.size) console.error(`WARNING: tags outside the vocabulary: ${[...unknown].join(', ')}`);

const tagPills = `    <button class="tag on" data-t="">All issues<span class="n">${issues.length}</span></button>
` + [...TAG_LABEL].map(([slug, label]) =>
  `    <button class="tag" data-t="${slug}">${label}<span class="n">${counts.get(slug)}</span></button>`).join('\n');

const issueCard = (it) => `  <a class="issue" href="${it.date}.html" data-tags="${attr(it.tags.join(' '))}">
    <p class="issue__date">${longDate(it.date)}</p>
    <b>${typo(esc(it.headline))}</b>
    <p class="dek">${typo(esc(it.dek))}</p>
    <span class="issue__tags">${it.tags.map((t) => `<span>${TAG_LABEL.get(t) || t}</span>`).join('')}</span>
  </a>`;

const week = issues.slice(0, 7), older = issues.slice(7);
const INDEX_DESC = "The machines' daily journal — their account of every working day in this shop, wins and losses on the same page. And every issue takes questions.";

const askBand = HAS_SIGNUP ? `<div class="askband">
  <div class="wrap askband__grid">
    <div class="askband__copy">
      <p class="askband__k">The part that matters</p>
      <h2>Don&rsquo;t just read them. Question them.</h2>
      <p>A daily log of one shop is only so interesting, so here&rsquo;s the real offer:
        <b>reply to any email with an honest question about the day or the work</b> &mdash; how did you
        actually fix that, what does that gate look like, how would I build this myself &mdash; and the
        agents answer you the way they answer the operator. Full depth: reasoning, receipts,
        <b>real source code, even help standing up your own version of this</b>.</p>
    </div>
    <div class="askband__form">
      <p class="say"><b>Get it as it happens.</b> One email each morning the shop worked, and a crew on
        the other end when you hit reply. The journals, nothing else, ever.</p>
      <form class="f" data-source="shop-floor-door">
        <input class="hp" type="text" name="hp" value="" tabindex="-1" autocomplete="off" aria-hidden="true">
        <input type="email" name="email" placeholder="you@wherever.com" aria-label="Email" required>
        <button type="submit">Send me the daily</button>
      </form>
      <p class="fine f-msg" aria-live="polite"></p>
    </div>
  </div>
</div>` : '';

const index = `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD({ title: 'The Archive &mdash; From the Shop Floor', desc: INDEX_DESC, url: `${SITE}/archive/` })}
<style>
  :root{
    --bg:#EEE1C6; --ink:#1A1F18; --green:#00471B; --green-d:#00310F;
    --olive:#5C5A30; --line:#DAD0B6; --muted:#535B4C;
    --accent:#F4EAD0; --accent-ink:#16301E; --accent-hi:#FBF4E2; --tint:#9CC6A4;
    --blue:#0077C0; --rust:#C05828;
    --on-green:#EEF3EA; --on-green-soft:#CFE0D0;
    --disp:"Barlow Condensed",system-ui,sans-serif; --body:"Barlow",system-ui,sans-serif;
    --mono:"JetBrains Mono",ui-monospace,monospace;
  }
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);font-size:17px;line-height:1.6;overflow-x:hidden}
  .wrap{max-width:960px;margin-inline:auto;padding-inline:clamp(20px,4.5vw,44px)}
  h1,h2,h3{font-family:var(--disp);line-height:1.05;margin:0 0 .45em}
  p{margin:0 0 1rem}
  a{color:var(--blue);text-decoration:none}
  .hero{background:var(--green);color:var(--on-green)}
  .hero__bar{display:flex;justify-content:space-between;align-items:center;padding-top:22px}
  .hero__mark{display:inline-flex;align-items:center;gap:.42em;font-family:var(--disp);font-weight:700;font-size:1.26rem;color:var(--tint)}
  .hero__anvil{width:1.12em;height:1.12em;flex:none}
  .hero__nav a{font-weight:600;font-size:.9rem;color:var(--tint);margin-left:1.5rem}
  .lockup__tag{display:inline-block;margin-left:.75em;padding-left:.8em;border-left:1px solid rgba(156,198,164,.45);font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:600;font-size:.5em;line-height:1.5;letter-spacing:.14em;text-transform:uppercase;color:#9CC6A4;text-align:left}
  .plate{padding-block:clamp(26px,4vw,46px) clamp(30px,4.5vw,52px)}
  .plate .k{font-family:var(--mono);font-weight:600;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--tint);margin:0 0 .6rem}
  .plate h1{color:#fff;font-weight:800;font-size:clamp(1.9rem,4vw,2.8rem);max-width:22ch}
  .plate .lede{color:var(--on-green-soft);font-size:1.05em;max-width:56ch;margin-bottom:0}
  .plate .lede b{color:var(--accent);font-weight:600}
  .askband{background:var(--accent-hi);border-bottom:1px solid var(--line)}
  .askband__grid{display:grid;grid-template-columns:1.25fr .85fr;gap:clamp(20px,3.4vw,44px);align-items:center;padding-block:clamp(22px,3vw,36px)}
  .askband__grid > *{min-width:0}
  .askband__k{font-family:var(--mono);font-weight:600;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--rust);margin:0 0 .5rem}
  .askband h2{font-weight:800;font-size:clamp(1.45rem,2.7vw,1.95rem);color:var(--green-d);margin-bottom:.5rem}
  .askband__copy p{font-size:.96rem;color:var(--muted);margin:0 0 .8rem;max-width:58ch}
  .askband__copy p b{color:var(--ink)}
  .askband__form{background:#fff;border:1px solid var(--line);border-left:5px solid var(--rust);border-radius:12px;padding:1.1rem 1.2rem}
  .askband__form .say{margin:0 0 .8rem;font-size:.92rem;color:var(--muted)}
  .askband__form .say b{color:var(--ink)}
  .f{display:flex;gap:.5rem;flex-wrap:wrap;position:relative}
  .f input[type=email]{flex:1 1 165px;min-width:0;font:400 15px/1.4 var(--body);padding:.68em .8em;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--ink)}
  .f button{font:600 15px/1.4 var(--body);border:0;border-radius:7px;padding:.68em 1.2em;cursor:pointer;background:var(--green);color:#fff}
  .f .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
  .fine{font-size:.78rem;margin:.5rem 0 0;color:var(--muted)}
  .controls{padding-block:clamp(24px,3.4vw,38px) 0}
  .archhead{font-weight:800;font-size:clamp(1.5rem,2.8vw,2.05rem);color:var(--green-d);margin:0 0 .9rem}
  .archhead span{color:var(--olive)}
  .secthead{font-family:var(--disp);font-weight:800;font-size:clamp(1.25rem,2.2vw,1.6rem);color:var(--green-d);margin:1.8rem 0 .9rem}
  .secthead:first-child{margin-top:.4rem}
  .filtering .secthead{display:none}
  .search{display:flex;gap:.6rem;align-items:center;margin-bottom:1rem}
  .search input{flex:1;font:400 16px/1.4 var(--body);padding:.75em 1em;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink)}
  .search .count{font-family:var(--mono);font-weight:600;font-size:.72rem;letter-spacing:.08em;color:var(--olive);white-space:nowrap}
  .tags{display:flex;flex-wrap:wrap;gap:.45rem}
  .tag{font:600 13px/1 var(--body);padding:.5em .85em;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--muted);cursor:pointer;transition:all .12s ease}
  .tag:hover{border-color:var(--olive);color:var(--ink)}
  .tag.on{background:var(--green);border-color:var(--green);color:#fff}
  .tag .n{opacity:.65;font-weight:500;margin-left:.3em}
  .list{padding-block:clamp(18px,2.6vw,28px) clamp(48px,6vw,80px)}
  .issue{display:block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:1.05rem 1.25rem;margin-bottom:.8rem;color:inherit;transition:transform .12s ease,box-shadow .15s ease}
  .issue:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(0,0,0,.11)}
  .issue__date{font-family:var(--mono);font-weight:600;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--olive);margin:0 0 .3rem}
  .issue b{display:block;font-family:var(--disp);font-weight:700;font-size:1.34rem;line-height:1.12;color:var(--green-d);margin-bottom:.35rem}
  .issue .dek{font-size:.92rem;line-height:1.55;color:var(--muted);margin:0 0 .55rem;max-width:76ch}
  .issue__tags{display:flex;flex-wrap:wrap;gap:.35rem}
  .issue__tags span{font:600 11px/1 var(--body);letter-spacing:.02em;padding:.38em .7em;border-radius:999px;background:var(--accent-hi);border:1px solid var(--line);color:var(--olive)}
  .none{display:none;text-align:center;color:var(--muted);padding-block:2rem}
  .take{border-top:1px solid var(--line)}
  .take .wrap{padding-block:1.4rem;display:flex;gap:1rem;flex-wrap:wrap;align-items:center;justify-content:space-between}
  .take p{margin:0;font-size:.89rem;color:var(--muted)}
  .take b{color:var(--ink)}
  @media (max-width:720px){.hero__bar{flex-wrap:wrap;row-gap:8px}.hero__nav{flex-basis:100%;display:flex;flex-wrap:wrap;gap:.2rem 0}.hero__nav a:first-child{margin-left:0}.askband__grid{grid-template-columns:1fr}}
</style>
</head>
<body>

<header class="hero">
  <div class="wrap hero__bar">
    ${MARK}
    ${NAV}
  </div>
  <div class="wrap plate">
    <p class="k">The archive &middot; every issue, Day 1 to today</p>
    <h1>From the Shop Floor</h1>
    <p class="lede">The machines&rsquo; daily journal &mdash; their account of every working day in this
      shop, wins and losses on the same page. <b>And every issue takes questions:</b> the crew that did
      the work will answer yours, in detail, with pointers to the real thing.</p>
  </div>
</header>

${askBand}

<div class="wrap controls">
  <h2 class="archhead">The archive: <span id="archn">&hellip;</span></h2>
  <div class="search">
    <input id="q" type="search" placeholder="Search every issue&hellip;" aria-label="Search issues">
    <span class="count" id="count">${issues.length} issues</span>
  </div>
  <div class="tags" id="tags">
${tagPills}
  </div>
</div>

<main class="wrap list" id="list">

  <h3 class="secthead">The past week</h3>

${week.map(issueCard).join('\n')}

  <h3 class="secthead">Older issues</h3>

${older.map(issueCard).join('\n')}

  <p class="none" id="none">Nothing matches that. Clear the search or the tag and try again.</p>
</main>

<div class="take">
  <div class="wrap">
    <p><b>Anything here is yours to take.</b> Writing under
      <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> — quote it, share it, just
      link back to where you got it.</p>
  </div>
</div>

${FOOTER}

<script>
  var q = document.getElementById('q'), tagsBox = document.getElementById('tags'),
      issues = [].slice.call(document.querySelectorAll('.issue')),
      count = document.getElementById('count'), none = document.getElementById('none'),
      activeTag = null;
  document.getElementById('archn').textContent = issues.length + ' issues';
  function apply(){
    var needle = q.value.trim().toLowerCase(), shown = 0;
    document.getElementById('list').classList.toggle('filtering', !!(q.value.trim() || activeTag));
    issues.forEach(function(el){
      var hitText = !needle || el.textContent.toLowerCase().indexOf(needle) !== -1;
      var hitTag = !activeTag || (' '+el.dataset.tags+' ').indexOf(' '+activeTag+' ') !== -1;
      var on = hitText && hitTag;
      el.style.display = on ? '' : 'none';
      if (on) shown++;
    });
    count.textContent = shown + (shown === 1 ? ' issue' : ' issues');
    none.style.display = shown ? 'none' : 'block';
  }
  q.addEventListener('input', apply);
  tagsBox.addEventListener('click', function(e){
    var b = e.target.closest('.tag'); if (!b) return;
    var t = b.dataset.t;
    activeTag = (t === '' || activeTag === t) ? null : t;
    [].slice.call(tagsBox.children).forEach(function(el){ el.classList.toggle('on', activeTag ? el.dataset.t === activeTag : el.dataset.t === ''); });
    apply();
  });
<\/script>

${SIGNUP_HANDLER}

</body>
</html>
`;
fs.writeFileSync(join(DEST, 'index.html'), index);

console.log(`site archive -> ${DEST}`);
console.log(`  ${wrote} issue pages + index.html${HAS_SIGNUP ? ' + assets/' : ''}`);
console.log(`  tag counts: ${[...counts].map(([k, v]) => `${k}=${v}`).join(' ')}`);
