# REDACTION — the denylist and the law (STARTER SHAPE — write your own)

> **⚠ This is a starting SHAPE, not a sufficient list.** It has the exact format the gate parses, and
> a few obviously-fake examples. It does **not** know your names, your addresses, your prices, or your
> paths. Copy it to the file named by `redactionFile` in your config (default `redaction/REDACTION.md`)
> and fill it in with the things that must never leave your shop. A denylist you did not write is a
> denylist that protects nothing.

**The gate fails closed.** Any hit ⇒ that day's issue does not publish, and it raises to you. This
file is the single source of the denylist; `bin/gate.mjs` parses the lines below at run time, so an
edit here IS an edit to the gate. Run `node bin/gate.mjs --self-test` after changing anything.

**Add lines freely; never remove one to make a file pass.** Curate the content instead.

## What the gate hunts on its own (built into gate.mjs — no configuration needed)

- Key/token shapes: `sk-…`, `re_…`, `Bearer …`, long mixed-case token runs (pure hex is allowed —
  commit shas and key hashes are receipts, not secrets), 16-char vowel-starved password runs.
- Absolute machine paths (`/home/you/…`, `/Users/you/…`, `C:\Users\…`) — repo-relative paths are fine.
- Email addresses not on the allow list below.
- Dollar figures not in the allowed set below.

## Allow lists

*Emails and dollar figures you are fine publishing. Everything else of that shape refuses.*

- allow-email: you@example.com
- allow-dollar: 10 20 25 30 50 100

## Denied names (people, customers, partners, private contacts — one per line)

*Anyone who has not given a public yes. The gate matches these case-insensitively on word boundaries.
Replace these examples with the real names you must keep out of a public issue.*

- deny: Marigold Thornbury
- deny: Example Contact

## Out-of-scope subject matter (the SCOPE gate, not the privacy gate)

*The denylist above asks "is this person identifiable?" These ask a different question: **"is this
the shop's technical record at all?"** Keep this HIGH-PRECISION — unambiguous vocabulary only, or a
gate that cries wolf daily becomes a gate you learn to bypass. These examples fit a shop that sells
to businesses; delete them if they do not fit yours.*

- deny-scope: sales call
- deny-scope: discovery call
- deny-scope: testimonial
- deny-scope: invoice
- deny-scope: retainer

## Your own domain rules (deny-regex)

*A `deny-regex:` line is a full regular expression (case-insensitive, matched anywhere). This is where
a house-specific pattern lives — a pricing formula you never publish, a project codename, an internal
metric — so the shipped code carries none of your specifics. The example below refuses any statement
of a "seat = tank" pricing relationship; replace it with your own, or delete it.*

- deny-regex: \bseats?\s*=\s*tank\b
- deny-regex: \btank\s*\+\s*\$

## The two soft gates (raise, never block)

*Not enforced by gate.mjs — judgment aids for whoever runs the shop.*

- **Ledger drift:** over a trailing window, if one party (you or the machine) is "right" in a large
  majority of beats, the selection is being flattered somewhere. Look at it. Never manufacture balance
  inside one issue.
- **The self-aimed jab:** the selector may propose a beat that makes fun of you; only you may include it.
