import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { resetChrome, setCookie } from "./chrome-fake.js";
import { readBrowserSession } from "../lib/session.js";

beforeEach(() => {
  resetChrome();
});

test("a logged-in browser session exposes the github login", async () => {
  setCookie("logged_in", "yes");
  setCookie("dotcom_user", "ada%20dev");
  assert.deepEqual(await readBrowserSession(), { signedIn: true, login: "ada dev" });
});

test("a username cookie still counts as signed in", async () => {
  setCookie("dotcom_user", "ada");
  assert.deepEqual(await readBrowserSession(), { signedIn: true, login: "ada" });
});

test("no github cookies means signed out", async () => {
  assert.deepEqual(await readBrowserSession(), { signedIn: false, login: "" });
});
