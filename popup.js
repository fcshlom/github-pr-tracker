import { REFRESH_DEFAULT_SEC, getSettings, normalizeRefreshSeconds } from "./lib/storage.js";
import { isReadyToMerge } from "./lib/autopilot.js";
import { escapeAttr, escapeHtml, filterOpen, filterRepos, githubCommentUrl, repoNames } from "./lib/view.js";

const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");
const updatedAtEl = document.getElementById("updatedAt");
const refreshBtn = document.getElementById("refreshBtn");
const settingsBtn = document.getElementById("settingsBtn");
const openFiltersEl = document.getElementById("openFilters");
const openCountEl = document.getElementById("openCount");
const mergedCountEl = document.getElementById("mergedCount");

const state = {
  tab: "open",
  filters: {},
  data: { open: [], merged: [] },
  cacheUpdatedAt: 0,
  pendingId: "",
  autopilotIds: {},
  hiddenRepos: new Set(),
  repoMenuOpen: false,
};

document.querySelectorAll(".tab").forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    state.tab = tabBtn.dataset.tab;
    document.querySelectorAll(".tab").forEach((btn) => btn.classList.remove("active"));
    tabBtn.classList.add("active");
    openFiltersEl.hidden = state.tab !== "open";
    render();
    saveView();
  });
});

document.querySelectorAll(".chip").forEach((chipBtn) => {
  chipBtn.dataset.label = chipBtn.textContent;
  if (chipBtn.dataset.filter !== "all") {
    chipBtn.title = "Click to include, again to exclude, again to clear.";
  }
  chipBtn.addEventListener("click", () => {
    const name = chipBtn.dataset.filter;
    if (name === "all") {
      state.filters = {};
    } else {
      const current = state.filters[name];
      if (!current) {
        state.filters[name] = "include";
      } else if (current === "include") {
        state.filters[name] = "exclude";
      } else {
        delete state.filters[name];
      }
    }
    paintChips();
    render();
    saveView();
  });
});
paintChips();

refreshBtn.addEventListener("click", () => load({ force: true }));
settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

listEl.addEventListener("change", (event) => {
  const box = event.target.closest("input[data-autopilot]");
  if (!box) {
    return;
  }
  const id = box.dataset.autopilot;
  state.autopilotIds[id] = box.checked;
  sendMessage({ type: "SET_AUTOPILOT", id, enabled: box.checked }).then((response) => {
    if (response?.autopilotIds) {
      state.autopilotIds = response.autopilotIds;
      render();
    }
  });
});

listEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) {
    return;
  }
  const item = (state.data.open || []).find((pull) => pull.id === button.dataset.id);
  if (!item) {
    return;
  }
  runAction(item, button.dataset.action);
});

const unresolvedPop = document.getElementById("unresolvedPop");
let unresolvedHideTimer = 0;

listEl.addEventListener("mouseover", (event) => {
  const badge = event.target.closest("[data-unresolved-id]");
  if (!badge) {
    return;
  }
  showUnresolvedPop(badge);
});

listEl.addEventListener("mouseout", (event) => {
  const badge = event.target.closest("[data-unresolved-id]");
  if (!badge) {
    return;
  }
  scheduleHideUnresolvedPop();
});

unresolvedPop.addEventListener("mouseenter", () => {
  window.clearTimeout(unresolvedHideTimer);
});

unresolvedPop.addEventListener("mouseleave", () => {
  scheduleHideUnresolvedPop();
});

listEl.addEventListener("scroll", () => {
  hideUnresolvedPop();
});

const repoFilterEl = document.getElementById("repoFilter");
const repoFilterBtn = document.getElementById("repoFilterBtn");
const repoFilterMenu = document.getElementById("repoFilterMenu");

repoFilterEl.addEventListener("click", (event) => {
  event.stopPropagation();
});

repoFilterBtn.addEventListener("click", () => {
  state.repoMenuOpen = !state.repoMenuOpen;
  render();
});

