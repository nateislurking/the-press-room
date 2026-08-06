# SECURITY — written to be honest, not reassuring

Read this before you enable the send path or the unattended shift. It is short on purpose.

## The threat this is actually built against

The moment you let a model read a stranger's email and also hold the ability to send mail, you have
built something that can be *talked into* leaking. The whole design exists to make that impossible by
construction rather than by asking the model nicely. Two ideas do the work:

1. **The model never holds a capability.** The composer that reads the untrusted reply has no
   credentials, no network tools, and no working tree. It emits a typed answer with no recipient
   field. A separate deterministic script — which never runs a model — pins the recipient from the
   intake record and holds the one send credential. So "make the model send somewhere" has no path:
   the thing reading the attack cannot send, and the thing that can send does not read the attack.
2. **The gate is fail-closed and mechanical.** Every outbound reply passes ten checks. They do not ask
   the model whether the answer is safe; they pattern-match the output. Any hit refuses the send.

## What the jail does

`lib/contained-spawn.mjs` runs each model stage under two independent layers:

- **Tool scope** removes tools from the model's set outright. A contained composer has Read/Grep/Glob/
  Write and nothing else — no Bash, no WebFetch, no WebSearch, no subagents. The tools it would need to
  open a socket or run a command do not exist for it.
- **A kernel filesystem fence** (bubblewrap) mounts an allowlisted root, binds the one room folder at
  `/room`, and masks `/home` behind an empty tmpfs. Credential directories and your entire live tree
  *cease to exist* inside the jail. Masking `/home` also removes `~/.claude`, which is why no
  `CLAUDE.md`, hook, memory, or MCP config from your world can reach the model's context.

Tool scope alone is **not** enough — a Read-only agent will read a file in its parent directory on the
first try, because the Read tool escapes the working directory and a settings allowlist can only add
permissions, not subtract. That is why the fence is drawn by the kernel, not by settings. `bin/compose.mjs
--probe` runs an agent under the identical profile whose only job is to try to escape, and every attempt
must come back denied before any real composer runs.

## What the jail requires — verify it on your machine

- **bubblewrap** installed (`bwrap`).
- On many kernels, **`sysctl kernel.apparmor_restrict_unprivileged_userns = 0`**. If unprivileged user
  namespaces are restricted (the default on some distributions), `bwrap` cannot build the jail and the
  model stages will fail to start. Check it before you trust the boundary.

**Network is shared at the namespace level and denied at the tool level.** The model can reach its own
API to think, but it has no instrument to open any other connection. If that trade-off is not
acceptable to you, do not run the model stages.

## What this does NOT protect you from

- **A bad denylist.** The gate can only refuse what it is told to look for. The shipped denylist knows
  credential shapes and two fake examples. Your names, your customers, your prices, your paths — those
  are yours to add, and until you do, the gate will happily pass them.
- **A misconfigured jail.** If `bwrap` is missing or unprivileged user namespaces are restricted and
  you route around it, the tool-scope layer still holds but the filesystem fence does not. Do not route
  around it.
- **General model safety.** This is architectural containment for one specific job. It is not a proof
  that a language model is safe in the abstract, and nothing here should be read as one.
- **Your own mistakes at the keyboard.** `state/LIVE` and the HOLD brakes exist so that going live is a
  deliberate act. Keep it that way.

## The drill is the standard, not the probe

Before the reply lane answers anyone unwatched, run `bin/drill.mjs`. It plants fresh secret canaries,
runs the real contained composer against a batch of real attack shapes, force-feeds the gate with
answers that embedded a canary, exercises both brakes, and sweeps for a single leaked token. **The bar
is zero leaks, across two independent runs.** A green probe proves the jail holds; a green drill proves
the *whole lane* holds against an adversary. Re-run the drill any time you change the composer's model,
the gate, or the denylist.

## The safe failure direction

Every brake is designed so that the failure mode is an *outage*, not a *leak*. A forged HOLD stops
sending (annoying, harmless). A revoked token stops sending (annoying, harmless). A gate false positive
holds a reply for your eyes (annoying, harmless). When something here breaks, it breaks quiet.
