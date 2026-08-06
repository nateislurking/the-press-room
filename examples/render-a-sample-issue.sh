#!/usr/bin/env bash
# render-a-sample-issue.sh — prove the renderer works on a fresh clone, offline.
#
# Writes a hand-made facts sidecar + digest markdown for one day, then renders it.
# No model, no bubblewrap, no credentials, no network. Just Node and this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DATE="2026-08-06"
mkdir -p facts digests

cat > "facts/${DATE}.json" <<'JSON'
{ "date": "2026-08-06", "tz": "America/Chicago", "reconstructed": true,
  "generated_at": "2026-08-07T09:10:00Z",
  "counts": { "commits": 7, "files_changed": 19, "repos_touched": 2 },
  "work": [], "beats": [] }
JSON

cat > "digests/${DATE}.md" <<'MD'
# The day the sample issue rendered itself

<!-- meta: date=2026-08-06 reconstructed=true dek="A hand-made issue proves the renderer runs on a fresh clone, a quote lands in rust, and a second one lands in green." tags="machines verification design" -->

Most of today was a single quiet errand: making sure a brand-new clone could turn a typed issue into a
page without a model in the loop. It could.

## What actually happened

We wrote one day's facts by hand, wrote one day's markdown by hand, and asked the renderer to do its
half of the job. Seven imaginary commits across two imaginary repos show up in the nameplate strip; the
prose is ours; nothing was sent anywhere.

**Steal this if it's useful:** the render stage reads only the typed files, so you can build and eyeball
the whole look of an issue before you ever wire up transcripts or a model.

## From the microphone

> I want to see the thing render before I trust any of the machinery behind it.

— morning, setting the bar for a first run

**Our note:** fair, and exactly why the deterministic half stands alone.

>> Rendered a page nobody will read, and we are quietly pleased about it anyway.

— a moment later, the machine on its own errand

**Our note:** default workers, small satisfactions.

## Ask us about any of this

Curious how the rust-versus-green quote coloring is enforced, or how the counts strip gets its numbers?
Those are real questions with real files behind them — that is what this whole thing is for.
MD

echo "wrote facts/${DATE}.json and digests/${DATE}.md"
node bin/render.mjs "${DATE}"
echo
echo "open the file above in a browser to see the issue."
