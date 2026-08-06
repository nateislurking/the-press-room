# examples

One runnable example that needs nothing but Node — no models, no bubblewrap, no credentials.

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
