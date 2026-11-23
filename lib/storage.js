export const REFRESH_MIN_SEC = 20;
export const REFRESH_MAX_SEC = 300;
export const REFRESH_DEFAULT_SEC = 20;

export function normalizeRefreshSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return REFRESH_DEFAULT_SEC;
  }
  const stepped = Math.round(seconds / 10) * 10;
  return Math.min(REFRESH_MAX_SEC, Math.max(REFRESH_MIN_SEC, stepped));
}

export async function getSettings() {
  const sync = await chrome.storage.sync.get({
    username: "",
    repos: [],
    watchedPulls: [],
    refreshSeconds: REFRESH_DEFAULT_SEC,
  });
  return {
    username: String(sync.username || "").trim(),
    repos: normalizeRepos(sync.repos),
    watchedPulls: normalizeWatchedPulls(sync.watchedPulls),
    refreshSeconds: normalizeRefreshSeconds(sync.refreshSeconds),
  };
}

export async function saveSettings({ username, repos, watchedPulls, refreshSeconds }) {
  await chrome.storage.sync.set({
    username: String(username || "").trim(),
    repos: normalizeRepos(repos),
    watchedPulls: normalizeWatchedPulls(watchedPulls),
    refreshSeconds: normalizeRefreshSeconds(refreshSeconds),
  });
  await chrome.storage.local.remove("token");
}

export async function getCache() {
  const data = await chrome.storage.local.get({
    cache: null,
    cacheUpdatedAt: 0,
  });
  return {
    cache: data.cache,
    cacheUpdatedAt: Number(data.cacheUpdatedAt || 0),
  };
}

export async function saveCache(cache) {
  await chrome.storage.local.set({
    cache,
    cacheUpdatedAt: Date.now(),
  });
}

export async function getAlertSnapshot() {
  const data = await chrome.storage.local.get({ alertSnapshot: null });
  return data.alertSnapshot;
}

export async function saveAlertSnapshot(alertSnapshot) {
  await chrome.storage.local.set({ alertSnapshot });
}

export async function getAutopilotIds() {
  const data = await chrome.storage.local.get({ autopilotIds: {} });
  return data.autopilotIds && typeof data.autopilotIds === "object" ? data.autopilotIds : {};
}

export async function setAutopilotId(id, enabled) {
  const autopilotIds = await getAutopilotIds();
  if (enabled) {
    autopilotIds[id] = true;
  } else {
    delete autopilotIds[id];
  }
  await chrome.storage.local.set({ autopilotIds });
  return autopilotIds;
}

export async function getAutopilotAttempts() {
  const data = await chrome.storage.local.get({ autopilotAttempts: {} });
  return data.autopilotAttempts && typeof data.autopilotAttempts === "object" ? data.autopilotAttempts : {};
}

export async function saveAutopilotAttempts(autopilotAttempts) {
  await chrome.storage.local.set({ autopilotAttempts });
}

export function parseWatchedPull(value) {
  const text = String(value || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const url = text.match(/^([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  if (url) {
    return `${url[1]}/${url[2]}#${url[3]}`;
  }
  const short = text.match(/^([^/\s]+)\/([^/\s#]+)#(\d+)$/);
  if (short) {
    return `${short[1]}/${short[2]}#${short[3]}`;
  }
  return "";
}

export function normalizeWatchedPulls(value) {
  const lines = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  const seen = new Set();
  const pulls = [];
  for (const line of lines) {
    const parsed = parseWatchedPull(line);
    const key = parsed.toLowerCase();
    if (!parsed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    pulls.push(parsed);
  }
  return pulls;
}

export function normalizeRepos(repos) {
  if (Array.isArray(repos)) {
    return repos
      .map((repo) => String(repo || "").trim())
      .filter(Boolean)
      .map((repo) => repo.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, ""));
  }
  if (typeof repos === "string") {
    return repos
      .split(/[\n,]+/)
      .map((repo) => repo.trim())
      .filter(Boolean)
      .map((repo) => repo.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, ""));
  }
  return [];
}
