export async function readBrowserSession() {
  const loggedInCookie = await chrome.cookies.get({
    url: "https://github.com/",
    name: "logged_in",
  });
  const userCookie = await chrome.cookies.get({
    url: "https://github.com/",
    name: "dotcom_user",
  });
  const login = userCookie?.value ? decodeURIComponent(userCookie.value) : "";
  return {
    signedIn: loggedInCookie?.value === "yes" || Boolean(login),
    login,
  };
}
