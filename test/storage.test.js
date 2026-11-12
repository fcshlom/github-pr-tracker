import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { resetChrome, seedLocal } from "./chrome-fake.js";
import {
  getAutopilotIds,
  getCache,
  getSettings,
  normalizeRepos,
  saveCache,
  saveSettings,
  setAutopilotId,
} from "../lib/storage.js";

beforeEach(() => {
  resetChrome();
});

test("repository settings accept a list or a blob of github urls", () => {
  assert.deepEqual(
    normalizeRepos("https://github.com/acme/web.git\nfoo/bar, , https://GitHub.com/acme/api"),
    ["acme/web", "foo/bar", "acme/api"]
  );
  assert.deepEqual(normalizeRepos([" https://github.com/acme/web.git ", ""]), ["acme/web"]);
  assert.deepEqual(normalizeRepos(null), []);
});

test("saving settings trims the username and deletes a stored token", async () => {
  seedLocal({ token: "secret" });
  await saveSettings({ username: " ada ", repos: "https://github.com/acme/web.git" });
  assert.deepEqual(await getSettings(), { username: "ada", repos: ["acme/web"] });
  assert.equal((await chrome.storage.local.get({})).token, undefined);
});

test("cache and autopilot ids round-trip through local storage", async () => {
  assert.deepEqual(await getCache(), { cache: null, cacheUpdatedAt: 0 });
  await saveCache({ open: [{ id: "acme/web#1" }], merged: [] });
  const saved = await getCache();
  assert.equal(saved.cache.open[0].id, "acme/web#1");
  assert.equal(saved.cacheUpdatedAt > 0, true);

  assert.deepEqual(await setAutopilotId("acme/web#1", true), { "acme/web#1": true });
  assert.deepEqual(await setAutopilotId("acme/web#1", false), {});
  assert.deepEqual(await getAutopilotIds(), {});
});
