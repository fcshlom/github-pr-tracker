import assert from "node:assert/strict";
import { diffPrAlerts } from "./notify.js";
import { summarizeChecks, summarizeThreads } from "./github.js";
import { shouldAutopilotUpdate } from "./autopilot.js";

const pull = {
  id: "acme/app#7",
  number: 7,
  title: "Fix login",
  repo: "acme/app",
  htmlUrl: "https://github.com/acme/app/pull/7",
  commentCount: 2,
  approved: false,
  ciKnown: true,
  ciFailed: false,
};

const baseline = diffPrAlerts(null, [pull]);
assert.deepEqual(baseline.events, []);
assert.equal(baseline.next[pull.id].commentCount, 2);

const prior = baseline.next;
const changed = {
  ...pull,
  commentCount: 4,
  approved: true,
  ciFailed: true,
};
const diff = diffPrAlerts(prior, [changed]);
assert.deepEqual(
  diff.events.map((event) => event.type),
  ["comments", "approved", "ci"]
);
assert.equal(diff.events[0].delta, 2);

const again = diffPrAlerts(diff.next, [changed]);
assert.deepEqual(again.events, []);

const unknownCi = diffPrAlerts(diff.next, [{ ...changed, ciKnown: false, ciFailed: false }]);
assert.equal(unknownCi.next[pull.id].ciFailed, true);
assert.deepEqual(unknownCi.events, []);

const fresh = diffPrAlerts(prior, [{ ...pull, id: "acme/app#8", commentCount: 9, ciFailed: true }]);
assert.deepEqual(fresh.events, []);

const checks = summarizeChecks({
  statusChecks: [
    { displayName: "build", state: "SUCCESS" },
    { displayName: "test", state: "FAILURE" },
    { displayName: "lint", state: "CANCELLED" },
  ],
  statusRollupSummary: [{ state: "FAILURE", count: 1 }, { state: "SUCCESS", count: 1 }],
  state: "OPEN",
});
assert.equal(checks.ciKnown, true);
assert.equal(checks.ciFailed, true);
assert.equal(checks.ciRunning, false);
assert.equal(checks.ciDone, 3);
assert.equal(checks.ciTotal, 3);

const running = summarizeChecks({
  statusChecks: [
    { displayName: "lint", state: "SUCCESS" },
    { displayName: "unit", state: "SUCCESS" },
    { displayName: "build", state: "IN_PROGRESS" },
    { displayName: "e2e", state: "QUEUED" },
  ],
  statusRollupSummary: [{ state: "SUCCESS", count: 9 }],
});
assert.deepEqual(
  {
    ciKnown: running.ciKnown,
    ciFailed: running.ciFailed,
    ciRunning: running.ciRunning,
    ciDone: running.ciDone,
    ciTotal: running.ciTotal,
  },
  { ciKnown: true, ciFailed: false, ciRunning: true, ciDone: 2, ciTotal: 4 }
);

const rollupOnly = summarizeChecks({
  statusRollupSummary: [
    { state: "SUCCESS", count: 3 },
    { state: "IN_PROGRESS", count: 1 },
  ],
});
assert.equal(rollupOnly.ciDone, 3);
assert.equal(rollupOnly.ciTotal, 4);
assert.equal(rollupOnly.ciRunning, true);

const passing = summarizeChecks({
  statusChecks: [{ displayName: "build", state: "COMPLETED" }],
});
assert.deepEqual(passing, {
  ciKnown: true,
  ciFailed: false,
  ciRunning: false,
  ciDone: 1,
  ciTotal: 1,
});

const empty = summarizeChecks({ state: "OPEN", statusChecks: [] });
assert.deepEqual(empty, {
  ciKnown: false,
  ciFailed: false,
  ciRunning: false,
  ciDone: 0,
  ciTotal: 0,
});

const threads = summarizeThreads({
  threads: [
    { id: "1", isResolved: false },
    { id: "2", isResolved: true },
    { id: "3", isResolved: false },
  ],
});
assert.deepEqual(threads, { unresolvedKnown: true, unresolvedCount: 2 });
assert.deepEqual(summarizeThreads({ threads: [] }), { unresolvedKnown: true, unresolvedCount: 0 });
assert.equal(summarizeThreads({}).unresolvedKnown, false);

const ready = {
  approved: true,
  autoMerge: true,
  needsUpdate: true,
  headSha: "abc",
  hasConflicts: false,
};
assert.equal(shouldAutopilotUpdate(ready, { enabled: true, now: 10_000, lastAttemptAt: 0 }), true);
assert.equal(shouldAutopilotUpdate(ready, { enabled: false, now: 10_000, lastAttemptAt: 0 }), false);
assert.equal(shouldAutopilotUpdate({ ...ready, approved: false }, { enabled: true, now: 10_000, lastAttemptAt: 0 }), false);
assert.equal(shouldAutopilotUpdate({ ...ready, autoMerge: false }, { enabled: true, now: 10_000, lastAttemptAt: 0 }), false);
assert.equal(shouldAutopilotUpdate({ ...ready, hasConflicts: true }, { enabled: true, now: 10_000, lastAttemptAt: 0 }), false);
assert.equal(shouldAutopilotUpdate(ready, { enabled: true, now: 10_000, lastAttemptAt: 9_000 }), false);
assert.equal(shouldAutopilotUpdate(ready, { enabled: true, now: 140_000, lastAttemptAt: 9_000 }), true);

console.log("alerts ok");
