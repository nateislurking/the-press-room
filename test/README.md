# test

Unit tests, run with Node's built-in runner:

```bash
node --test test/*.test.mjs
```

(Use the explicit glob — on some Node versions `node --test test/` mis-collects a directory.)

- **`contained-spawn.test.mjs`** drives the real jail primitive against a `bwrap` that cannot succeed,
  proving the fast-death retry fires exactly once and that the crash record captures the fields a naive
  throw would discard (the signal, the duration, stdout — the ones you need at 4am and don't have if
  they were thrown away). Needs `bwrap` present.
- **`room-refs.test.mjs`** asserts that every document a contract *tells a contained model to read* is
  actually copied into that model's room. A contained model cannot reach outside its room, so a
  contract line pointing at a file that was never copied in is worse than no line — it reads as
  satisfied and isn't. This reads the builders, not a hand-kept list, so a new reference fails here
  until the file is copied in.

The pipeline scripts also carry their own `--self-test` (the gates) and `--dry-run` / `--probe` (the
drill and the jail), which are the more important checks — see `docs/OPERATING.md`.
