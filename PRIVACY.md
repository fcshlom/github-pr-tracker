# Privacy policy

GitHub PR Tracker is a Chrome extension that shows pull requests you opened. It uses the GitHub account already signed in to this browser. It does not ask for a personal access token.

This policy describes the extension published by shlomi masuri. Contact: fcshlom@gmail.com.

## Data the extension handles

- **GitHub username.** Read from the `dotcom_user` cookie on `https://github.com/` when the username field is empty, and saved if you store it in Settings.
- **Sign-in check.** The `logged_in` cookie on `https://github.com/` is read only to see if its value is `yes`. The extension does not read the GitHub session token.
- **Repositories you enter.** The owner/repo list from Settings.
- **Pull request information from GitHub.** Titles, numbers, review state, comment and unresolved-thread counts, CI status, merge and conflict state, and the pull request URL. This is loaded from `https://github.com/` with your existing browser session.
- **Autopilot choice.** Which open pull requests you marked for an automatic branch update.

## Where it goes

- The username and repository list are stored in `chrome.storage.sync`. If Chrome Sync is on, Chrome may sync that data to your Google account.
- The pull request cache, notification links, and autopilot choice stay in `chrome.storage.local` on this browser.
- Requests are sent only to `https://github.com/`. The extension has no server of its own.
- The developer does not receive, sell, or use this data for advertising, analytics, or credit decisions.

## Permissions

- **cookies:** read `logged_in` and `dotcom_user` on `https://github.com/` only.
- **scripting:** if a GitHub action is rejected by the page security check, the extension retries that same request from a `github.com` tab. A tab opened only for that retry is closed afterward. No other sites are scripted.
- **notifications:** a local notification when an open pull request gets a new comment, a new approval, or a CI failure. Clicking it opens that pull request.
- **storage:** the settings and cache described above.
- **alarms:** refresh pull request status in the background.
- **Host access to `https://github.com/*`:** read pull request pages and perform the branch update or auto-merge action you request.

## Retention

Uninstalling the extension removes its local data. Data Chrome has already synced follows your Google account settings.