repoFilterMenu.addEventListener("change", (event) => {
  const box = event.target.closest("input[data-repo]");
  if (!box) {
    return;
  }
  if (box.checked) {
    state.hiddenRepos.delete(box.dataset.repo);
  } else {
    state.hiddenRepos.add(box.dataset.repo);
  }
  render();
  saveView();
});

document.addEventListener("click", () => {
  if (!state.repoMenuOpen) {
    return;
  }
  state.repoMenuOpen = false;
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.repoMenuOpen) {
    return;
  }
  state.repoMenuOpen = false;
  render();
});

restoreView().finally(() => load({ force: false }));
let refreshTimer = 0;

function startRefreshTimer(refreshSeconds) {
  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    if (!refreshBtn.disabled) {
      load({ force: false });
    }
  }, refreshSeconds * 1000);
}

getSettings()
  .then((settings) => startRefreshTimer(settings.refreshSeconds))
  .catch(() => startRefreshTimer(REFRESH_DEFAULT_SEC));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.refreshSeconds) {
    startRefreshTimer(normalizeRefreshSeconds(changes.refreshSeconds.newValue));
  }
});

async function load({ force }) {
  setBusy(true);
  hideStatus();
  try {
    const response = await sendMessage({ type: "REFRESH_PRS", force });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load pull requests.");
    }
    state.data = response.data || { open: [], merged: [] };
    state.cacheUpdatedAt = response.cacheUpdatedAt || Date.now();
    if (response.autopilotIds) {
      state.autopilotIds = response.autopilotIds;
    }
    render();
  } catch (error) {
    showStatus(error.message || String(error), true);
    render();
  } finally {
    setBusy(false);
  }
}

function render() {
  hideUnresolvedPop();
  const repos = repoNames([...(state.data.open || []), ...(state.data.merged || [])]);
  if (repos.length < 2 && state.hiddenRepos.size) {
    state.hiddenRepos.clear();
    saveView();
  }
  const open = filterRepos(Array.isArray(state.data.open) ? state.data.open : [], state.hiddenRepos);
  const merged = filterRepos(Array.isArray(state.data.merged) ? state.data.merged : [], state.hiddenRepos);
  openCountEl.textContent = String(open.length);
  mergedCountEl.textContent = String(merged.length);
  updatedAtEl.textContent = state.cacheUpdatedAt
    ? `Updated ${formatRelative(state.cacheUpdatedAt)}`
    : "Not loaded yet";
  updateRepoFilter(repos);
  paintChips();

  const items = state.tab === "merged" ? merged : filterOpen(open, state.filters);
  const unfiltered = state.tab === "merged"
    ? (state.data.merged || [])
    : filterOpen(state.data.open || [], state.filters);
  if (!items.length) {
    listEl.innerHTML = `<div class="empty">${unfiltered.length ? "No pull requests in the selected projects." : emptyMessage()}</div>`;
    return;
  }

  listEl.innerHTML = items.map((item) => renderCard(item, state.tab === "merged")).join("");
}

function saveView() {
  chrome.storage.session.set({
    viewState: {
      filters: state.filters,
      hiddenRepos: [...state.hiddenRepos],
      tab: state.tab,
    },
  }).catch(() => {});
}

async function restoreView() {
  const stored = await chrome.storage.session.get({ viewState: null });
  const view = stored.viewState;
  if (!view || typeof view !== "object") {
    return;
  }
  if (view.filters && typeof view.filters === "object") {
    state.filters = view.filters;
  }
  if (Array.isArray(view.hiddenRepos)) {
    state.hiddenRepos = new Set(view.hiddenRepos.filter((repo) => typeof repo === "string"));
  }
  if (view.tab === "open" || view.tab === "merged") {
    state.tab = view.tab;
    document.querySelectorAll(".tab").forEach((tabBtn) => {
      tabBtn.classList.toggle("active", tabBtn.dataset.tab === state.tab);
    });
    openFiltersEl.hidden = state.tab !== "open";
  }
  paintChips();
}

