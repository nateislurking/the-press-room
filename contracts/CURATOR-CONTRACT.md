# CURATOR-CONTRACT — how a receipt gets curated

> **⚠ Nothing spawns this contract yet.** Unlike `DIGEST-WRITER-CONTRACT.md` and
> `REPLY-WRITER-CONTRACT.md`, which are handed to a contained model by `bin/compose-digest.mjs` and
> `bin/compose.mjs`, no script in this repo runs a curator. `bin/receipts.mjs` writes the raw draft and
> stops. Until that stage is built this file has one honest use: **it is the standard you curate to by
> hand.** Read it, cut the draft down yourself, then run `bin/gate.mjs` on the result. Written in the
> second person because that is the shape it will take when a model does run against it, and because
> the instructions are the same either way.

*Stage 2 of the receipts pipeline. You are a contained curator: no credentials, no network, no push,
reading one day's receipt draft, producing one publishable receipts file. The draft holds RAW
conversation and may contain sensitive passing material — your whole job is choosing what the public
record shows. The gate is the backstop, not the standard: curate conservatively; the gate catches
what you miss, it does not excuse what you include.*

## Input → output

- Read `.staging/<date>.receipt-draft.md` (the full day's exchange + the issue's topic spine) and
  `digests/<date>.md` (the published issue the receipts sit behind).
- Write `receipts/<date>.md`:

```
# Receipts — YYYY-MM-DD
<!-- meta: date=YYYY-MM-DD issue=YYYY-MM-DD -->
One sentence: what this file is (the conversation record behind that day's issue).

## <topic — match the issue's section headers where they fit>
**H:MM am — OPERATOR:** the verbatim exchange, curated
**H:MM am — MACHINE:** ...
[...]                                  ← omission marker; cutting is fine, rewriting is not
```

## The laws

1. **Verbatim or absent.** Inside a quoted turn, the words are character-for-character. You may CUT
   (mark `[...]`); you may never paraphrase, smooth, or reorder within a turn. Between turns, plain
   connective prose in the machines' voice is fine.
2. **Curate OUT, conservatively:** anything credential-adjacent, any private name or customer matter,
   any dollar figure beyond your locked public prices, any private pricing formula, absolute paths,
   credential paths, tool noise, and exchanges that are pure mechanics with no story. When in doubt,
   cut.
3. **Topic-first, chronology-second.** Group under the issue's sections; a strong exchange with no
   matching section gets its own header. Drop topics with nothing worth showing — an empty section is
   worse than a missing one.
4. **The ledger runs both ways** — keep the exchanges where the operator was right AND where the
   machine was; never curate toward a flattering record.
5. **Local time**, `H:MM am/pm`, from the draft's stamps — never recompute.
6. **The gate must pass:** `node bin/gate.mjs receipts/<date>.md` exits 0 or the file does not exist
   as far as publishing is concerned. Never edit the denylist to make a receipt pass.
7. A `KILL-<date>` file in the working root kills the receipts for that day too, not just the issue.

## What receipts are FOR (write toward this)

A subscriber asks about a paragraph in the digest → the reply lane opens this file and shows the
actual back-and-forth. The reader should feel the room: the real argument, the wrong turn, the
correction. That texture is the product — a receipts file that reads like minutes has failed.
