const MERGED_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_PAGES = 5;
const CI_FAILURE_STATES = new Set(["ERROR", "FAILURE", "TIMED_OUT", "STARTUP_FAILURE"]);
const CI_RUNNING_STATES = new Set([
  "ACTION_REQUIRED",
  "EXPECTED",
  "PENDING",
  "QUEUED",
  "REQUESTED",
  "WAITING",
  "IN_PROGRESS",
]);
const CI_CHECK_STATES = new Set([
  "CANCELLED",
  "ERROR",
  "FAILURE",
  "STALE",
  "STARTUP_FAILURE",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "EXPECTED",
  "PENDING",
  "QUEUED",
  "REQUESTED",
  "WAITING",
  "IN_PROGRESS",
  "SKIPPED",
  "NEUTRAL",
  "SUCCESS",
  "COMPLETED",
]);

export async function fetchPrDashboard({ username, repos }) {
  if (!username) {
    throw new Error("Missing GitHub username in settings.");
  }
  if (!repos.length) {
    throw new Error("Add at least one repository in settings (owner/repo).");
  }

  const sinceMs = Date.now() - MERGED_WINDOW_MS;
  const sinceDate = new Date(sinceMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const repoResults = await mapWithConcurrency(repos, 3, async (repo) => {
    const [openPulls, approvedPulls, changesPulls, mergedPulls] = await Promise.all([
      fetchRepoPulls(repo, `is:open is:pr author:${username}`),
      fetchRepoPulls(repo, `is:open is:pr author:${username} review:approved`),
      fetchRepoPulls(repo, `is:open is:pr author:${username} review:changes-requested`),
      fetchRepoPulls(repo, `is:pr is:merged author:${username} merged:>=${sinceDate}`, sinceMs),
    ]);
    return { repo, openPulls, approvedPulls, changesPulls, mergedPulls };
  });

  const open = [];
  const merged = [];
  for (const result of repoResults) {
    const approvedKeys = new Set(result.approvedPulls.map(pullKey));
    const changesKeys = new Set(result.changesPulls.map(pullKey));
    for (const pull of dedupePulls(result.openPulls)) {
      const key = pullKey(pull);
      const changesRequested = changesKeys.has(key);
      const approved = approvedKeys.has(key) && !changesRequested;
      open.push({
        id: key,
        number: pull.number,
        title: pull.title,
        htmlUrl: pull.htmlUrl,
        repo: pull.repo,
        draft: pull.draft,
        updatedAt: pull.updatedAt,
        createdAt: pull.createdAt,
        category: approved ? "approved" : "awaiting",
        hasComments: pull.commentCount > 0,
        commentCount: pull.commentCount,
        approved,
        changesRequested,
        pendingReviewers: 0,
        needsUpdate: pull.listCategory === "OUTDATED_BRANCH",
        hasConflicts: pull.listCategory === "MERGE_CONFLICTS",
        autoMerge: false,
        mergeKnown: false,
        headSha: pull.headSha || "",
        updateMethod: "MERGE",
        mergeMethod: "SQUASH",
        ciFailed: pull.listCategory === "CI_FAILING" || CI_FAILURE_STATES.has(pull.checkState),
        ciKnown:
          pull.listCategory === "CI_FAILING" ||
          pull.listCategory === "CI_RUNNING" ||
          CI_CHECK_STATES.has(pull.checkState),
        ciRunning: pull.listCategory === "CI_RUNNING" || CI_RUNNING_STATES.has(pull.checkState),
        ciDone: 0,
        ciTotal: 0,
        unresolvedCount: 0,
        unresolvedKnown: false,
      });
    }
    for (const pull of dedupePulls(result.mergedPulls)) {
      const mergedAtMs = Date.parse(pull.mergedAt || pull.updatedAt);
      if (!Number.isFinite(mergedAtMs) || mergedAtMs < sinceMs) {
        continue;
      }
      merged.push({
        id: pullKey(pull),
        number: pull.number,
        title: pull.title,
        htmlUrl: pull.htmlUrl,
        repo: pull.repo,
        updatedAt: pull.mergedAt || pull.updatedAt,
        createdAt: pull.createdAt,
        category: "merged",
        hasComments: pull.commentCount > 0,
        commentCount: pull.commentCount,
      });
    }
  }

  await mapWithConcurrency(open, 4, async (item) => {
    const [mergeBox, checks, threads] = await Promise.all([
      readMergeBox(item.repo, item.number).catch(() => null),
      readStatusChecks(item.repo, item.number).catch(() => null),
      readThreads(item.repo, item.number).catch(() => null),
    ]);
    if (mergeBox) {
      item.needsUpdate = mergeBox.needsUpdate;
      item.hasConflicts = mergeBox.hasConflicts;
      item.autoMerge = mergeBox.autoMerge;
      item.mergeKnown = mergeBox.mergeKnown;
      item.headSha = mergeBox.headSha || item.headSha;
      item.updateMethod = mergeBox.updateMethod;
      item.mergeMethod = mergeBox.mergeMethod;
      item.canEnableAutoMerge = mergeBox.canEnableAutoMerge;
      item.canDisableAutoMerge = mergeBox.canDisableAutoMerge;
    }
    if (checks?.ciKnown) {
      item.ciFailed = checks.ciFailed;
      item.ciKnown = true;
      item.ciRunning = checks.ciRunning;
      item.ciDone = checks.ciDone;
      item.ciTotal = checks.ciTotal;
    }
    if (threads?.unresolvedKnown) {
      item.unresolvedCount = threads.unresolvedCount;
      item.unresolvedKnown = true;
    }
  });

  open.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  merged.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  return {
    open,
    merged,
    fetchedAt: Date.now(),
  };
}

async function fetchRepoPulls(repo, query, stopBeforeMs) {
  const [owner, name] = repo.split("/");
  const pulls = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const url = new URL(`https://github.com/${owner}/${name}/pulls`);
    url.searchParams.set("q", query);
    url.searchParams.set("page", String(page));
    const html = await githubHtml(url.toString());
    const parsed = parsePullsPage(html);
    pulls.push(...parsed.pulls);
    totalPages = parsed.totalPages;

    if (stopBeforeMs && parsed.pulls.length) {
      const pageIsOlder = parsed.pulls.every((pull) => {
        const timestamp = Date.parse(pull.mergedAt || pull.updatedAt);
        return Number.isFinite(timestamp) && timestamp < stopBeforeMs;
      });
      if (pageIsOlder) {
        break;
      }
    }
    page += 1;
  }

  return pulls;
}

