import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  fetchPrDashboard,
  parsePullsPage,
  performPrAction,
  summarizeChecks,
  summarizeMergeBox,
  summarizeThreads,
} from "../lib/github.js";

const originalFetch = globalThis.fetch;
const SHA = "a".repeat(40);
const META = `<meta name="fetch-nonce" content="n"><meta name="release" content="r">`;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ href, method, body });
    const result = handler({ href, method, body }) || { status: 500, json: { message: "unhandled" } };
    const status = result.status ?? 200;
    return {
      url: result.url || href,
      status,
      ok: status >= 200 && status < 300,
      text: async () => result.html ?? "",
      json: async () => result.json ?? {},
    };
  };
  return calls;
}

function embedded(pulls, totalPages = 1) {
  const json = JSON.stringify({ results: pulls, totalPages });
  return `${META}<script type="application/json" data-target="react-app.embeddedData">${json}</script>`;
}

function pullNode(partial) {
  return {
    permalink: `https://github.com/${partial.repo}/pull/${partial.number}`,
    number: partial.number,
    repoNameWithOwner: partial.repo,
    title: partial.title,
    updatedAt: partial.updatedAt,
    createdAt: partial.createdAt || partial.updatedAt,
    mergedAt: partial.mergedAt ?? null,
    commentCount: partial.commentCount ?? 0,
    displayState: partial.displayState || "OPEN",
    isDraft: Boolean(partial.isDraft),
    author: { displayLogin: "ada" },
    headSha: partial.headSha || "",
    category: partial.category || "",
    statusCheckRollup: partial.checkState ? { state: partial.checkState } : null,
  };
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

test("parsePullsPage reads embedded pulls and drops duplicates", () => {
  const parsed = parsePullsPage(embedded([
    pullNode({ repo: "acme/web", number: 4, title: "One", updatedAt: hoursAgo(1) }),
    pullNode({ repo: "acme/web", number: 4, title: "One", updatedAt: hoursAgo(1), commentCount: 3, displayState: "DRAFT", headSha: SHA, category: "CI_FAILING", checkState: "failure" }),
    pullNode({ repo: "acme/web", number: 5, title: "Two", updatedAt: hoursAgo(2), isDraft: true }),
  ], 3));
  assert.equal(parsed.totalPages, 3);
  assert.equal(parsed.pulls.length, 2);
  assert.equal(parsed.pulls[0].draft, true);
  assert.equal(parsed.pulls[0].commentCount, 3);
  assert.equal(parsed.pulls[0].headSha, SHA);
  assert.equal(parsed.pulls[0].listCategory, "CI_FAILING");
  assert.equal(parsed.pulls[0].checkState, "FAILURE");
  assert.equal(parsed.pulls[1].draft, true);
});

test("parsePullsPage explains a signed-out or SSO page", () => {
  assert.throws(() => parsePullsPage("<title>Sign in to GitHub</title>"), /Sign in to GitHub/);
  assert.throws(() => parsePullsPage("Please authorize your organization via single sign-on"), /SSO/);
  assert.throws(() => parsePullsPage("<html></html>"), /Could not read pull requests/);
});

test("status checks prefer individual steps and ignore a cancelled step as failure", () => {
  const checks = summarizeChecks({
    statusChecks: [
      { displayName: "build", state: "SUCCESS" },
      { displayName: "test", state: "FAILURE" },
      { displayName: "lint", state: "CANCELLED" },
    ],
    statusRollupSummary: [{ state: "FAILURE", count: 9 }],
    state: "OPEN",
  });
  assert.deepEqual(checks, {
    ciKnown: true,
    ciFailed: true,
    ciRunning: false,
    ciDone: 3,
    ciTotal: 3,
  });

  const running = summarizeChecks({
    statusChecks: [
      { displayName: "lint", state: "success" },
      { displayName: "unit", state: "SUCCESS" },
      { displayName: "build", state: "IN_PROGRESS" },
      { displayName: "e2e", state: "QUEUED" },
    ],
    statusRollupSummary: [{ state: "SUCCESS", count: 9 }],
  });
  assert.deepEqual(running, {
    ciKnown: true,
    ciFailed: false,
    ciRunning: true,
    ciDone: 2,
    ciTotal: 4,
  });

  assert.equal(summarizeChecks({
    statusRollupSummary: [
      { state: "SUCCESS", count: 3 },
      { state: "IN_PROGRESS", count: 1 },
      { state: "FAILURE", count: 0 },
    ],
  }).ciTotal, 4);
  assert.equal(summarizeChecks({ statusChecks: [{ displayName: "build", state: "SKIPPED" }] }).ciFailed, false);
  assert.equal(summarizeChecks({ statusChecks: [{ displayName: "boot", state: "STARTUP_FAILURE" }] }).ciFailed, true);
  assert.equal(summarizeChecks({ statusChecks: [{ displayName: "hold", state: "ACTION_REQUIRED" }] }).ciRunning, true);
  assert.deepEqual(summarizeChecks({ state: "OPEN", statusChecks: [] }), {
    ciKnown: false,
    ciFailed: false,
    ciRunning: false,
    ciDone: 0,
    ciTotal: 0,
  });
});

test("unresolved threads keep the first visible comment and drop resolved ones", () => {
  const threads = summarizeThreads({
    threads: [
      { id: "1", isResolved: false },
      { id: "2", isResolved: true, commentsData: { comments: [{ body: "resolved", author: { login: "ada" } }] } },
      {
        id: "3",
        isResolved: false,
        commentsData: {
          comments: [
            { isHidden: true, body: "hidden", author: { login: "bot" } },
            {
              isHidden: false,
              author: { login: "ada" },
              body: ` please \n${"rename ".repeat(40)}this `,
              url: "https://github.com/acme/app/pull/3#discussion_r1",
            },
          ],
        },
      },
    ],
  });
  assert.equal(threads.unresolvedCount, 2);
  assert.equal(threads.unresolvedComments[0].text, "Unresolved thread");
  assert.equal(threads.unresolvedComments[1].author, "ada");
  assert.equal(threads.unresolvedComments[1].text.startsWith("please rename"), true);
  assert.equal(threads.unresolvedComments[1].text.endsWith("..."), true);
  assert.equal(threads.unresolvedComments[1].text.length, 180);
  assert.deepEqual(summarizeThreads({ threads: [] }), {
    unresolvedKnown: true,
    unresolvedCount: 0,
    unresolvedComments: [],
  });
  assert.equal(summarizeThreads({}).unresolvedKnown, false);
});

test("merge box reports behind, conflicts, auto-merge, and the allowed update method", () => {
  const behind = summarizeMergeBox({
    other: { mergeStateStatus: "CLEAN" },
    chosen: {
      mergeStateStatus: "BEHIND",
      autoMergeRequest: { enabled: true, mergeMethod: "REBASE" },
      headRefOid: SHA,
      viewerUpdateMethods: [{ name: "REBASE" }, "MERGE"],
      viewerCanDisableAutoMerge: false,
    },
  });
  assert.equal(behind.needsUpdate, true);
  assert.equal(behind.hasConflicts, false);
  assert.equal(behind.autoMerge, true);
  assert.equal(behind.headSha, SHA);
  assert.equal(behind.updateMethod, "MERGE");
  assert.equal(behind.mergeMethod, "REBASE");
  assert.equal(behind.canDisableAutoMerge, false);

  const dirty = summarizeMergeBox({
    mergeStateStatus: "DIRTY",
    autoMergeRequest: { enabled: false, mergeMethod: "FAST" },
    headRefOid: "short",
    headSha: "fallback",
  });
  assert.equal(dirty.hasConflicts, true);
  assert.equal(dirty.autoMerge, false);
  assert.equal(dirty.headSha, "fallback");
  assert.equal(dirty.mergeMethod, "SQUASH");
  assert.equal(summarizeMergeBox({ mergeStateStatus: "UNMERGEABLE" }).hasConflicts, true);
  assert.equal(summarizeMergeBox({ headRefOid: SHA }).mergeKnown, false);
  assert.equal(summarizeMergeBox({}), null);
});

test("fetchPrDashboard classifies review, CI, merge state, threads, and the 48 hour window", async () => {
  const recent = hoursAgo(1);
  const older = hoursAgo(3);
  installFetch(({ href }) => {
    const url = new URL(href);
    if (url.pathname.endsWith("/pulls")) {
      const query = url.searchParams.get("q") || "";
      if (query.includes("review:approved")) {
        return { html: embedded([pullNode({ repo: "acme/web", number: 4, title: "Approved", updatedAt: recent })]) };
      }
      if (query.includes("review:changes-requested")) {
        return { html: embedded([pullNode({ repo: "acme/web", number: 5, title: "Changes", updatedAt: older })]) };
      }
      if (query.includes("is:merged")) {
        return {
          html: embedded([
            pullNode({ repo: "acme/web", number: 9, title: "Merged", updatedAt: hoursAgo(5), mergedAt: hoursAgo(5) }),
            pullNode({ repo: "acme/web", number: 8, title: "Old", updatedAt: hoursAgo(72), mergedAt: hoursAgo(72) }),
          ]),
        };
      }
      return {
        html: embedded([
          pullNode({ repo: "acme/web", number: 4, title: "Approved", updatedAt: recent, commentCount: 2, category: "CI_FAILING", headSha: SHA }),
          pullNode({ repo: "acme/web", number: 4, title: "Approved", updatedAt: recent, commentCount: 2, category: "CI_FAILING", headSha: SHA }),
          pullNode({ repo: "acme/web", number: 5, title: "Changes", updatedAt: older, category: "CI_RUNNING" }),
        ]),
      };
    }
    if (href.includes("/page_data/merge_box")) {
      if (href.includes("/pull/4/")) {
        return {
          json: {
            mergeStateStatus: "BEHIND",
            autoMergeRequest: { enabled: true, mergeMethod: "SQUASH" },
            headRefOid: SHA,
            viewerUpdateMethods: ["MERGE"],
          },
        };
      }
      return { json: { mergeStateStatus: "DIRTY", autoMergeRequest: null, headRefOid: "b".repeat(40) } };
    }
    if (href.includes("/page_data/status_checks")) {
      if (href.includes("/pull/4/")) {
        return { json: { statusChecks: [{ displayName: "build", state: "SUCCESS" }] } };
      }
      return {
        json: {
          statusChecks: [
            { displayName: "lint", state: "SUCCESS" },
            { displayName: "unit", state: "IN_PROGRESS" },
          ],
        },
      };
    }
    if (href.includes("/page_data/threads")) {
      if (href.includes("/pull/4/")) {
        return {
          json: {
            threads: [{
              isResolved: false,
              commentsData: {
                comments: [
                  { isHidden: true, body: "hidden", author: { login: "bot" } },
                  { body: "please rename this", author: { login: "ada" }, url: "https://github.com/acme/web/pull/4#discussion_r1" },
                ],
              },
            }],
          },
        };
      }
      return { json: { threads: [] } };
    }
    return { html: META };
  });

  const dashboard = await fetchPrDashboard({ username: "ada", repos: ["acme/web"] });
  const approved = dashboard.open[0];
  const changes = dashboard.open[1];
  assert.equal(dashboard.open.length, 2);
  assert.equal(approved.number, 4);
  assert.equal(approved.category, "approved");
  assert.equal(approved.ciFailed, false);
  assert.equal(approved.needsUpdate, true);
  assert.equal(approved.autoMerge, true);
  assert.equal(approved.headSha, SHA);
  assert.equal(approved.hasComments, true);
  assert.equal(approved.unresolvedComments[0].author, "ada");
  assert.equal(approved.unresolvedComments[0].text, "please rename this");
  assert.equal(changes.category, "awaiting");
  assert.equal(changes.changesRequested, true);
  assert.equal(changes.approved, false);
  assert.equal(changes.hasConflicts, true);
  assert.equal(changes.ciRunning, true);
  assert.equal(changes.ciDone, 1);
  assert.equal(changes.ciTotal, 2);
  assert.equal(changes.unresolvedCount, 0);
  assert.deepEqual(dashboard.merged.map((pull) => pull.number), [9]);
});

test("a missing detail response keeps the list CI and branch signals", async () => {
  installFetch(({ href }) => {
    if (new URL(href).pathname.endsWith("/pulls")) {
      const query = new URL(href).searchParams.get("q") || "";
      if (query.includes("is:open") && !query.includes("review:")) {
        return {
          html: embedded([pullNode({
            repo: "acme/web",
            number: 3,
            title: "Behind",
            updatedAt: hoursAgo(1),
            category: "MERGE_CONFLICTS",
            checkState: "pending",
          })]),
        };
      }
      return { html: embedded([]) };
    }
    if (href.includes("/page_data/status_checks")) {
      return { status: 500, json: { message: "boom" } };
    }
    if (href.includes("/page_data/")) {
      return { status: 404, json: {} };
    }
    return { html: META };
  });

  const [pull] = (await fetchPrDashboard({ username: "ada", repos: ["acme/web"] })).open;
  assert.equal(pull.hasConflicts, true);
  assert.equal(pull.mergeKnown, false);
  assert.equal(pull.ciRunning, true);
  assert.equal(pull.ciKnown, true);
  assert.equal(pull.unresolvedKnown, false);
});

test("merged pages stop once every row is older than 48 hours", async () => {
  const calls = installFetch(({ href }) => {
    const url = new URL(href);
    if (!url.pathname.endsWith("/pulls")) {
      return href.includes("/page_data/") ? { status: 404, json: {} } : { html: META };
    }
    const query = url.searchParams.get("q") || "";
    const page = url.searchParams.get("page");
    if (query.includes("is:merged")) {
      const old = hoursAgo(80);
      return { html: embedded([pullNode({ repo: "acme/web", number: 8, title: "Old", updatedAt: old, mergedAt: old })], 3) };
    }
    if (query.includes("is:open") && !query.includes("review:")) {
      return {
        html: embedded(
          [pullNode({ repo: "acme/web", number: Number(page), title: `Page ${page}`, updatedAt: hoursAgo(Number(page)) })],
          2
        ),
      };
    }
    return { html: embedded([]) };
  });

  const dashboard = await fetchPrDashboard({ username: "ada", repos: ["acme/web"] });
  assert.deepEqual(dashboard.open.map((pull) => pull.number), [1, 2]);
  const mergedPages = calls
    .map((call) => new URL(call.href))
    .filter((url) => (url.searchParams.get("q") || "").includes("is:merged"))
    .map((url) => url.searchParams.get("page"));
  assert.deepEqual(mergedPages, ["1"]);
});

test("every configured repository is included", async () => {
  installFetch(({ href }) => {
    const url = new URL(href);
    if (!url.pathname.endsWith("/pulls")) {
      return href.includes("/page_data/") ? { status: 404, json: {} } : { html: META };
    }
    const [, owner, name] = url.pathname.split("/");
    const query = url.searchParams.get("q") || "";
    if (query.includes("is:open") && !query.includes("review:")) {
      return {
        html: embedded([pullNode({
          repo: `${owner}/${name}`,
          number: 1,
          title: name,
          updatedAt: hoursAgo(1),
        })]),
      };
    }
    return { html: embedded([]) };
  });

  const dashboard = await fetchPrDashboard({ username: "ada", repos: ["acme/web", "acme/api"] });
  assert.deepEqual(dashboard.open.map((pull) => pull.repo).sort(), ["acme/api", "acme/web"]);
});

test("settings and github errors fail before inventing pulls", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("no");
  };
  await assert.rejects(() => fetchPrDashboard({ username: "", repos: ["acme/web"] }), /username/);
  await assert.rejects(() => fetchPrDashboard({ username: "ada", repos: [] }), /repository/);
  assert.equal(calls, 0);

  installFetch(() => ({ status: 429, html: "" }));
  await assert.rejects(() => fetchPrDashboard({ username: "ada", repos: ["acme/web"] }), /rate limited/);
  installFetch(() => ({ status: 404, html: "" }));
  await assert.rejects(() => fetchPrDashboard({ username: "ada", repos: ["acme/web"] }), /not found/);
  installFetch(() => ({ status: 500, html: "" }));
  await assert.rejects(() => fetchPrDashboard({ username: "ada", repos: ["acme/web"] }), /GitHub returned 500/);
  installFetch(() => ({ url: "https://github.com/login", status: 200, html: "" }));
  await assert.rejects(() => fetchPrDashboard({ username: "ada", repos: ["acme/web"] }), /Sign in/);
  installFetch(() => ({ html: "single sign-on required" }));
  await assert.rejects(() => fetchPrDashboard({ username: "ada", repos: ["acme/web"] }), /SSO/);
});

