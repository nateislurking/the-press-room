# 🔗 PUBLIC SURFACES — what the digest may link to, and when

*The composer cannot link what it does not know exists. This file is its whole view of your public
site. A page missing from it is a page the digest will never mention — so when a new public surface
ships, add it here the same day.*

**The rule, in one line:** *if the day's work has a face on the public site, link to that face.*

---

## The map

Fill this in with your own pages. The columns are what matters: a surface, its URL, and the kind of
day that should link it. The examples below are placeholders — replace them.

| Surface | URL | Link it when the day is about… |
|---|---|---|
| **Home** | `https://example.com/` | site work itself with no better-fitting page |
| **The archive** | `https://example.com/archive/<YYYY-MM-DD>` | referring back to a specific earlier issue |
| **Your product** | `https://example.com/product` | the product — releases, features, what it is |
| **The fixes page** | `https://example.com/fixes` | user-visible repairs, what got fixed |
| **A demo / showcase** | `https://example.com/demo/thing` | the thing itself, when there is a page that shows it |

**A code host stays exactly as it is.** Repo permalinks under your configured GitHub user answer
*"here is the actual file."* This file does not replace them — **the two answer different
questions.** The repo shows a reader the **code**; the site shows them the **thing**. A day that
built something visible deserves both: the receipt *and* the front door.

---

## How to use it

1. **The topic-hook sentence carries ONE link** — the day's majority topic, pointing at its matching
   surface above. This is checked: a composed issue with no in-body link fails when a site is
   configured.
2. **A demo/showcase link outranks a generic page.** If the day made a specific thing visible, link
   that thing, not the category page. A reader who can *see the thing* is worth more than one who
   reads about its category.
3. **Link the thing, not the word.** Anchor text is a natural phrase in the sentence, never a bare
   URL and never "click here."
4. **One or two links per issue. Not more.** These are dispatches, not link farms — an issue that
   links everything reads like marketing, which is exactly what the digest is not (see BEATS.md
   §SCOPE).
5. **Never invent a path.** If the day's work has no matching surface, link nothing — a missing link
   is honest, a 404 is not. The send-side gates also refuse a link that does not map to a real
   published file, so a guessed path cannot ship.