export function parsePullsPage(html) {
  const blocks = [
    ...String(html).matchAll(
      /<script type="application\/json" data-target="react-app\.embeddedData">\s*([\s\S]*?)\s*<\/script>/g
    ),
  ];
  if (!blocks.length) {
    if (/single sign-on|authorize your organization/i.test(html)) {
      throw new Error("GitHub is asking for SSO. Open the repo in this browser, authorize it, then refresh.");
    }
    if (/sign in to github/i.test(html)) {
      throw new Error("Sign in to GitHub in this browser, then refresh.");
    }
    throw new Error("Could not read pull requests from GitHub.");
  }

  const pulls = [];
  let totalPages = 1;
  for (const block of blocks) {
    const data = JSON.parse(block[1]);
    walk(data, (node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        return;
      }
      if (Array.isArray(node.results) && Number.isFinite(node.totalPages)) {
        totalPages = Math.max(totalPages, node.totalPages);
      }
      if (!node.permalink || !node.number || !node.repoNameWithOwner || !node.title) {
        return;
      }
      pulls.push({
        number: node.number,
        title: typeof node.title === "string" ? node.title : "",
        htmlUrl: node.permalink,
        repo: node.repoNameWithOwner,
        updatedAt: node.updatedAt || null,
        createdAt: node.createdAt || null,
        mergedAt: node.mergedAt || null,
        commentCount: Number(node.commentCount || 0),
        draft: String(node.displayState || "").includes("DRAFT") || node.isDraft === true,
        author: node.author?.displayLogin || "",
        headSha: typeof node.headSha === "string" ? node.headSha : "",
        listCategory: typeof node.category === "string" ? node.category : "",
        checkState: rollupCheckState(node.statusCheckRollup),
      });
    });
  }

  return { pulls: dedupePulls(pulls), totalPages };
}

