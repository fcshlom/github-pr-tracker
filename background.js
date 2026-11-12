import { getSettings, getCache, saveCache, getAlertSnapshot, saveAlertSnapshot, getAutopilotIds, setAutopilotId, getAutopilotAttempts, saveAutopilotAttempts } from "./lib/storage.js";
import { fetchPrDashboard, performPrAction } from "./lib/github.js";
import { alertTitle, diffPrAlerts } from "./lib/notify.js";
import { shouldAutopilotUpdate } from "./lib/autopilot.js";

const ALARM_NAME = "refresh-prs";
const REFRESH_MS = 20 * 1000;
const BADGE_COLORS = {
  ok: "#1f6feb",
  warn: "#d29922",
  error: "#da3633",
};

chrome.runtime.onInstalled.addListener(() => {
  ensureRefreshAlarm().catch(() => {});
  chrome.storage.local.remove("token");
  refreshBadge().catch(() => {});
});

ensureRefreshAlarm().catch(() => {});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    refreshBadge().catch(() => {});
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.storage.local.get({ notificationLinks: {} }, (data) => {
    const url = data.notificationLinks?.[notificationId];
    if (url) {
      chrome.tabs.create({ url });
    }
    chrome.notifications.clear(notificationId);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "REFRESH_PRS") {
    refreshDashboard(Boolean(message.force))
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || String(error),
        })
      );
    return true;
  }

  if (message?.type === "GET_CACHED_PRS") {
    getCache()
      .then(async ({ cache, cacheUpdatedAt }) => {
        if (cache) {
          const autopilotIds = await getAutopilotIds();
          sendResponse({ ok: true, data: cache, cacheUpdatedAt, autopilotIds });
          return;
        }
        const payload = await refreshDashboard(true);
        sendResponse({ ok: true, ...payload });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || String(error),
        })
      );
    return true;
  }

  if (message?.type === "PR_ACTION") {
    performPrAction(message)
      .then(async (mergeState) => {
        const { cache } = await getCache();
        const open = Array.isArray(cache?.open) ? cache.open : [];
        const target = open.find((item) => item.repo === message.repo && item.number === message.number);
        if (target) {
          Object.assign(target, mergeState);
          await saveCache(cache);
        }
        sendResponse({ ok: true, mergeState });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || String(error),
        })
      );
    return true;
  }

  if (message?.type === "SET_AUTOPILOT") {
    setAutopilotId(message.id, Boolean(message.enabled))
      .then(async (autopilotIds) => {
        if (message.enabled) {
          const { cache } = await getCache();
          await runAutopilot(cache?.open || []);
        }
        sendResponse({ ok: true, autopilotIds });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || String(error),
        })
      );
    return true;
  }

  return false;
});

let refreshInFlight = null;

async function ensureRefreshAlarm() {
  const periodInMinutes = REFRESH_MS / 60000;
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm || Math.abs((alarm.periodInMinutes || 0) - periodInMinutes) > 0.001) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes });
  }
}

async function refreshDashboard(force) {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = refreshDashboardNow(force).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function refreshDashboardNow(force) {
  const { cache, cacheUpdatedAt } = await getCache();
  if (!force && cache && Date.now() - cacheUpdatedAt < REFRESH_MS) {
    await updateBadgeFromCache(cache);
    return { data: cache, cacheUpdatedAt, autopilotIds: await getAutopilotIds() };
  }

  const settings = await getSettings();
  const data = await fetchPrDashboard(settings);
  await saveCache(data);
  await updateBadgeFromCache(data);
  await publishAlerts(data.open);
  await runAutopilot(data.open);
  const saved = await getCache();
  return { data, cacheUpdatedAt: saved.cacheUpdatedAt, autopilotIds: await getAutopilotIds() };
}

async function runAutopilot(openPrs) {
  const ids = await getAutopilotIds();
  const attempts = await getAutopilotAttempts();
  const now = Date.now();
  const { cache } = await getCache();
  let cacheDirty = false;
  for (const item of openPrs || []) {
    if (!shouldAutopilotUpdate(item, { enabled: Boolean(ids[item.id]), now, lastAttemptAt: Number(attempts[item.id] || 0) })) {
      continue;
    }
    attempts[item.id] = now;
    await saveAutopilotAttempts(attempts);
    try {
      const mergeState = await performPrAction({
        action: "update-branch",
        repo: item.repo,
        number: item.number,
        headSha: item.headSha,
        updateMethod: item.updateMethod,
        mergeMethod: item.mergeMethod,
        autoMerge: item.autoMerge,
      });
      Object.assign(item, mergeState || {});
      const cached = (cache?.open || []).find((pull) => pull.id === item.id);
      if (cached) {
        Object.assign(cached, mergeState || {});
        cacheDirty = true;
      }
    } catch (error) {
      await notifyAutopilotFailure(item, error);
    }
  }
  if (cacheDirty && cache) {
    await saveCache(cache);
  }
}

async function notifyAutopilotFailure(item, error) {
  const id = `autopilot:${item.id}:${Date.now()}`;
  const stored = await chrome.storage.local.get({ notificationLinks: {} });
  const notificationLinks = stored.notificationLinks || {};
  notificationLinks[id] = item.htmlUrl;
  await chrome.storage.local.set({ notificationLinks });
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Autopilot could not update the branch",
    message: `${item.repo} #${item.number}: ${error?.message || "Update failed"}`,
    priority: 2,
  });
}

async function publishAlerts(openPrs) {
  const previous = await getAlertSnapshot();
  const { events, next } = diffPrAlerts(previous, openPrs);
  await saveAlertSnapshot(next);
  if (previous) {
    await showPrAlerts(events);
  }
}

async function showPrAlerts(events) {
  if (!events.length) {
    return;
  }
  const shown = events.slice(0, 4);
  const extra = events.length - shown.length;
  const stored = await chrome.storage.local.get({ notificationLinks: {} });
  const notificationLinks = stored.notificationLinks || {};
  const iconUrl = chrome.runtime.getURL("icons/icon128.png");
  for (const [eventIndex, event] of shown.entries()) {
    const id = `alert:${event.type}:${event.id}:${eventIndex}:${Date.now()}`;
    notificationLinks[id] = event.pull.htmlUrl;
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl,
      title: alertTitle(event),
      message: `${event.pull.repo} #${event.pull.number}: ${event.pull.title}`,
      priority: 2,
    });
  }
  if (extra > 0) {
    await chrome.notifications.create(`alert:more:${Date.now()}`, {
      type: "basic",
      iconUrl,
      title: "More pull request updates",
      message: `${extra} more updates on your open pull requests.`,
      priority: 1,
    });
  }
  const ids = Object.keys(notificationLinks);
  for (const oldId of ids.slice(0, Math.max(0, ids.length - 30))) {
    delete notificationLinks[oldId];
  }
  await chrome.storage.local.set({ notificationLinks });
}

async function refreshBadge() {
  try {
    const settings = await getSettings();
    if (!settings.username || !settings.repos.length) {
      await setBadge("", BADGE_COLORS.warn);
      return;
    }
    await refreshDashboard(true);
  } catch (_error) {
    await setBadge("!", BADGE_COLORS.error);
  }
}

async function updateBadgeFromCache(cache) {
  const openCount = Array.isArray(cache?.open) ? cache.open.length : 0;
  await setBadge(openCount > 0 ? String(openCount) : "", BADGE_COLORS.ok);
}

async function setBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}
