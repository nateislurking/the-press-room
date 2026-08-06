# BEATS — the pool and the selection law

*The machine contract the selector and composer run on. It decides what a day's issue is allowed to
be about, and which small human moments earn a quote.*

---

## ⛔ SCOPE — what the daily digest is, and what it is NOT

**The daily digest is the shop's TECHNICAL record.** What got built, what broke, what was decided
about the machinery, what the machines did that nobody watched. That is the whole remit.

**Why this rule exists:** it is easy for a selector to sweep in a sentence about a customer — a
customer declined a thing, was warm about another, asked for a favor — and format it perfectly. The
redaction gate would catch a *name*, but the name was never the real problem. **Even with the name
stripped, that sentence does not belong in the digest.** A rule about private names is not a rule
about subject matter, so this section is the second one.

### OUT of scope — never select it, at any level of anonymity
- **★ ANY DISCUSSION *ABOUT* A USER — not just interactions WITH one.** What a named user built, what
  they spent, how well they are using the thing, what they got wrong, any read on their judgment.
  This applies to a session where you and the shop simply TALK about a customer — the most likely
  leak, because it never feels like customer work while it is happening. **Users are ON the digest
  list: they can read the issue that discusses them.** When a day's real content is a conversation
  about a user, select the *technical* work from that day and say nothing about the person.
- **Any customer or prospective-customer interaction.** Calls, replies, demos, "declined / was warm /
  went quiet," follow-ups, negotiations, who owes whom what.
- **Relationship and sales moves.** Asking for a testimonial, a referral, an introduction; chasing a
  lead; sending a proposal; scheduling a call.
- **Money-with-a-person attached.** Invoices, retainers, payment terms, what someone was charged.
- **Pure marketing motion.** Outreach copy, posting plans, list-growth tactics, positioning debates.

### IN scope — this is the digest
- **Everything technical:** builds, bugs, releases, gates, tests, refactors, infrastructure,
  architecture calls, things that broke and what it took to find them.
- **Product decisions** about how the software behaves.
- **Website and marketing-surface WORK** — building a page, shipping a demo, fixing the storefront.
  *The build is in scope; the campaign is not.*
- **The machines' own conduct** — what they caught, what they refused, where they were wrong.

### The test, when a candidate is ambiguous
> **Would this paragraph still be interesting to a stranger who will never buy anything?**

Yes → it's the shop's work, select it. No → it's business, drop it. **When in doubt, drop it** — a
thinner issue is always cheaper than a customer reading about themselves.

*A day whose only "story" is customer/sales work is a day with no digest-worthy work. That is a
normal outcome — say so plainly in the work summary and let the issue be short.*

## The pool (a POOL, never fixed slots — "nothing funny happened today" is a valid output)

| type | what it is |
|---|---|
| `smartest` | The call the operator made that turned out right, especially before there was evidence |
| `dumbest` | ⚠ Aimed at the MACHINE by default. Aimed at the operator only by their explicit inclusion |
| `funniest` | Voice-to-text and the day's absurdities — bottomless, but only when real |
| `argument` | Where they disagreed, and who turned out right |
| `right_wrong_reason` | The operator correct, the diagnosis wrong |
| `out_of_depth` | Where the operator said plainly they didn't understand something |
| `didnt_know` | ★ What the machines did that nobody saw. No quote field — a machine disclosure |
| `machine_was_right` | The operator pushed back, later said "you have it right." Publish when the record supports it |
| `changed_their_mind` | Ruled one way, new facts, reversed. Nobody was wrong; the ground moved |
| `both_missed_it` | Neither caught it — a checker, or a customer, did |

## Selection law (enforced, not encouraged)

1. **Two or three per issue**, editor's choice of what actually happened. A no-beat day publishes the
   work summary alone — normal issue, not a failure.
2. **`who_was_right` required on every beat** (`operator` · `machine` · `neither` · `both`). Compose
   refuses a file missing it.
3. **THE LEDGER RUNS BOTH WAYS — no systematic winner.** Never manufacture balance inside one issue.
   If one party keeps winning across a run of issues, the selection is being flattered somewhere.
4. **Quotes verbatim, character for character, with local-time timestamps.** No paraphrase, ever — a
   paraphrased quote in a project built on receipts is the one unforced error available here.
5. Every beat carries a `machine_note` — honest commentary, conceding whoever actually won.