async function githubHtml(url) {
  const response = await fetch(url, {
    credentials: "include",
    redirect: "follow",
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const finalUrl = response.url || "";
  if (finalUrl.includes("://github.com/login") || finalUrl.includes("://github.com/session")) {
    throw new Error("Sign in to GitHub in this browser, then refresh.");
  }
  if (response.status === 429) {
    throw new Error("GitHub rate limited this browser. Try again in a few minutes.");
  }
  if (response.status === 404) {
    throw new Error("A repository was not found, or this browser session cannot see it.");
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}.`);
  }
  const html = await response.text();
  captureGithubMeta(html);
  return html;
}

function walk(node, visit) {
  if (!node || typeof node !== "object") {
    return;
  }
  visit(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visit);
    }
    return;
  }
  for (const value of Object.values(node)) {
    walk(value, visit);
  }
}

function dedupePulls(pulls) {
  const byKey = new Map();
  for (const pull of pulls) {
    byKey.set(pullKey(pull), pull);
  }
  return [...byKey.values()];
}

function pullKey(pull) {
  return `${pull.repo}#${pull.number}`;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const githubMeta = { nonce: "", release: "" };

function captureGithubMeta(html) {
  const nonce = String(html).match(/<meta name="fetch-nonce" content="([^"]+)"/);
  const release = String(html).match(/<meta name="release" content="([^"]+)"/);
  if (nonce) {
    githubMeta.nonce = nonce[1];
  }
  if (release) {
    githubMeta.release = release[1];
  }
}

function reactHeaders(includeJsonContentType) {
  const headers = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "GitHub-Verified-Fetch": "true",
    "GitHub-Is-React": "true",
  };
  if (githubMeta.nonce) {
    headers["X-Fetch-Nonce"] = githubMeta.nonce;
  }
  if (githubMeta.release) {
    headers["X-GitHub-Client-Version"] = githubMeta.release;
  }
  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function rollupCheckState(rollup) {
  if (!rollup || typeof rollup !== "object" || typeof rollup.state !== "string") {
    return "";
  }
  return rollup.state.toUpperCase();
}

async function readMergeBox(repo, number) {
  const payload = await githubPageData(repo, number, "merge_box");
  if (!payload) {
    return null;
  }
  return summarizeMergeBox(payload);
}

async function readStatusChecks(repo, number) {
  const payload = await githubPageData(repo, number, "status_checks");
  if (!payload) {
    return null;
  }
  return summarizeChecks(payload);
}

export function summarizeChecks(data) {
  const checks = [];
  const rollup = [];
  walk(data, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }
    const state = typeof node.state === "string" ? node.state.toUpperCase() : "";
    if (!CI_CHECK_STATES.has(state)) {
      return;
    }
    if (typeof node.displayName === "string" && node.displayName.length > 0) {
      checks.push(state);
      return;
    }
    if (Number.isFinite(node.count) && node.count > 0) {
      rollup.push({ state, count: node.count });
    }
  });

  const steps = checks.length ? checks.map((state) => ({ state, count: 1 })) : rollup;
  let done = 0;
  let total = 0;
  let failed = false;
  let running = false;
  for (const step of steps) {
    total += step.count;
    if (CI_RUNNING_STATES.has(step.state)) {
      running = true;
      continue;
    }
    done += step.count;
    if (CI_FAILURE_STATES.has(step.state)) {
      failed = true;
    }
  }
  return {
    ciKnown: total > 0,
    ciFailed: failed,
    ciRunning: running,
    ciDone: done,
    ciTotal: total,
  };
}

