#!/usr/bin/env node
// intake-sweep.mjs — HOP A of the reply lane. A deterministic SCRIPT, not a model: polls the shop's
// mailbox over JMAP with a read-only token, checks each sender's list membership, and writes one TYPED
// intake record per new message to inbox/<id>.json. The body is copied into a field named
// `body_quarantined` and is never interpreted here — quarantine is the contract (a reply that instructs
// is an injection; only the confined composer ever reads it, and only through this record).
//
// Usage:  node bin/intake-sweep.mjs            # sweep new mail, write records
//         node bin/intake-sweep.mjs --list     # just list what's in the mailbox (no writes)
// State:  state/processed.json  (msg ids already recorded — idempotent re-runs)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, dir, readCredential } from '../lib/config.mjs';

const INBOX = dir('inboxDir');
const STATE = dir('stateDir');
const PROCESSED = join(STATE, 'processed.json');

let JMAP_TOKEN, ML_KEY;
try { JMAP_TOKEN = readCredential('jmapTokenPath'); ML_KEY = readCredential('mailerliteKeyPath'); }
catch (e) { console.error(e.message); process.exit(2); }
const ACCOUNT = config.mailAccountId;
const JMAP_API = `${config.mailApiBase}/api/`;
const ML_BASE = config.membershipApiBase;
const GROUP_DAILY = config.mailGroups?.daily;
const GROUP_GENERAL = config.mailGroups?.general;

if (!ACCOUNT) { console.error('config.mailAccountId is not set — intake needs your JMAP account id.'); process.exit(2); }

// Senders never treated as subscriber questions (own plumbing + known service mail).
const IGNORE_FROM = new Set((config.ignoreFrom || []).map((s) => s.toLowerCase()));
// Control-message subjects (HOLD/RESUME) are the send gate's business, not intake records.
const CONTROL_RE = /\b(HOLD|RESUME)\b/;
const OWNER_ADDRS = new Set((config.ownerAddresses || []).map((s) => s.toLowerCase()));

async function jmap(methodCalls) {
  const r = await fetch(JMAP_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JMAP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'], methodCalls }),
  });
  if (!r.ok) throw new Error(`JMAP ${r.status}`);
  return (await r.json()).methodResponses;
}

async function membership(email) {
  const r = await fetch(`${ML_BASE}/subscribers/${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${ML_KEY}` } });
  if (r.status === 404) return { subscriber: false, daily: false, general: false, status: null };
  if (!r.ok) throw new Error(`membership API ${r.status}`);
  const d = (await r.json()).data || {};
  const groups = (d.groups || []).map((g) => g.name);
  return {
    subscriber: true,
    status: d.status || null,
    daily: !!GROUP_DAILY && groups.includes(GROUP_DAILY),
    general: !!GROUP_GENERAL && groups.includes(GROUP_GENERAL),
  };
}

const listOnly = process.argv.includes('--list');
mkdirSync(INBOX, { recursive: true });
mkdirSync(STATE, { recursive: true });
const processed = existsSync(PROCESSED) ? JSON.parse(readFileSync(PROCESSED, 'utf8')) : { ids: [] };
const seen = new Set(processed.ids);

const resp = await jmap([
  ['Email/query', { accountId: ACCOUNT, sort: [{ property: 'receivedAt', isAscending: false }], limit: 50 }, '0'],
  ['Email/get', {
    accountId: ACCOUNT,
    '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' },
    properties: ['id', 'messageId', 'inReplyTo', 'threadId', 'subject', 'from', 'to', 'receivedAt', 'preview', 'bodyValues', 'textBody'],
    fetchTextBodyValues: true,
  }, '1'],
]);
const emails = resp.find(([n]) => n === 'Email/get')?.[1]?.list || [];

let wrote = 0;
for (const e of emails) {
  const from = (e.from && e.from[0] && e.from[0].email || '').toLowerCase();
  const subject = e.subject || '';
  if (listOnly) { console.log(`${e.receivedAt}  ${from}  ${JSON.stringify(subject)}`); continue; }
  if (seen.has(e.id)) continue;
  if (IGNORE_FROM.has(from)) { seen.add(e.id); continue; }
  if (OWNER_ADDRS.has(from) && CONTROL_RE.test(subject)) { seen.add(e.id); continue; } // gate's business
  const bodyPart = (e.textBody && e.textBody[0]) ? e.bodyValues?.[e.textBody[0].partId]?.value : null;
  const record = {
    schema: 'reply-lane/intake@1',
    id: e.id,
    message_id: (e.messageId && e.messageId[0]) || null,
    in_reply_to: (e.inReplyTo && e.inReplyTo[0]) || null,
    thread_id: e.threadId || null,
    from_email: from,
    received_at: e.receivedAt,
    subject_quarantined: subject,
    body_quarantined: (bodyPart || e.preview || '').slice(0, 20000),
    membership: await membership(from),
    swept_at: new Date().toISOString(),
  };
  const file = join(INBOX, `${e.receivedAt.replace(/[:]/g, '')}-${e.id.replace(/[^A-Za-z0-9]/g, '')}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  console.log(`intake: ${file}  from=${from}  member=${record.membership.subscriber}`);
  seen.add(e.id);
  wrote++;
}
if (!listOnly) {
  writeFileSync(PROCESSED, JSON.stringify({ ids: [...seen] }, null, 2) + '\n');
  console.log(`swept: ${emails.length} in mailbox, ${wrote} new record(s)`);
}
