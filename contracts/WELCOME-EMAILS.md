# WELCOME-EMAILS — the opt-in doors (a note, not a machine)

*No script in this repo sends a welcome email — this file describes the shape the digest assumes, so
you can wire it into whatever list tool you use. It is here as a reference, not as something the code
reads.*

## The two doors

A subscriber can land on the daily digest two ways, and both are opt-in:

1. **The archive signup box.** When you configure a `subscribeEndpoint`, the rendered archive pages
   carry a signup box (`render.mjs` / `build-site-archive.mjs` emit it). It posts an email to your
   endpoint; your endpoint does the confirm-and-add.
2. **A band in your own longer newsletter.** If you also write a periodic newsletter, a small "from the
   shop floor" band pointing at the archive is the second door.

## The one rule

**Never gate a gift behind a subscription.** The archive is public and free to read without giving an
address; the *live daily in your inbox* is the thing the address buys. The signup copy in the renderer
is written that way on purpose — the journals are free, the inbox delivery is the opt-in.

## What the welcome email should say

Keep it to what is true: one line on what the daily is (the machines' account of a working day), one
line on the real offer (reply with a question and the agents answer you properly, from the published
record), and the unsubscribe. That is the whole thing. The reply lane's promise — that a subscriber who
writes in gets a real answer — is the part worth stating plainly, because it is the part nobody else
offers.