function updateRepoFilter(repos) {
  if (repos.length < 2) {
    repoFilterEl.hidden = true;
    state.repoMenuOpen = false;
    return;
  }
  repoFilterEl.hidden = false;
  const selected = repos.filter((repo) => !state.hiddenRepos.has(repo));
  repoFilterBtn.textContent = selected.length === repos.length
    ? "All projects"
    : selected.length === 1
      ? selected[0]
      : `${selected.length} projects`;
  repoFilterBtn.setAttribute("aria-expanded", state.repoMenuOpen ? "true" : "false");
  repoFilterMenu.hidden = !state.repoMenuOpen;
  const signature = repos.join("\n");
  if (repoFilterMenu.dataset.repos === signature) {
    return;
  }
  repoFilterMenu.dataset.repos = signature;
  repoFilterMenu.innerHTML = repos.map((repo) => {
    const checked = state.hiddenRepos.has(repo) ? "" : "checked";
    return `<label class="repo-option"><input type="checkbox" data-repo="${escapeAttr(repo)}" ${checked}> ${escapeHtml(repo)}</label>`;
  }).join("");
}

function paintChips() {
  const anyFilter = Object.keys(state.filters).length > 0;
  document.querySelectorAll(".chip").forEach((chipBtn) => {
    const mode = state.filters[chipBtn.dataset.filter];
    const label = chipBtn.dataset.label || chipBtn.textContent;
    chipBtn.textContent = mode === "exclude" ? `Not ${label}` : label;
    chipBtn.classList.toggle("active", chipBtn.dataset.filter === "all" ? !anyFilter : mode === "include");
    chipBtn.classList.toggle("excluded", mode === "exclude");
    chipBtn.setAttribute("aria-pressed", mode ? "true" : "false");
  });
}

