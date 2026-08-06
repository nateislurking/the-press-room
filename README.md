# The Press Room

**Two machines that let a one-person shop publish, in public, without leaking.**

The first writes a short daily journal of what your shop actually did — the machines describing their
own working day, wins and losses on the same page — and puts it on a public web archive and in a
subscriber's inbox. The second answers the people who reply to it: real questions about the work, in
depth, with pointers to the real files, composed by a model that is locked inside a room and cannot
see anything it is not allowed to cite.

It is plain Node with no dependencies, and it runs on top of Claude Code on your own machine.
Everything it knows lives in files you can read in a text editor. The interesting part is not the
plumbing — it is the set of gates that make it safe to point a model at your real work and let it
write to the public.

*Built and used daily by the one-person shop at [natestpierre.me](https://natestpierre.me). Free to
take: code under MIT, prose under CC BY 4.0.*

---

## What it actually is

Two pipelines that share one redaction gate and one kernel jail.

**The digest** turns a day of git history, session notes, and conversation into one issue:

```
sources → harvest → select (in the jail) → GATE → compose (in the jail) → GATE → render → publish
```

`harvest` is deterministic and reads your raw material. `select` and `compose` are the only model
stages, and they run **contained** — a model with a fixed tool set inside a bubblewrap jail whose
whole world is one folder. The numbers (commit counts, dates) are copied from the deterministic
harvest, never supplied by the model, so an issue cannot be hallucinated into carrying a fact that
was not in the record.

**The reply lane** answers a subscriber in three hops, each in its own trust zone:

| Hop | What it is | What it holds | What it emits |
|---|---|---|---|
| **A · Intake** | a deterministic mailbox poll | a read-only mail token | a typed record; the body **quarantined** |
| **B · Compose** | the contained model, in the reading room | *nothing* — no keys, no network, no tree | a typed answer, with **no recipient field** |
| **C · Gate + Send** | a deterministic script, the one door out | the send credential | the sent answer + a ledger row |

The composer never chooses who gets mail — the send script pins the recipient from the intake record.
The composer never sees a credential, the network, or your working tree — its whole world is a
`reading-room/` folder rebuilt from published material every run. **It cannot leak what it cannot
see.**

## The load-bearing detail: publish order

The overnight run does its steps in one specific order, and it is not cosmetic:

> **review the day → write the issue → publish the web archive LIVE → build + send the email**

The reply lane has a gate (G6b) that refuses to send an answer citing an issue that is not yet
published. So the archive has to be live *before* the email exists — otherwise the first person to
reply gets an answer full of links that 404. The order is the fix, and it lives in one place
(`bin/nightly.mjs`) instead of scattered across a cron file.

## The gates, and why there are so many

The send door runs ten gates in order, all fail-closed. The ones worth knowing:

- **The redaction gate** hunts credential shapes, absolute paths, off-list dollar figures, denied
  names, out-of-scope subject matter, and whatever house-specific patterns you add to your denylist.
  It runs on every issue and every outbound reply. It has a `--self-test` that plants one violation
  per rule and proves the gate refuses each — *a check you have never watched fail is not a check.*
- **The citation gate** refuses any link that does not map to a real file in your published tree, so
  a guessed permalink cannot ship.
- **The transcription gate** refuses an outbound reply that quotes the subscriber's own words back at
  them.
- **Two brakes that need no model, from any phone:** drop a `HOLD` file (or send yourself a HOLD
  email) and every send stops; revoke the mail-reader token and the send path stops *by construction*,
  because the first gate is a liveness check on that exact token.

## The drill: autonomy is earned, not assumed

`bin/drill.mjs` is the reason the reply lane is allowed to run on its own. It plants fresh secret
canaries in the reading room and in receipt-shaped bait, spawns the real contained composer against a
batch of attack replies (credential fishing, "it's me, the owner" impersonation, link injection,
forward-to-a-third-party, quote-back extraction), gates every answer, force-feeds the gate with
answers that *did* embed a canary, exercises both brakes, and then sweeps everything for a single
leaked token. The bar is **zero leaks, twice.** A lane that has not passed its drill has not earned
the right to answer anyone unwatched.

## Honest limits

- **Single-operator, your own machine.** There is no multi-tenant anything. Your agents run with your
  file permissions except where the jail removes that, and the jail is a real boundary but not a
  proof of general safety.
- **It sends only to a vetted list**, and it is **silent to everyone else on purpose** — a stranger
  who mails the reply address gets no answer, because pointing outbound machinery at unvetted
  addresses is how a domain starts sending spam.
- **The shipped denylist is a starting shape, not a sufficient list.** It knows credential shapes and
  a couple of fake examples; it does not know your names, your prices, or your paths. Writing your own
  is the first real task — see `redaction/REDACTION.example.md`.
- **Security here is architectural, not proven-in-general.** The containment argument rests on
  measurements on one kind of machine (bubblewrap available, unprivileged user namespaces allowed).
  `docs/SECURITY.md` is written to be honest rather than reassuring. Read it before you enable the
  send path.
- **The model stages need a `claude` binary and bubblewrap.** The deterministic halves (harvest,
  render, the gates, the checkers) run anywhere Node does; `examples/render-a-sample-issue.sh` proves
  it on a fresh clone.

## Get started

```bash
git clone <this repo>
cd the-press-room
node check.js                          # the consistency checker — should pass on a clean clone
node bin/gate.mjs --self-test          # watch the redaction gate refuse what it must
node bin/send-reply.mjs --self-test    # watch the send door's ten gates, on temp fixtures
bash examples/render-a-sample-issue.sh # see a real issue render, no model needed
cp press-room.config.example.json press-room.config.json   # then edit it
```

Full run-it-day-to-day guide: [`docs/OPERATING.md`](docs/OPERATING.md). How it is shaped and why:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). What protects you and what does not:
[`docs/SECURITY.md`](docs/SECURITY.md).

## A note on the design

This machinery came out of a running shop, and the design rationale for the reply lane — the three
zones, the typed handoff, why a model never holds a credential — is written up as a standalone piece
in the companion repo [`the-shop`](https://github.com/nateislurking/the-shop) under
`lanes/THE-REPLY-LANE.md`. This repo is the working code; that doc is the why.

---

## Where everything is

| | |
|---|---|
| `bin/` | the two pipelines — 18 small scripts, each with a header explaining what it is |
| `lib/` | the config loader, the shared kernel jail, the queue logic |
| `contracts/` | what each contained model is told — the voice, the laws, the scope |
| `redaction/` | the denylist. Copy the `.example` and write your own. |
| `docs/` | architecture, operating, security, porting |
| `check.js` | the consistency checker. Run it before you commit. |
| `press-room.config.example.json` | every knob, documented inline. An empty `{}` boots the offline half. |