async function readThreads(repo, number) {
  const payload = await githubPageData(repo, number, "threads");
  if (!payload) {
    return null;
  }
  return summarizeThreads(payload);
}

export function summarizeThreads(data) {
  if (!data || !Array.isArray(data.threads)) {
    return { unresolvedKnown: false, unresolvedCount: 0 };
  }
  let unresolvedCount = 0;
  for (const thread of data.threads) {
    if (thread && thread.isResolved === false) {
      unresolvedCount += 1;
    }
  }
  return { unresolvedKnown: true, unresolvedCount };
}

export function summarizeMergeBox(data) {
  let chosen = null;
  let headOid = "";
  let defaultMethod = "";
  let updateMethods = [];

  walk(data, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }
    if (typeof node.mergeStateStatus === "string") {
      const chosenHasAutoMerge = chosen && Object.prototype.hasOwnProperty.call(chosen, "autoMergeRequest");
      const nodeHasAutoMerge = Object.prototype.hasOwnProperty.call(node, "autoMergeRequest");
      if (!chosen || (nodeHasAutoMerge && !chosenHasAutoMerge)) {
        chosen = node;
      }
    }
    if (!headOid && typeof node.headRefOid === "string" && /^[a-f0-9]{40}$/i.test(node.headRefOid)) {
      headOid = node.headRefOid;
    }
    if (!defaultMethod && typeof node.defaultMergeMethod === "string") {
      defaultMethod = node.defaultMergeMethod;
    }
    if (Array.isArray(node.viewerUpdateMethods) && node.viewerUpdateMethods.length) {
      updateMethods = node.viewerUpdateMethods;
    }
  });

  if (!chosen && !headOid) {
    return null;
  }

  const status = chosen?.mergeStateStatus || "";
  const autoMergeRequest = chosen && Object.prototype.hasOwnProperty.call(chosen, "autoMergeRequest")
    ? chosen.autoMergeRequest
    : null;
  const methodNames = updateMethods
    .map((method) => (typeof method === "string" ? method : method?.name))
    .filter(Boolean);
  const updateMethod = methodNames.includes("MERGE") ? "MERGE" : methodNames[0] || "MERGE";
  const requestedMethod = autoMergeRequest?.mergeMethod || defaultMethod || "SQUASH";

  return {
    needsUpdate: status === "BEHIND",
    hasConflicts: status === "DIRTY" || status === "UNMERGEABLE",
    autoMerge: Boolean(autoMergeRequest) && autoMergeRequest.enabled !== false,
    mergeKnown: Boolean(chosen),
    headSha: headOid || chosen?.headSha || "",
    updateMethod,
    mergeMethod: ["MERGE", "SQUASH", "REBASE"].includes(requestedMethod) ? requestedMethod : "SQUASH",
    canEnableAutoMerge: chosen?.viewerCanEnableAutoMerge !== false,
    canDisableAutoMerge: chosen?.viewerCanDisableAutoMerge !== false,
  };
}

export async function performPrAction({ action, repo, number, headSha, updateMethod, mergeMethod, autoMerge }) {
  if (action === "update-branch") {
    const current = (await readMergeBox(repo, number)) || {};
    const expectedHeadOid = current.headSha || headSha;
    if (!expectedHeadOid) {
      throw new Error("Missing the current branch commit, so the branch was not updated.");
    }
    await postPageData(repo, number, "update_pull_request_branch", {
      updateMethod: current.updateMethod || updateMethod || "MERGE",
      expectedHeadOid,
    });
  } else if (action === "toggle-auto-merge") {
    const current = (await readMergeBox(repo, number)) || {};
    const enabled = current.mergeKnown ? current.autoMerge : Boolean(autoMerge);
    if (enabled) {
      await postPageData(repo, number, "disable_auto_merge");
    } else {
      await postPageData(repo, number, "enable_auto_merge", {
        mergeMethod: current.mergeMethod || mergeMethod || "SQUASH",
      });
    }
  } else {
    throw new Error(`Unknown pull request action: ${action}`);
  }

  const refreshed = await readMergeBox(repo, number);
  return refreshed || {
    needsUpdate: false,
    autoMerge: action === "toggle-auto-merge" ? !autoMerge : false,
    mergeKnown: true,
  };
}

