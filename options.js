import { getSettings, saveSettings } from "./lib/storage.js";
import { readBrowserSession } from "./lib/session.js";
import { listAccessibleRepos } from "./lib/repos.js";

const form = document.getElementById("settingsForm");
const usernameEl = document.getElementById("username");
const reposEl = document.getElementById("repos");
const refreshEl = document.getElementById("refreshSeconds");
const refreshValueEl = document.getElementById("refreshValue");
const saveStatusEl = document.getElementById("saveStatus");
const sessionStatusEl = document.getElementById("sessionStatus");
const repoListStatusEl = document.getElementById("repoListStatus");
const repoChoicesEl = document.getElementById("repoChoices");
const repoFilterEl = document.getElementById("repoFilter");
const openGitHubBtn = document.getElementById("openGitHub");
const recheckBtn = document.getElementById("recheck");

init();

async function init() {
  const settings = await getSettings();
  usernameEl.value = settings.username;
  reposEl.value = settings.repos.join("\n");
  refreshEl.value = String(settings.refreshSeconds);
  showRefreshValue();
  await refreshSession();
}

refreshEl.addEventListener("input", () => {
  showRefreshValue();
});

openGitHubBtn.addEventListener("click", () => {
  window.open("https://github.com/login", "_blank", "noopener");
});

recheckBtn.addEventListener("click", () => {
  refreshSession();
});

repoFilterEl.addEventListener("input", () => {
  applyRepoFilter();
});

repoChoicesEl.addEventListener("change", (event) => {
  const box = event.target.closest("input[data-repo]");
  if (!box) {
    return;
  }
  const lines = repoLines();
  const key = repoKey(box.dataset.repo);
  const without = lines.filter((line) => repoKey(line) !== key);
  reposEl.value = (box.checked ? [...without, box.dataset.repo] : without).join("\n");
});

reposEl.addEventListener("input", () => {
  syncRepoChecks();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveStatusEl.textContent = "Saving…";
  saveStatusEl.className = "muted";

  const username = usernameEl.value.trim();
  const repos = reposEl.value
    .split(/[\n,]+/)
    .map((repo) => repo.trim())
    .filter(Boolean);

  if (!username || !repos.length) {
    saveStatusEl.textContent = "Username and at least one repo are required.";
    return;
  }

  const invalidRepo = repos.find((repo) => !/^[^/\s]+\/[^/\s]+$/.test(repo.replace(/^https?:\/\/github\.com\//i, "")));
  if (invalidRepo) {
    saveStatusEl.textContent = `Invalid repo format: ${invalidRepo}. Use owner/repo.`;
    return;
  }

  await saveSettings({ username, repos, refreshSeconds: Number(refreshEl.value) });
  saveStatusEl.textContent = "Saved.";
  saveStatusEl.className = "muted ok";

  chrome.runtime.sendMessage({ type: "REFRESH_PRS", force: true }, () => {
    void chrome.runtime.lastError;
  });
});

async function refreshSession() {
  sessionStatusEl.textContent = "Checking this browser…";
  sessionStatusEl.className = "hint";
  const session = await readBrowserSession();
  if (!session.signedIn) {
    sessionStatusEl.textContent = "This browser is not signed in to GitHub. Open GitHub, sign in, then check again.";
    sessionStatusEl.className = "hint warn";
    repoChoicesEl.innerHTML = "";
    repoFilterEl.hidden = true;
    repoFilterEl.value = "";
    repoListStatusEl.textContent = "Sign in, then the list loads here.";
    return;
  }

  const who = session.login ? ` as ${session.login}` : "";
  sessionStatusEl.textContent = `Signed in to GitHub in this browser${who}.`;
  sessionStatusEl.className = "hint ok";
  if (!usernameEl.value.trim() && session.login) {
    usernameEl.value = session.login;
  }
  if (!session.login) {
    repoListStatusEl.textContent = "Signed in, but the GitHub username was not available.";
    return;
  }
  await loadRepoChoices(session.login);
}

async function loadRepoChoices(login) {
  repoListStatusEl.textContent = "Loading repositories from GitHub…";
  try {
    const repos = await listAccessibleRepos(login);
    repoChoicesEl.innerHTML = repos.map((repo) => {
      return `<label class="repo-choice"><input type="checkbox" data-repo="${escapeAttr(repo)}"> ${escapeHtml(repo)}</label>`;
    }).join("");
    syncRepoChecks();
    repoFilterEl.hidden = repos.length === 0;
    applyRepoFilter();
  } catch (error) {
    repoChoicesEl.innerHTML = "";
    repoFilterEl.hidden = true;
    repoListStatusEl.textContent = error?.message || "Could not load repositories.";
  }
}

function applyRepoFilter() {
  const query = repoFilterEl.value.trim().toLowerCase();
  const labels = [...repoChoicesEl.querySelectorAll(".repo-choice")];
  let shown = 0;
  for (const label of labels) {
    const name = label.querySelector("input")?.dataset.repo || "";
    const match = !query || name.toLowerCase().includes(query);
    label.hidden = !match;
    if (match) {
      shown += 1;
    }
  }
  if (!labels.length) {
    repoListStatusEl.textContent = "No repositories were found for this account. Add owner/repo below.";
    return;
  }
  repoListStatusEl.textContent = query
    ? (shown ? `${shown} of ${labels.length} repositories.` : "No repositories match.")
    : `${labels.length} repositories. Check the ones to track.`;
}

function syncRepoChecks() {
  const tracked = new Set(repoLines().map(repoKey));
  for (const box of repoChoicesEl.querySelectorAll("input[data-repo]")) {
    box.checked = tracked.has(repoKey(box.dataset.repo));
  }
}

function showRefreshValue() {
  const seconds = Number(refreshEl.value);
  refreshValueEl.textContent = seconds % 60 === 0
    ? `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}`
    : `${seconds} seconds`;
}

function repoLines() {
  return reposEl.value.split(/[\n,]+/).map((line) => line.trim()).filter(Boolean);
}

function repoKey(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