test("update-branch posts the live head and surfaces an orchestration error", async () => {
  const calls = installFetch(({ href, method }) => {
    if (href.includes("/page_data/update_pull_request_branch") && method === "POST") {
      return { json: { orchestration: { url: "https://github.com/acme/web/pull/4/page_data/job" } } };
    }
    if (href.endsWith("/page_data/job")) {
      return { json: { orchestration: { error_message: "still behind" } } };
    }
    if (href.includes("/page_data/merge_box")) {
      return {
        json: {
          mergeStateStatus: "BEHIND",
          headRefOid: SHA,
          viewerUpdateMethods: [{ name: "REBASE" }],
          autoMergeRequest: { enabled: true, mergeMethod: "SQUASH" },
        },
      };
    }
    return { html: META };
  });

  await assert.rejects(
    () => performPrAction({ action: "update-branch", repo: "acme/web", number: 4, headSha: "stale", updateMethod: "MERGE" }),
    /still behind/
  );
  const post = calls.find((call) => call.method === "POST");
  assert.equal(post.body.updateMethod, "REBASE");
  assert.equal(post.body.expectedHeadOid, SHA);
});

test("update-branch refuses to run without a commit sha", async () => {
  installFetch(() => ({ json: {} }));
  await assert.rejects(
    () => performPrAction({ action: "update-branch", repo: "acme/web", number: 4 }),
    /Missing the current branch commit/
  );
});

