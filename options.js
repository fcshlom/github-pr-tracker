import { getSettings, saveSettings } from "./lib/storage.js";
import { readBrowserSession } from "./lib/session.js";

const form = document.getElementById("settingsForm");
const usernameEl = document.getElementById("username");
const reposEl = document.getElementById("repos");
const saveStatusEl = document.getElementById("saveStatus");
const sessionStatusEl = document.getElementById("sessionStatus");
const openGitHubBtn = document.getElementById("openGitHub");
const recheckBtn = document.getElementById("recheck");

init();

async function init() {
  const settings = await getSettings();
  usernameEl.value = settings.username;
  reposEl.value = settings.repos.join("\n");
  await refreshSession();
}

openGitHubBtn.addEventListener("click", () => {
  window.open("https://github.com/login", "_blank", "noopener");
});

recheckBtn.addEventListener("click", () => {
  refreshSession();
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

  await saveSettings({ username, repos });
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
    return;
  }

  const who = session.login ? ` as ${session.login}` : "";
  sessionStatusEl.textContent = `Signed in to GitHub in this browser${who}.`;
  sessionStatusEl.className = "hint ok";
  if (!usernameEl.value.trim() && session.login) {
    usernameEl.value = session.login;
  }
}
