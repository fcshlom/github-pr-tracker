import assert from "node:assert/strict";
import { test } from "node:test";
import { isReadyToMerge, shouldAutopilotMerge, shouldAutopilotUpdate } from "../lib/autopilot.js";

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

const mergeable = {
  approved: true,
  needsUpdate: false,
  draft: false,
  hasConflicts: false,
  canMerge: true,
};

test("merges an approved pull that is not behind and can merge", () => {
  const now = 140_000;
  const options = { enabled: true, now, lastAttemptAt: 0 };
  assert.equal(isReadyToMerge(mergeable), true);
  assert.equal(isReadyToMerge({ ...mergeable, approved: false }), false);
  assert.equal(shouldAutopilotMerge(mergeable, options), true);
  assert.equal(shouldAutopilotMerge(mergeable, { ...options, enabled: false }), false);
  assert.equal(shouldAutopilotMerge({ ...mergeable, approved: false }, options), false);
  assert.equal(shouldAutopilotMerge({ ...mergeable, needsUpdate: true }, options), false);
  assert.equal(shouldAutopilotMerge({ ...mergeable, draft: true }, options), false);
  assert.equal(shouldAutopilotMerge({ ...mergeable, hasConflicts: true }, options), false);
  assert.equal(shouldAutopilotMerge({ ...mergeable, canMerge: false }, options), false);
  assert.equal(shouldAutopilotMerge(mergeable, { enabled: true, now: 10_000, lastAttemptAt: 9_000 }), false);
});