test("auto-merge toggle follows the live merge box, not the stale flag", async () => {
  const disableCalls = installFetch(({ href }) => {
    if (href.includes("/page_data/disable_auto_merge")) {
      return { json: {} };
    }
    if (href.includes("/page_data/merge_box")) {
      return { json: { mergeStateStatus: "CLEAN", autoMergeRequest: { enabled: true, mergeMethod: "MERGE" }, headRefOid: SHA } };
    }
    return { html: META };
  });
  const disabled = await performPrAction({ action: "toggle-auto-merge", repo: "acme/web", number: 4, autoMerge: false });
  assert.equal(disableCalls.some((call) => call.href.includes("disable_auto_merge") && call.body === null), true);
  assert.equal(disabled.autoMerge, true);

  const enableCalls = installFetch(({ href }) => {
    if (href.includes("/page_data/enable_auto_merge")) {
      return { json: {} };
    }
    if (href.includes("/page_data/merge_box")) {
      return { json: { mergeStateStatus: "CLEAN", autoMergeRequest: null, headRefOid: SHA, defaultMergeMethod: "SQUASH" } };
    }
    return { html: META };
  });
  await performPrAction({ action: "toggle-auto-merge", repo: "acme/web", number: 4, autoMerge: true });
  const enable = enableCalls.find((call) => call.href.includes("enable_auto_merge"));
  assert.deepEqual(enable.body, { mergeMethod: "SQUASH" });
});

test("a rejected github write returns the github error", async () => {
  installFetch(({ href }) => {
    if (href.includes("/page_data/disable_auto_merge")) {
      return { status: 422, json: { message: "not allowed" } };
    }
    if (href.includes("/page_data/merge_box")) {
      return { json: { mergeStateStatus: "CLEAN", autoMergeRequest: { enabled: true, mergeMethod: "SQUASH" }, headRefOid: SHA } };
    }
    return { html: META };
  });
  await assert.rejects(
    () => performPrAction({ action: "toggle-auto-merge", repo: "acme/web", number: 4 }),
    /not allowed/
  );
});

test("unknown actions do not call github", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("no");
  };
  await assert.rejects(
    () => performPrAction({ action: "merge", repo: "acme/web", number: 4 }),
    /Unknown pull request action/
  );
  assert.equal(calls, 0);
});