async function githubPageData(repo, number, route) {
  await ensureGithubMeta(repo, number);
  const url = `https://github.com/${repo}/pull/${number}/page_data/${route}`;
  const response = await githubJsonRequest(url, { method: "GET" });
  if (response.status === 404) {
    return null;
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const message = payload?.error || payload?.message || `GitHub returned ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function postPageData(repo, number, route, body) {
  await ensureGithubMeta(repo, number);
  const url = `https://github.com/${repo}/pull/${number}/page_data/${route}`;
  const response = await githubJsonRequest(url, { method: "POST", body: body || null });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = payload?.error || payload?.message || `GitHub returned ${response.status}`;
    throw new Error(message);
  }
  const orchestrationUrl = payload?.orchestration?.url;
  if (!orchestrationUrl) {
    return payload;
  }
  const followUrl = new URL(orchestrationUrl, "https://github.com").toString();
  const follow = await githubJsonRequest(followUrl, { method: "GET" });
  const followPayload = await readJson(follow);
  if (followPayload?.orchestration?.error_message) {
    throw new Error(followPayload.orchestration.error_message);
  }
  return followPayload;
}

async function ensureGithubMeta(repo, number) {
  if (githubMeta.nonce && githubMeta.release) {
    return;
  }
  await githubHtml(`https://github.com/${repo}/pull/${number}`);
}

async function githubJsonRequest(url, { method, body }) {
  const direct = await fetch(url, {
    method,
    credentials: "include",
    headers: reactHeaders(Boolean(body)),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (direct.ok || direct.status === 404 || method === "GET") {
    return direct;
  }
  if (![401, 403, 422].includes(direct.status)) {
    return direct;
  }
  try {
    return await pageWorldRequest(url, { method, body });
  } catch (_error) {
    return direct;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

async function pageWorldRequest(url, { method, body }) {
  const existingTabs = await chrome.tabs.query({ url: "https://github.com/*" });
  let tabId = existingTabs.find((tab) => tab.id)?.id;
  let createdTabId = 0;
  if (!tabId) {
    const created = await chrome.tabs.create({ url: "https://github.com/", active: false });
    tabId = created.id;
    createdTabId = created.id;
    await waitForTabComplete(tabId);
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (requestUrl, requestMethod, requestBody) => {
        const nonce = document.querySelector('meta[name="fetch-nonce"]')?.getAttribute("content") || "";
        const release = document.querySelector('meta[name="release"]')?.getAttribute("content") || "";
        const headers = {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "GitHub-Verified-Fetch": "true",
          "GitHub-Is-React": "true",
        };
        if (nonce) {
          headers["X-Fetch-Nonce"] = nonce;
        }
        if (release) {
          headers["X-GitHub-Client-Version"] = release;
        }
        if (requestBody) {
          headers["Content-Type"] = "application/json";
        }
        const response = await fetch(requestUrl, {
          method: requestMethod,
          credentials: "include",
          headers,
          body: requestBody ? JSON.stringify(requestBody) : undefined,
        });
        return {
          ok: response.ok,
          status: response.status,
          text: await response.text(),
        };
      },
      args: [url, method, body || null],
    });
    const payload = result?.result;
    if (!payload) {
      throw new Error("GitHub page did not return a response.");
    }
    return {
      ok: payload.ok,
      status: payload.status,
      json: async () => (payload.text ? JSON.parse(payload.text) : {}),
    };
  } finally {
    if (createdTabId) {
      await chrome.tabs.remove(createdTabId);
    }
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (tab?.status === "complete") {
        resolve();
        return;
      }
      const onUpdated = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}
