import assert from "node:assert/strict";
import { test } from "node:test";
import { alertTitle, diffPrAlerts } from "../lib/notify.js";

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

test("the first snapshot records state and emits nothing", () => {
  const baseline = diffPrAlerts(null, [pull]);
  assert.deepEqual(baseline.events, []);
  assert.equal(baseline.next[pull.id].commentCount, 2);
});

test("a later snapshot reports new comments, approval, and a new CI failure", () => {
  const prior = diffPrAlerts(null, [pull]).next;
  const changed = { ...pull, commentCount: 4, approved: true, ciFailed: true };
  const diff = diffPrAlerts(prior, [changed]);
  assert.deepEqual(diff.events.map((event) => event.type), ["comments", "approved", "ci"]);
  assert.equal(diff.events[0].delta, 2);
  assert.deepEqual(diffPrAlerts(diff.next, [changed]).events, []);
});

test("an unknown CI result keeps the previous failure and does not notify", () => {
  const prior = diffPrAlerts(null, [{ ...pull, ciFailed: true }]).next;
  const unknownCi = diffPrAlerts(prior, [{ ...pull, ciKnown: false, ciFailed: false }]);
  assert.equal(unknownCi.next[pull.id].ciFailed, true);
  assert.deepEqual(unknownCi.events, []);
});

test("a pull that was not in the baseline does not notify", () => {
  const prior = diffPrAlerts(null, [pull]).next;
  const fresh = diffPrAlerts(prior, [{ ...pull, id: "acme/app#8", commentCount: 9, ciFailed: true }]);
  assert.deepEqual(fresh.events, []);
  assert.equal(fresh.next["acme/app#8"].commentCount, 9);
});

test("fewer comments, a repeated approval, and a repeated CI failure stay quiet", () => {
  const prior = diffPrAlerts(null, [{ ...pull, commentCount: 4, approved: true, ciFailed: true }]).next;
  const quiet = diffPrAlerts(prior, [{ ...pull, commentCount: 3, approved: true, ciFailed: true }]);
  assert.deepEqual(quiet.events, []);
  assert.equal(quiet.next[pull.id].commentCount, 3);
});

test("rows without an id are ignored", () => {
  const diff = diffPrAlerts({}, [{ commentCount: 3 }, null]);
  assert.deepEqual(diff.events, []);
  assert.deepEqual(diff.next, {});
});

test("alert titles match the event type", () => {
  assert.equal(alertTitle({ type: "comments", delta: 1 }), "New comment");
  assert.equal(alertTitle({ type: "comments", delta: 3 }), "3 new comments");
  assert.equal(alertTitle({ type: "approved" }), "Pull request approved");
  assert.equal(alertTitle({ type: "ci" }), "CI failed");
});
