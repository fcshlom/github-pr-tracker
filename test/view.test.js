import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeAttr, escapeHtml, filterOpen, githubCommentUrl } from "../lib/view.js";

const open = [
  { id: "1", category: "approved", hasComments: true, needsUpdate: false },
  { id: "2", category: "awaiting", hasComments: false, needsUpdate: true },
  { id: "3", category: "awaiting", hasComments: true, needsUpdate: false },
];

test("open filters keep the matching pulls", () => {
  assert.deepEqual(filterOpen(open, "all").map((item) => item.id), ["1", "2", "3"]);
  assert.deepEqual(filterOpen(open, "approved").map((item) => item.id), ["1"]);
  assert.deepEqual(filterOpen(open, "awaiting").map((item) => item.id), ["2", "3"]);
  assert.deepEqual(filterOpen(open, "comments").map((item) => item.id), ["1", "3"]);
  assert.deepEqual(filterOpen(open, "behind").map((item) => item.id), ["2"]);
  assert.deepEqual(filterOpen(open, "nope").map((item) => item.id), ["1", "2", "3"]);
});

test("comment links stay on https github.com", () => {
  assert.equal(
    githubCommentUrl("https://github.com/acme/web/pull/4#discussion_r1"),
    "https://github.com/acme/web/pull/4#discussion_r1"
  );
  assert.equal(githubCommentUrl("http://github.com/acme/web/pull/4"), "");
  assert.equal(githubCommentUrl("https://example.com/acme/web/pull/4"), "");
  assert.equal(githubCommentUrl("javascript:alert(1)"), "");
  assert.equal(githubCommentUrl("not a url"), "");
});

test("card text escapes markup", () => {
  assert.equal(escapeHtml(`<b a="&">`), "&lt;b a=&quot;&amp;&quot;&gt;");
  assert.equal(escapeAttr("a'b"), "a&#39;b");
});
