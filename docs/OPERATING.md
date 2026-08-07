# OPERATING — running it day to day

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) once for the shape, and [`SECURITY.md`](SECURITY.md) before
you turn on the send path. This is the day-to-day.

## What you need

| | |
|---|---|
| **Node.js** | 18 or newer. No packages to install — standard library only. |
| **Claude Code** | Installed and signed in, for the model stages. If `claude` runs in your terminal, you're set; otherwise set `claudeBin` in your config. |
| **bubblewrap** (`bwrap`) | For the jail. Linux; see `SECURITY.md` for the kernel setting it needs. The deterministic stages don't use it. |
| **Fastmail + MailerLite** | ⚠ **Hard requirement for the reply lane, not a preference.** Intake is JMAP written against Fastmail (`bin/intake-sweep.mjs`), and list membership is MailerLite. Neither is a config hook — using another mailbox or list is a code change, and `intake-sweep` refuses to start against anything else. |
| **A send provider** | The daily dispatch and the reply send. This one *is* pluggable: `sendDailyCommand` is a shell hook you point at your own script, so any provider works. |

**The digest's web archive needs none of that row.** Harvest, select, compose, render, the archive, the
gates and every checker run with no mailbox, no list and no send credential at all. If you only want
the daily journal and its public archive, stop reading at the end of "The digest, by hand"; the reply
lane is a separate machine you can leave switched off forever.

## First run

```bash
node check.js                          # consistency checker — should pass on a clean clone
node bin/gate.mjs --self-test          # the redaction gate refuses what it must
node bin/send-reply.mjs --self-test    # the send door's eleven gates (self-contained temp fixtures)
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

**Set `sourceRepos` first.** `harvest` reads the day's git activity out of the repos you list there,
and it ships empty — with nothing listed there is no material, and the failure does not surface until
the *compose* stage refuses with a message about the day being empty, which reads like a different
problem entirely. Add at least one:

```json
"worldRoot": "..",
"sourceRepos": [{ "name": "my-app", "path": "my-app" }]
```

`path` is relative to `worldRoot` unless absolute. Then pick a date you actually worked:

```bash
node bin/harvest.mjs 2026-08-12        # one day of raw material -> .staging (gitignored)
node bin/select.mjs  2026-08-12        # pick work + beats (jailed model), then gate
node bin/compose-digest.mjs 2026-08-12 # write the issue (jailed model), then gate
node bin/render.mjs 2026-08-12 --web   # -> out/web/2026-08-12.html
node bin/build-site-archive.mjs        # wrap every issue in site chrome -> your archive dir
```

Or all of it in the ruled order:

```bash
node bin/nightly.mjs --date 2026-08-12 # review -> write -> publish web -> build email
node bin/nightly.mjs --yesterday --send # what the timer runs: the day just ended, and dispatch
```

⚠ **Not `2026-08-06`.** `examples/render-a-sample-issue.sh` — which the README has you run first —
writes `digests/2026-08-06.md`, and the compose stage refuses to overwrite an issue that already
exists. Use any other date, or delete the sample issue before reusing that one.

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

Standalone — these need nothing but Node, and work on a fresh clone:

```bash
node check.js
node bin/gate.mjs --self-test
node bin/send-reply.mjs --self-test
node bin/check-attribution.mjs --self-test
node --test test/*.test.mjs
node bin/drill.mjs --dry-run           # the drill harness end to end, 0 model spawns
```

Needs more than Node:

```bash
node bin/build-reading-room.mjs        # ← FIRST. --probe spawns INTO the reading room, and there
                                       #   is no room on a fresh clone. Without this you get a
                                       #   "no reading room" error that reads like a bug.
node bin/compose.mjs --probe           # the containment probe — needs bwrap AND a claude binary
```
