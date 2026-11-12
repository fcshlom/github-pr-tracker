export function filterOpen(open, filter) {
  if (filter === "approved") {
    return open.filter((item) => item.category === "approved");
  }
  if (filter === "awaiting") {
    return open.filter((item) => item.category === "awaiting");
  }
  if (filter === "comments") {
    return open.filter((item) => item.hasComments);
  }
  if (filter === "behind") {
    return open.filter((item) => item.needsUpdate);
  }
  return open;
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
