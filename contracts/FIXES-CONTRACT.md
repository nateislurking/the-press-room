# FIXES-CONTRACT — how a day gets a row on the public fixes page

*The fixes page is a **promise being kept in public**: "I said I work on this every day. This is how
you check." Everything below protects that sentence.*

**Audience: a regular person who uses your product.** Not a subscriber who likes watching a shop run
— that is the daily digest, a different publication with a different contract. This page is for the
person who paid, seeing what actually changed for them.

---

## What earns a row

**Only changes a USER can feel.** The test: *could the person who uses this notice the difference?* If
no, it does not go on this page — no matter how much work it was.

| Earns a row | Does NOT |
|---|---|
| A thing they can now do | Shop infrastructure, your own tooling, this repo |
| Something broken that now works | Refactors, test coverage, internal gates |
| Something that already worked, now working well | Docs, session logs, the digest pipeline |
| A release that reached their machine | Work in progress that has not shipped to them |

**A day with no user-visible product change gets NO day block.** Not a thin row, not a stretch, not
"kept working on it." An honest gap is the entire point of the page — a manufactured row to keep a
streak alive is the one thing that would actually break the promise in the subtitle.

## The three tags — pick by what the reader experiences

| Tag | Means |
|---|---|
| `New` | something you can now do |
| `Fixed` | something was broken |
| `Better` | it already worked; now it works well |

## Voice — story-shaped, warm and plain

A row is a tiny story with a turn in it, not a changelog line.

- **Bold lead sentence** = what changed, in plain words a non-technical person reads without stopping.
- **Then the story**: what it was like before, what happened, what it is like now. Concede the miss
  where there was one — that candour is the brand; it is why the page is believed.
- **Warm, plain, no swagger, no hype.** No "we're excited to announce." No marketing verbs.
- **No jargon a customer would not use.** Not: refactor, regression, CI, commit, endpoint, iframe,
  sandbox, systemd, gate, harness, repo, worktree. Say what it does, not what it is made of.
- **Never name a person, a customer, or a company.** Never a dollar figure outside your locked public
  prices. Same denylist as everything else here.
- Second person for the reader (*"the change sticks"*), first person singular when a row needs a hand
  in it (*"I said so out loud"*).

## Shape on the page

```html
<!-- ══════════ AUGUST 4 ══════════ -->
<div class="day">
<h2 class="day__date">August 4, 2026 <small>Tuesday</small></h2>
<div class="row"><i class="tag tag--new">New</i><p><strong>Lead sentence.</strong> The story.</p></div>
</div>
```

- `<small>` carries the weekday, optionally plus a short human note when the day had one. Keep it
  rare; most days are just the weekday.
- Tag classes: `tag--new` / `tag--fix` / `tag--bet`. The visible label is `New` / `Fixed` / `Better`.
- **Newest day first**, inserted directly under the legend block.
- **1–4 rows a day.** More than that and no one reads any of them.

## The gates (mechanical, in `bin/build-fixes-day.mjs`)

1. **Idempotent** — a day already on the page is never written twice. Re-running is safe.
2. **Redaction** — the standard gate runs on the rows before they touch the file.
3. **No-jargon** — a wordlist a customer would not use refuses the day.
4. **Shape** — 1–4 rows, every row carries a known tag and a `<strong>` lead.
5. **Empty is valid** — zero rows exits 0 and touches nothing. Never an error.
6. **Push is scoped** — stages the fixes page alone, never another job's work.

*This machine writes onto an existing page that already has a `class="legend"` block and `class="day"`
sections. If no such page is configured, it exits cleanly and does nothing.*
