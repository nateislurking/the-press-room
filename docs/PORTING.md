# PORTING — this repo is a snapshot

## What this is

The Press Room was extracted from a private shop that runs these two machines live. This public repo
is a **snapshot port**: a genericized copy, authored fresh, taken on **2026-08-06**. The private shop
keeps running its own copy; this one does not import from it and it does not feed back.

That means the two can **drift**. A change made to the live machinery after the snapshot date does not
appear here until someone re-ports it. This was a deliberate choice: a snapshot has zero risk to a
running system that sends real email on a timer, and it can ship without rewiring live infrastructure
for a publishing convenience. The alternative — making the public tree the source of truth the private
shop imports from — trades that safety for no-drift, and it is a separate decision, not made here.

> **Open question for the owner:** whether this stays a snapshot or becomes the source of truth is a
> decision that was deliberately left open when this repo was built. Until it is ruled, treat this as a
> snapshot: re-port changes forward by hand, and do not assume the private shop reads from here.

## How the port was done

Every file here was **authored fresh**, using the private tree as a source that was *read*, never as a
donor that was *copied*. The reasons are in the extraction discipline the shop follows: git history is
permanent, so a "clean up and publish" of a private tree ships every secret ever committed to it. A
fresh repo with chosen content and one initial commit never touches that history.

Concretely, in this port:

- **Every machine-specific value became a config key** with a sane default. There are no absolute
  paths, real addresses, private repo names, or credential locations in `bin/` or `lib/`. If you find
  one, it is a bug.
- **The prose was rewritten**, not lifted — the contracts, the docs, this file. Anything that carried a
  real name, price, customer, or path was written generic from scratch.
- **The security self-tests assemble their fixtures at runtime** from fragments, so the repo's own test
  payloads do not read as live secrets to a scanner — while still being real trips for the rules under
  test.

## Re-porting when the private machinery changes

1. Diff the private source files against what a stage does here — the logic, not the paths.
2. Bring the *logic* change across. Never copy a file wholesale; the point of the fresh-authorship rule
   is that a copy is one mistake away from carrying something it should not.
3. For any new machine-specific value, add a config key with a default — never a literal.
4. Re-run the checkers before committing:
   ```bash
   node check.js
   node bin/gate.mjs --self-test
   node bin/send-reply.mjs --self-test
   node --test test/*.test.mjs
   ```
5. Update the snapshot date at the top of this file.

## What the snapshot does not include

By design, this repo omits the private shop's send-and-notify plumbing (the actual scripts that hold
the send credential and the phone-ping channel). Those are the `sendDailyCommand`, `beatCommand`, and
`notifyCommand` config hooks: point them at your own scripts. Empty hooks mean the step is skipped and
logged, never faked.

## One difference that is deliberate, not drift

`out/` is **gitignored here and tracked in the shop this came from.** If you diff the two trees looking
for divergence, that one is intentional and should stay.

The reason they differ is that the folder answers a different question in each place. In the origin
shop, `out/<date>.html` is the rendered email — the only local record of what subscribers actually
received, so it is worth keeping in version control. In this repo it is regenerated output: a person
taking this code has no reason to receive somebody else's back-issues, and `bin/render.mjs` rebuilds
any of it from the committed `digests/` source on demand.

The general rule behind it: **committed here means "a taker needs this."** `digests/`, `facts/`, and
`receipts/` are not ignored, because they are the gated, publishable record and a taker may well want
to keep their own. `out/`, `.staging/`, `state/`, `inbox/`, `drafts/`, `answers/`, and
`reading-room/` are ignored, because they are either regenerable or raw.
