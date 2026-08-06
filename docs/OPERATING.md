# OPERATING — running it day to day

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) once for the shape, and [`SECURITY.md`](SECURITY.md) before
you turn on the send path. This is the day-to-day.

## What you need

| | |
|---|---|
| **Node.js** | 18 or newer. No packages to install — standard library only. |
| **Claude Code** | Installed and signed in, for the model stages. If `claude` runs in your terminal, you're set; otherwise set `claudeBin` in your config. |
| **bubblewrap** (`bwrap`) | For the jail. Linux; see `SECURITY.md` for the kernel setting it needs. The deterministic stages don't use it. |
| **A mailbox + a subscriber list + a send provider** | Only for the reply lane and the email dispatch. The digest's web archive needs none of it. |

## First run

```bash
node check.js                          # consistency checker — should pass on a clean clone
node bin/gate.mjs --self-test          # the redaction gate refuses what it must
node bin/send-reply.mjs --self-test    # the send door's ten gates (self-contained temp fixtures)
node --test test/*.test.mjs            # the unit tests
bash examples/render-a-sample-issue.sh # render a real issue with no model in the loop
cp press-room.config.example.json press-room.config.json
```

Then edit `press-room.config.json`. Every key is documented in the example. An empty `{}` runs the
offline half; the reach-out parts (transcripts, the live site, credentials, the send command) each
default to empty and the code says so cleanly rather than crashing.

## The denylist is the first real task

The gate ships knowing credential *shapes* and a couple of fake examples. It does not know your names,
your prices, or your paths. Copy `redaction/REDACTION.example.md` to `redaction/REDACTION.md` and fill
it in, then:

```bash
node bin/gate.mjs --self-test          # re-run after every denylist edit
```

Your `redaction/REDACTION.md` is gitignored by default, because your real denylist is a map of what it
protects. A denylist you did not write is a denylist that protects nothing.

## The digest, by hand

```bash
node bin/harvest.mjs 2026-08-06        # one day of raw material -> .staging (gitignored)
node bin/select.mjs  2026-08-06        # pick work + beats (jailed model), then gate
node bin/compose-digest.mjs 2026-08-06 # write the issue (jailed model), then gate
node bin/render.mjs 2026-08-06 --web   # -> out/web/2026-08-06.html
node bin/build-site-archive.mjs        # wrap every issue in site chrome -> your archive dir
```

Or all of it in the ruled order:

```bash
node bin/nightly.mjs --date 2026-08-06 # review -> write -> publish web -> build email
node bin/nightly.mjs --yesterday --send # what the timer runs: the day just ended, and dispatch
```

**The three stops** (files in the working root): `PAUSE` stands every run down; `KILL-<date>` kills one
day; `HOLD-<date>` composes the day but publishes nothing, for your review — release it with
`node bin/nightly.mjs --date <date> --send --release`.

## The reply lane, by hand

```bash
node bin/intake-sweep.mjs              # poll the mailbox -> typed records in inbox/
node bin/build-reading-room.mjs --with-intake inbox/<rec>.json
node bin/compose.mjs --intake inbox/<rec>.json          # jailed composer -> answers/<id>.json
node bin/send-reply.mjs --draft answers/<id>.json       # run every gate, stage the draft
node bin/send-reply.mjs --send  answers/<id>.json       # actually send — refuses until state/LIVE
```

`state/LIVE` does not exist until you create it, by hand, once you have run the drill and watched a
first send go out. Until then, `--send` refuses. That is deliberate.

The scheduled version is `node bin/shift.mjs`: it sweeps, composes, gates, and stages drafts, and
**never sends**. Point `notifyCommand` at your own phone-ping to get a count when drafts are waiting.

## The brakes (no model, no session)

- **HOLD:** `touch HOLD` in the working root, or send yourself a HOLD email from a configured owner
  address. Every send stops. Resume by removing the file / sending a RESUME email.
- **Revoke the reader token:** delete it at your mail provider. The send path stops by construction.

## Two gotchas

- **Transcript directories are keyed by working directory.** Claude Code stores a session's transcript
  in a directory derived from the folder the session ran in. If you run sessions from more than one
  place, they land in more than one transcript directory, and `harvest` only reads the one you point
  `transcriptsDir` at. If a day's issue is missing conversation you know happened, this is usually why.
- **The systemd `oneshot` services + timers** in `units/` are the unattended form. Install the pair,
  edit `WorkingDirectory` and the times, `systemctl --user daemon-reload`, enable the *timer*. Keep it
  running while logged out with `sudo loginctl enable-linger $USER`.

## Health checks you can run any time

```bash
node bin/gate.mjs --self-test
node bin/send-reply.mjs --self-test
node bin/check-attribution.mjs --self-test
node bin/compose.mjs --probe           # the containment probe (needs bwrap + claude)
node bin/drill.mjs --dry-run           # the drill harness end to end, 0 model spawns
node check.js
```