function renderCard(item, isMerged) {
  const alerts = [];
  if (!isMerged && item.hasConflicts) {
    alerts.push(`<span class="badge conflict">Conflicts</span>`);
  }
  if (!isMerged && item.ciFailed) {
    alerts.push(`<span class="badge ci-failed">CI failed</span>`);
  }
  let unresolvedBadge = "";
  if (!isMerged && item.unresolvedKnown && item.unresolvedCount > 0) {
    unresolvedBadge = `<span class="badge unresolved" data-unresolved-id="${escapeAttr(item.id)}">Unresolved · ${escapeHtml(String(item.unresolvedCount))}</span>`;
  }
  const badges = [];
  if (isMerged) {
    badges.push(`<span class="badge merged">Merged</span>`);
  } else if (item.closed) {
    badges.push(`<span class="badge closed">Closed</span>`);
  } else if (item.category === "approved") {
    badges.push(`<span class="badge approved">Approved</span>`);
  } else if (item.changesRequested) {
    badges.push(`<span class="badge awaiting">Changes requested</span>`);
  } else {
    badges.push(`<span class="badge awaiting">Awaiting response</span>`);
  }
  if (item.draft) {
    badges.push(`<span class="badge draft">Draft</span>`);
  }
  if (!isMerged && item.unresolvedKnown) {
    if (item.unresolvedCount === 0 && item.hasComments) {
      badges.push(`<span class="badge resolved">Comments resolved</span>`);
    }
  } else if (item.hasComments) {
    badges.push(
      `<span class="badge comments">Comments · ${escapeHtml(String(item.commentCount || 0))}</span>`
    );
  }
  if (!isMerged && item.needsUpdate) {
    badges.push(`<span class="badge behind">Branch behind</span>`);
  }
  if (!isMerged && item.otherBase && item.baseRef) {
    badges.push(`<span class="badge base">Base · ${escapeHtml(item.baseRef)}</span>`);
  }
  if (!isMerged && item.autoMerge) {
    badges.push(
      `<span class="badge automerge">Auto-merge · ${escapeHtml(String(item.mergeMethod || "on").toLowerCase())}</span>`
    );
  }
  if (!isMerged && item.pendingReviewers > 0) {
    badges.push(
      `<span class="badge awaiting">Reviewers · ${escapeHtml(String(item.pendingReviewers))}</span>`
    );
  }

  const summaryBits = [];
  if (!isMerged && item.reviewSummary) {
    if (item.reviewSummary.approvedCount) {
      summaryBits.push(`${item.reviewSummary.approvedCount} approved`);
    }
    if (item.reviewSummary.changesRequestedCount) {
      summaryBits.push(`${item.reviewSummary.changesRequestedCount} changes requested`);
    }
  }

  const actions = [];
  if (!isMerged) {
    const checked = state.autopilotIds[item.id] ? "checked" : "";
    actions.push(
      `<label class="autopilot" title="When this pull request is approved and the branch is not behind, merge it. If it is behind and auto-merge is on, update the branch first."><input type="checkbox" data-autopilot="${escapeAttr(item.id)}" ${checked}> Autopilot</label>`
    );
  }
  if (!isMerged && item.needsUpdate && item.headSha && !item.hasConflicts) {
    actions.push(
      `<button type="button" data-action="update-branch" data-id="${escapeAttr(item.id)}" ${
        state.pendingId === item.id ? "disabled" : ""
      }>Update branch</button>`
    );
  }
  if (!isMerged && item.draft) {
    actions.push(
      `<button type="button" data-action="mark-ready" data-id="${escapeAttr(item.id)}" ${
        state.pendingId === item.id ? "disabled" : ""
      }>Mark ready</button>`
    );
  }
  if (!isMerged && isReadyToMerge(item)) {
    actions.push(
      `<button type="button" data-action="merge" data-id="${escapeAttr(item.id)}" ${
        state.pendingId === item.id ? "disabled" : ""
      }>Merge</button>`
    );
  }
  if (!isMerged && item.mergeKnown && (item.autoMerge ? item.canDisableAutoMerge !== false : item.canEnableAutoMerge !== false)) {
    const label = item.autoMerge ? "Turn off auto-merge" : "Turn on auto-merge";
    actions.push(
      `<button type="button" data-action="toggle-auto-merge" data-id="${escapeAttr(item.id)}" ${
        state.pendingId === item.id ? "disabled" : ""
      }>${label}</button>`
    );
  }

  return `
    <article class="card${alerts.length ? " problem" : ""}">
      ${alerts.length || unresolvedBadge ? `<div class="alert-row">${alerts.join("")}${unresolvedBadge}</div>` : ""}
      <h2 class="card-title"><a class="card-link" href="${escapeAttr(item.htmlUrl)}" target="_blank" rel="noreferrer">#${escapeHtml(String(item.number))} ${escapeHtml(item.title)}</a></h2>
      <div class="meta">${renderMeta(item, summaryBits)}</div>
      <div class="meta" style="margin-top:8px">${badges.join("")}</div>
      ${isMerged ? "" : renderCiProgress(item)}
      ${actions.length ? `<div class="card-actions">${actions.join("")}</div>` : ""}
    </article>
  `;
}

function renderMeta(item, summaryBits) {
  const parts = [escapeHtml(item.repo)];
  if (item.author) {
    parts.push(escapeHtml(item.author));
  }
  if (Number.isFinite(item.changedFiles)) {
    const files = item.changedFiles === 1 ? "1 file" : `${item.changedFiles} files`;
    parts.push(`${files} · +${Number(item.additions || 0)} −${Number(item.deletions || 0)}`);
  }
  parts.push(escapeHtml(formatRelative(item.updatedAt)));
  if (summaryBits.length) {
    parts.push(escapeHtml(summaryBits.join(", ")));
  }
  return parts.map((part) => `<span>${part}</span>`).join(`<span>·</span>`);
}

function renderCiProgress(item) {
  if (!item.ciRunning) {
    return "";
  }
  const total = Number(item.ciTotal || 0);
  const done = Math.min(total, Number(item.ciDone || 0));
  if (total > 0) {
    const percent = Math.round((done / total) * 100);
    const fill = done === 0
      ? `<span class="ci-progress-fill indeterminate"></span>`
      : `<span class="ci-progress-fill" style="width:${percent}%"></span>`;
    return `<div class="ci-progress" role="progressbar" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${total}" aria-label="CI ${done} of ${total}"><span class="ci-progress-label">CI ${done}/${total}</span><span class="ci-progress-track">${fill}</span></div>`;
  }
  return `<div class="ci-progress" role="progressbar" aria-label="CI running"><span class="ci-progress-label">CI running</span><span class="ci-progress-track"><span class="ci-progress-fill indeterminate"></span></span></div>`;
}

