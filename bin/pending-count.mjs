#!/usr/bin/env node
// pending-count.mjs — prints the number of reply drafts waiting to be cleared. This is the count a
// morning roll-up folds into a single phone ping ("… and N replies to clear"), so overnight drafts
// never ping the phone one at a time.
// Prints a single integer + newline. Exit 0 always (a broken count must never break the morning ping).
import { listPending } from '../lib/desk-queue.mjs';
try { process.stdout.write(String(listPending().length) + '\n'); }
catch { process.stdout.write('0\n'); }
