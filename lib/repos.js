const PAGE_CAP = 4;
const ORG_CAP = 8;

export function parseRepoHeadings(html) {
  const repos = [];
  const seen = new Set();
  const heading = /<h3[^>]*>\s*<a\b[^>]*\bhref="\/([^"/\s]+)\/([^"/\s]+)"/gi;
  for (const match of String(html || "").matchAll(heading)) {
    const repo = `${match[1]}/${match[2]}`;
    if (!seen.has(repo)) {
      seen.add(repo);
      repos.push(repo);
    }
  }
  return repos;
}

export function parseProfileOrgs(html) {
  const orgs = [];
  const seen = new Set();
  const hovercard = /data-hovercard-url="\/orgs\/([^"/\s]+)\/hovercard"/g;
  for (const match of String(html || "").matchAll(hovercard)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      orgs.push(match[1]);
    }
  }
  return orgs;
}

export function parseNextRepositoriesPage(html) {
  const match = String(html || "").match(/<a\b[^>]*\brel="next"[^>]*\bhref="([^"]+)"/i);
  const href = match?.[1] || "";
  if (!href.includes("tab=repositories")) {
    return "";
  }
  return href.replaceAll("&amp;", "&");
}

export async function listAccessibleRepos(login) {
  const name = String(login || "").trim();
  if (!name) {
    return [];
  }
  const firstUrl = `https://github.com/${encodeURIComponent(name)}?tab=repositories&type=all`;
  const first = await readGithubHtml(firstUrl);
  const repos = [];
  const seen = new Set();
  collectRepos(repos, seen, parseRepoHeadings(first));
  let next = parseNextRepositoriesPage(first);
  for (let page = 1; next && page < PAGE_CAP; page += 1) {
    const html = await readGithubHtml(new URL(next, "https://github.com").toString());
    collectRepos(repos, seen, parseRepoHeadings(html));
    next = parseNextRepositoriesPage(html);
  }
  // ponytail: org pages only expose the first screen of repositories in the HTML. Upgrade path: follow that page's own pagination if GitHub starts rendering a rel=next link.
  const orgs = parseProfileOrgs(first).slice(0, ORG_CAP);
  for (const org of orgs) {
    try {
      const html = await readGithubHtml(`https://github.com/orgs/${encodeURIComponent(org)}/repositories`);
      collectRepos(repos, seen, parseRepoHeadings(html).filter((repo) => repo.startsWith(`${org}/`)));
    } catch (_error) {
      // One organization page failing still leaves the profile repositories usable.
    }
  }
  return repos;
}

function collectRepos(repos, seen, found) {
  for (const repo of found) {
    if (!seen.has(repo)) {
      seen.add(repo);
      repos.push(repo);
    }
  }
}

async function readGithubHtml(url) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} while listing repositories.`);
  }
  return response.text();
}