async function runAction(item, action) {
  if (action === "merge" && !window.confirm(`Merge pull request #${item.number}?`)) {
    return;
  }
  state.pendingId = item.id;
  hideStatus();
  render();
  try {
    const response = await sendMessage({
      type: "PR_ACTION",
      action,
      repo: item.repo,
      number: item.number,
      headSha: item.headSha,
      updateMethod: item.updateMethod,
      mergeMethod: item.mergeMethod,
      autoMerge: item.autoMerge,
      title: item.title,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "GitHub action failed.");
    }
    if (response.mergeState?.merged) {
      state.data.open = (state.data.open || []).filter((pull) => pull.id !== item.id);
      showStatus("Pull request merged.", false);
    } else {
      Object.assign(item, response.mergeState || {});
      const statusText = action === "update-branch"
        ? "Branch update requested."
        : action === "mark-ready"
          ? "Marked ready for review."
          : "Auto-merge updated.";
      showStatus(statusText, false);
    }
  } catch (error) {
    showStatus(error.message || String(error), true);
  } finally {
    state.pendingId = "";
    render();
  }
}

function showUnresolvedPop(badge) {
  window.clearTimeout(unresolvedHideTimer);
  const item = (state.data.open || []).find((pull) => pull.id === badge.dataset.unresolvedId);
  const comments = Array.isArray(item?.unresolvedComments) ? item.unresolvedComments : [];
  unresolvedPop.innerHTML = comments.length
    ? comments.map(renderUnresolvedComment).join("")
    : `<div class="unresolved-item"><span class="text">Refresh to load the comments.</span></div>`;
  unresolvedPop.hidden = false;
  const badgeRect = badge.getBoundingClientRect();
  const popRect = unresolvedPop.getBoundingClientRect();
  let top = badgeRect.bottom + 6;
  if (top + popRect.height > window.innerHeight - 8) {
    top = badgeRect.top - popRect.height - 6;
  }
  let left = badgeRect.left;
  if (left + popRect.width > window.innerWidth - 8) {
    left = window.innerWidth - popRect.width - 8;
  }
  unresolvedPop.style.top = `${Math.max(8, top)}px`;
  unresolvedPop.style.left = `${Math.max(8, left)}px`;
}

function renderUnresolvedComment(comment) {
  const author = comment.author ? `<span class="who">${escapeHtml(comment.author)}</span>` : "";
  const text = `<span class="text">${escapeHtml(comment.text || "Unresolved thread")}</span>`;
  const url = githubCommentUrl(comment.url);
  if (!url) {
    return `<div class="unresolved-item">${author}${text}</div>`;
  }
  return `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${author}${text}</a>`;
}

function scheduleHideUnresolvedPop() {
  window.clearTimeout(unresolvedHideTimer);
  unresolvedHideTimer = window.setTimeout(hideUnresolvedPop, 150);
}

function hideUnresolvedPop() {
  unresolvedPop.hidden = true;
}

function emptyMessage() {
  if (state.tab === "merged") {
    return "No pull requests merged in the last 48 hours.";
  }
  if (Object.keys(state.filters).length) {
    return "No pull requests match these filters.";
  }
  return "No open pull requests. Configure repos in Settings if this looks wrong.";
}

function setBusy(isBusy) {
  refreshBtn.disabled = isBusy;
  refreshBtn.classList.toggle("spinning", isBusy);
}

function showStatus(message, isError) {
  statusEl.hidden = false;
  statusEl.className = isError ? "status error" : "status";
  statusEl.textContent = message;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function formatRelative(value) {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "unknown time";
  }
  const deltaSec = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) {
    return rtf.format(deltaSec, "second");
  }
  if (abs < 3600) {
    return rtf.format(Math.round(deltaSec / 60), "minute");
  }
  if (abs < 86400) {
    return rtf.format(Math.round(deltaSec / 3600), "hour");
  }
  return rtf.format(Math.round(deltaSec / 86400), "day");
}

