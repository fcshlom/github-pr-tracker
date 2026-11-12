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
  filter: "all",
  data: { open: [], merged: [] },
  cacheUpdatedAt: 0,
  pendingId: "",
  autopilotIds: {},
};

document.querySelectorAll(".tab").forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    state.tab = tabBtn.dataset.tab;
    document.querySelectorAll(".tab").forEach((btn) => btn.classList.remove("active"));
    tabBtn.classList.add("active");
    openFiltersEl.hidden = state.tab !== "open";
    render();
  });
});

document.querySelectorAll(".chip").forEach((chipBtn) => {
  chipBtn.addEventListener("click", () => {
    state.filter = chipBtn.dataset.filter;
    document.querySelectorAll(".chip").forEach((btn) => btn.classList.remove("active"));
    chipBtn.classList.add("active");
    render();
  });
});

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

load({ force: false });
setInterval(() => {
  if (!refreshBtn.disabled) {
    load({ force: true });
  }
}, 20 * 1000);

async function load({ force }) {
  setBusy(true);
  hideStatus();
  try {
    const messageType = force ? "REFRESH_PRS" : "GET_CACHED_PRS";
    const response = await sendMessage({ type: messageType, force });
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
  const open = Array.isArray(state.data.open) ? state.data.open : [];
  const merged = Array.isArray(state.data.merged) ? state.data.merged : [];
  openCountEl.textContent = String(open.length);
  mergedCountEl.textContent = String(merged.length);
  updatedAtEl.textContent = state.cacheUpdatedAt
    ? `Updated ${formatRelative(state.cacheUpdatedAt)}`
    : "Not loaded yet";

  const items = state.tab === "merged" ? merged : filterOpen(open, state.filter);
  if (!items.length) {
    listEl.innerHTML = `<div class="empty">${emptyMessage()}</div>`;
    return;
  }

  listEl.innerHTML = items.map((item) => renderCard(item, state.tab === "merged")).join("");
}

function filterOpen(open, filter) {
  if (filter === "approved") {
    return open.filter((item) => item.category === "approved");
  }
  if (filter === "awaiting") {
    return open.filter((item) => item.category === "awaiting");
  }
  if (filter === "comments") {
    return open.filter((item) => item.hasComments);
  }
  if (filter === "behind") {
    return open.filter((item) => item.needsUpdate);
  }
  return open;
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
      `<label class="autopilot" title="When this pull request is approved, auto-merge is on, and the branch is behind, update the branch until it merges."><input type="checkbox" data-autopilot="${escapeAttr(item.id)}" ${checked}> Autopilot</label>`
    );
  }
  if (!isMerged && item.needsUpdate && item.headSha && !item.hasConflicts) {
    actions.push(
      `<button type="button" data-action="update-branch" data-id="${escapeAttr(item.id)}" ${
        state.pendingId === item.id ? "disabled" : ""
      }>Update branch</button>`
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
      <div class="meta">
        <span>${escapeHtml(item.repo)}</span>
        <span>·</span>
        <span>${escapeHtml(formatRelative(item.updatedAt))}</span>
        ${summaryBits.length ? `<span>·</span><span>${escapeHtml(summaryBits.join(", "))}</span>` : ""}
      </div>
      <div class="meta" style="margin-top:8px">${badges.join("")}</div>
      ${isMerged ? "" : renderCiProgress(item)}
      ${actions.length ? `<div class="card-actions">${actions.join("")}</div>` : ""}
    </article>
  `;
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
    });
    if (!response?.ok) {
      throw new Error(response?.error || "GitHub action failed.");
    }
    Object.assign(item, response.mergeState || {});
    showStatus(action === "update-branch" ? "Branch update requested." : "Auto-merge updated.", false);
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

function githubCommentUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:" && url.hostname === "github.com") {
      return url.toString();
    }
  } catch (_error) {
    return "";
  }
  return "";
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
  if (state.filter === "approved") {
    return "No approved open pull requests.";
  }
  if (state.filter === "awaiting") {
    return "Nothing awaiting a response.";
  }
  if (state.filter === "comments") {
    return "No open pull requests with comments.";
  }
  if (state.filter === "behind") {
    return "No open pull requests need a branch update.";
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
