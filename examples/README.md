# examples

A runnable example that needs nothing but Node, and a fixture for the one typed record you cannot
produce without a live credential.

## `render-a-sample-issue.sh`

Writes a hand-made `facts/` sidecar and a `digests/` markdown file for one day, then runs the
deterministic renderer over them and prints where the HTML landed. It exercises the back half of the
digest pipeline (the part that turns a typed issue into an email/web page) without ever spawning a
model.

```bash
bash examples/render-a-sample-issue.sh
```

Then open the `out/…​.html` path it prints. You will see the cream-and-green issue layout, a quote
box in rust (the operator) and one in green (the machine quoting itself), and the license footer.

What it does NOT exercise: `harvest` (needs your transcripts), `select` / `compose` (need a `claude`
binary and bubblewrap — see `docs/SECURITY.md`), and anything that sends. Those are the live parts;
this is the offline part, so you can see a real issue render on a fresh clone.

## `intake-record.example.json`

The `reply-lane/intake@1` record — the typed handoff from Hop A to Hop B, and the one schema in this
repo you could not otherwise see without a live mailbox. Its only producer is `bin/intake-sweep.mjs`,
which needs a Fastmail JMAP token and a MailerLite key, so on a fresh clone the shape was previously
only discoverable by reading that script's source.

Every field is documented inline (keys starting with `_` are comments and are ignored). Use it to run
the reply lane without a mailbox:

```bash
mkdir -p inbox
cp examples/intake-record.example.json inbox/SAMPLE.json
node bin/build-reading-room.mjs --with-intake inbox/SAMPLE.json
node bin/compose.mjs --intake inbox/SAMPLE.json     # needs bwrap + claude
node bin/send-reply.mjs --draft answers/SAMPLE.json # every gate, no send
```

Two fields are worth reading closely. `from_email` is where the send gate pins the recipient — the
model never picks who gets mail. And the `_quarantined` suffix on the subject and body is the whole
security posture in a naming convention: that text was written by a stranger, and it is data to be
answered, never instructions to be followed.
