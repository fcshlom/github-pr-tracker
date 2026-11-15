export function repoNames(items) {
  const names = [];
  const seen = new Set();
  for (const item of items || []) {
    const repo = item?.repo || "";
    if (repo && !seen.has(repo)) {
      seen.add(repo);
      names.push(repo);
    }
  }
  return names;
}

export function filterRepos(items, hiddenRepos) {
  if (!hiddenRepos || hiddenRepos.size === 0) {
    return items || [];
  }
  return (items || []).filter((item) => !hiddenRepos.has(item?.repo || ""));
}

export function matchesOpenFilter(item, filter) {
  if (filter === "approved") {
    return item?.category === "approved";
  }
  if (filter === "awaiting") {
    return item?.category === "awaiting";
  }
  if (filter === "draft") {
    return Boolean(item?.draft);
  }
  if (filter === "comments") {
    return Boolean(item?.hasComments);
  }
  if (filter === "behind") {
    return Boolean(item?.needsUpdate);
  }
  if (filter === "ci") {
    return Boolean(item?.ciFailed);
  }
  if (filter === "conflicts") {
    return Boolean(item?.hasConflicts);
  }
  if (filter === "automerge") {
    return Boolean(item?.autoMerge);
  }
  return true;
}

export function matchesOpenFilters(item, filters) {
  const entries = Object.entries(filters || {});
  if (!entries.length) {
    return true;
  }
  return entries.every(([filter, mode]) => {
    const hit = matchesOpenFilter(item, filter);
    return mode === "exclude" ? !hit : hit;
  });
}

export function filterOpen(open, filter) {
  const items = open || [];
  if (filter && typeof filter === "object") {
    return items.filter((item) => matchesOpenFilters(item, filter));
  }
  return items.filter((item) => matchesOpenFilter(item, filter));
}

export function githubCommentUrl(value) {
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

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
