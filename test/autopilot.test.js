import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldAutopilotUpdate } from "../lib/autopilot.js";

const ready = {
  approved: true,
  autoMerge: true,
  needsUpdate: true,
  headSha: "abc",
  hasConflicts: false,
};

test("updates only an approved, auto-merge, behind pull outside the cooldown", () => {
  const now = 140_000;
  assert.equal(shouldAutopilotUpdate(ready, { enabled: true, now, lastAttemptAt: 0 }), true);
  assert.equal(shouldAutopilotUpdate(ready, { enabled: false, now, lastAttemptAt: 0 }), false);
  assert.equal(shouldAutopilotUpdate(null, { enabled: true, now, lastAttemptAt: 0 }), false);
  assert.equal(shouldAutopilotUpdate({ ...ready, approved: false }, { enabled: true, now, lastAttemptAt: 0 }), false);
  assert.equal(shouldAutopilotUpdate({ ...ready, autoMerge: false }, { enabled: true, now, lastAttemptAt: 0 }), false);
  assert.equal(shouldAutopilotUpdate({ ...ready, needsUpdate: false }, { enabled: true, now, lastAttemptAt: 0 }), false);
  assert.equal(shouldAutopilotUpdate({ ...ready, headSha: "" }, { enabled: true, now, lastAttemptAt: 0 }), false);
  assert.equal(shouldAutopilotUpdate({ ...ready, hasConflicts: true }, { enabled: true, now, lastAttemptAt: 0 }), false);
});

test("the cooldown lasts two minutes and allows the next attempt on the boundary", () => {
  assert.equal(shouldAutopilotUpdate(ready, { enabled: true, now: 10_000, lastAttemptAt: 9_000 }), false);
  assert.equal(shouldAutopilotUpdate(ready, { enabled: true, now: 129_000, lastAttemptAt: 9_000 }), true);
});
