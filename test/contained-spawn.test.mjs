// contained-spawn.test.mjs — the fast-death retry + crash capture.
//
// WHY: a transient can kill a contained spawn in the first few seconds, having produced nothing. If
// spawnContained discards the evidence — throwing a truncated stderr and never looking at stdout or
// the signal — that failure cannot be diagnosed, because the observed transient prints EMPTY stderr,
// so the one field a naive throw keeps is the one field that is blank.
//
// These tests drive the real function by pointing it at a bwrap that cannot work, which is the same
// shape as the crash they guard against: a spawn that dies almost immediately having produced nothing.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { spawnContained } from '../lib/contained-spawn.mjs';
import { config, path as cfgPath } from '../lib/config.mjs';

const CRASH_LOG = cfgPath(config.crashLog || 'state/spawn-crashes.log');

// A room that does not exist makes bwrap fail fast — a fast death with nothing produced.
const DEAD_ROOM = '/nonexistent-room-for-the-spawn-test';

test('a fast death is retried exactly once, then throws', () => {
  const before = existsSync(CRASH_LOG) ? readFileSync(CRASH_LOG, 'utf8').length : 0;
  let threw = null;
  try {
    spawnContained(DEAD_ROOM, 'noop', { label: 'selftest-fastdeath', timeoutMs: 20_000 });
  } catch (e) { threw = e; }

  assert.ok(threw, 'a dead spawn must still throw after the retry — a retry is not a rescue');
  assert.match(threw.message, /SECOND attempt — the retry failed too/,
    'the throw must say the retry was used, or a reader cannot tell one failure from two');

  const after = readFileSync(CRASH_LOG, 'utf8');
  const added = after.slice(before);
  const attempts = (added.match(/selftest-fastdeath · attempt/g) || []).length;
  assert.strictEqual(attempts, 2, `expected exactly 2 recorded attempts, got ${attempts}`);
});

test('the crash record carries what a naive throw would throw away', () => {
  const before = existsSync(CRASH_LOG) ? readFileSync(CRASH_LOG, 'utf8').length : 0;
  try { spawnContained(DEAD_ROOM, 'noop', { label: 'selftest-capture', timeoutMs: 20_000 }); } catch { /* expected */ }
  const added = readFileSync(CRASH_LOG, 'utf8').slice(before);

  assert.match(added, /status=/, 'no exit status recorded');
  assert.match(added, /signal=/, 'no signal recorded — a killed spawn looked identical to a failed one');
  assert.match(added, /secs=/, 'no duration recorded');
  assert.match(added, /--- stdout \(\d+ chars\) ---/, 'stdout was never captured');
  assert.match(added, /--- stderr \(\d+ chars\) ---/, 'stderr length must be recorded even when empty');
});

test('the throw points at the full capture, so nobody has to know it exists', () => {
  let msg = '';
  try { spawnContained(DEAD_ROOM, 'noop', { label: 'selftest-pointer', timeoutMs: 20_000 }); }
  catch (e) { msg = e.message; }
  assert.ok(msg.includes(CRASH_LOG),
    'the error must name the crash log — the evidence is worthless if the person reading the failure ' +
    'does not know it was written');
});
