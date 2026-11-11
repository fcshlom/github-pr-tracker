export function diffPrAlerts(previous, openPrs) {
  const next = {};
  const events = [];
  const hasBaseline = previous && typeof previous === "object";

  for (const pull of openPrs || []) {
    if (!pull?.id) {
      continue;
    }
    const prior = hasBaseline ? previous[pull.id] : null;
    const commentCount = Number(pull.commentCount || 0);
    const approved = Boolean(pull.approved);
    const ciFailed = pull.ciKnown ? Boolean(pull.ciFailed) : Boolean(prior?.ciFailed);
    next[pull.id] = { commentCount, approved, ciFailed };

    if (!prior) {
      continue;
    }
    if (commentCount > Number(prior.commentCount || 0)) {
      events.push({
        type: "comments",
        id: pull.id,
        delta: commentCount - Number(prior.commentCount || 0),
        pull,
      });
    }
    if (approved && !prior.approved) {
      events.push({ type: "approved", id: pull.id, pull });
    }
    if (pull.ciKnown && pull.ciFailed && !prior.ciFailed) {
      events.push({ type: "ci", id: pull.id, pull });
    }
  }

  return { events: hasBaseline ? events : [], next };
}
