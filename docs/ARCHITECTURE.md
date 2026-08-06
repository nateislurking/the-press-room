# ARCHITECTURE — the two machines, the three hops, and why the order matters

This is how the Press Room is shaped and why. If you just want to run it, read
[`OPERATING.md`](OPERATING.md); if you are about to enable the send path, read
[`SECURITY.md`](SECURITY.md) first.

## The shared spine

Both machines are built out of the same three ideas:

1. **A deterministic reader, a contained writer.** The scripts that touch your raw material (git logs,
   transcripts, mailboxes) are plain deterministic Node. The scripts that use a model run it inside a
   jail whose whole world is one folder. The reader and the writer never overlap: the reader produces
   a typed file; the writer reads only that typed file.
2. **A typed handoff.** What crosses from one stage to the next is always structured JSON with a fixed
   schema — never free prose. A model cannot inflate a number that was copied from a git count, and a
   downstream stage cannot be talked into anything by text, because it consumes fields, not sentences.
3. **A fail-closed gate.** Nothing reaches the public without passing the redaction gate, and the gate
   refuses on *any* hit. A refused day does not publish and raises to you; a refused reply is kept for
   your eyes and nothing is sent.

## Machine 1 — the digest

```
sources ─► harvest ─► .staging/<date>.candidates.json
                         │  (raw transcript text — GITIGNORED)
                         ▼
                      select  ── in the jail ──►  facts/<date>.json ──► GATE
                         │        (picks work + beats; numbers copied from harvest)
                         ▼
                      compose ── in the jail ──►  digests/<date>.md ──► GATE
                         │        (reads ONLY the typed facts)
                         ▼
                      render ─►  out/<date>.html   (email + web variants)
                         │
                         ▼
                 build-site-archive ─►  <site>/archive/<date>.html + index
```

- **`harvest`** normalizes every timestamp from UTC to your one configured zone, *once*, so a late-night
  turn lands on the right calendar day. It writes to `.staging/`, which is gitignored, because raw
  candidate text can carry anything.
- **`select`** is the judgment stage and the one place untrusted transcript text meets a model — so it
  is contained to protect the *shop*. It picks the work summary and two or three beats; the date and
  counts are copied straight from the deterministic harvest.
- **`compose`** reads only the already-gated typed facts, so it is contained to protect the *output*:
  it cannot reach past its evidence even if it wanted to.
- **`render`** and **`build-site-archive`** are deterministic and hold no model. They turn the typed
  issue into an email and a set of web pages.

Two ancillary pipelines share the same shape: **receipts** (`receipts` → a contained curator →
`gate`) publishes the conversation record behind each issue, and **fixes** (`build-fixes-day`) writes a
user-facing "what changed" row onto a public page from your product commits.

## Machine 2 — the reply lane

Three hops, three trust zones:

| Hop | Zone | Holds | Emits |
|---|---|---|---|
| **A · Intake** (`intake-sweep`) | reader | a read-only mail token | a typed intake record; the body **quarantined**, never interpreted |
| **B · Compose** (`compose`, in the jail) | contained | nothing — no keys, no network, no tree | a typed answer, with **no recipient field** |
| **C · Gate + Send** (`send-reply`) | the one door out | the send credential | the sent answer + a ledger row |

The composer's world is `reading-room/`, rebuilt every run by `build-reading-room` from an explicit
allowlist of published sources (your rendered issues, digests, gate-passed facts and receipts, your
public site's top level, and any public repos you name — copied via `git ls-files` so only committed,
already-gated files enter). Adding a source to that allowlist is a deliberate design act.

`shift` is the scheduled runner that automates A→B→C up to the *draft*, and stops. It never sends;
sending is a separate command you run once you have read the draft.

## Why the publish order is load-bearing

`nightly.mjs` runs: **review → write → publish the web archive LIVE → build + send the email.** The
send gate (G6b) refuses a reply that cites an issue not yet on the public archive. If the email went
out before the archive was live, the first subscriber to reply would be answered with citations that
404 while the pages caught up. Publishing first closes that window. The order is enforced in one file,
not implied by a schedule.

## The ten gates (in `send-reply.mjs`, in order)

`G0` liveness · `G1` HOLD (file + email) · `G2` intake resolves, recipient pinned · `G3` sender is a
subscriber · `G4` not already answered · `G5` under the daily cap · `G6` links on the allowlist ·
`G6b` every link maps to a real published file · `G7` no verbatim subscriber text echoed back · `G8`
redaction (the shared denylist + secret shapes) · `G9` shape (disclosed-bots signature present, body
length, subject sane). Any trip → no send + a printed reason.

## The two no-model brakes

1. **HOLD.** A `HOLD` file in the working root, or a HOLD email from one of your own addresses, stops
   every send. A forged HOLD costs an outage, never a leak — the safe failure direction.
2. **Revoke the reader token.** `G0` is a liveness check on the mail-reader token. Revoke it and the
   send path stops *by construction*, even though outbound rides a different provider.

## Where the machine boundaries are drawn

- **The jail** (`lib/contained-spawn.mjs`) mounts an allowlisted root, binds the room at `/room`, and
  masks `/home` behind a tmpfs — so credential directories and your live tree cease to exist inside
  it, and no `CLAUDE.md`, hook, memory, or MCP config from your world reaches the contained model's
  context. Network is shared at the namespace level (the model must reach its own API) but denied at
  the *tool* level (no Bash, no WebFetch, no WebSearch), so the agent has no instrument to open a
  socket. See [`SECURITY.md`](SECURITY.md) for what this does and does not guarantee.
- **The config** (`lib/config.mjs`) is the only place a machine-specific value lives. There are no
  paths baked into the scripts; if you find one, it is a bug.
