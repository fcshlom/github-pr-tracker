const AUTOPILOT_COOLDOWN_MS = 2 * 60 * 1000;

export function shouldAutopilotUpdate(pull, { enabled, now, lastAttemptAt }) {
  if (!enabled || !pull || coolingDown(now, lastAttemptAt)) {
    return false;
  }
  if (!pull.approved || !pull.autoMerge || !pull.needsUpdate || !pull.headSha || pull.hasConflicts) {
    return false;
  }
  return true;
}

export function isReadyToMerge(pull) {
  return Boolean(pull?.approved && !pull.needsUpdate && !pull.draft && !pull.hasConflicts && pull.canMerge);
}

export function shouldAutopilotMerge(pull, { enabled, now, lastAttemptAt }) {
  if (!enabled || coolingDown(now, lastAttemptAt)) {
    return false;
  }
  return isReadyToMerge(pull);
}

function coolingDown(now, lastAttemptAt) {
  // ponytail: skip for 2 minutes after an attempt so one PR is not merged or updated on every refresh. Upgrade path: retry when the orchestration reports finished.
  return Boolean(lastAttemptAt) && now - lastAttemptAt < AUTOPILOT_COOLDOWN_MS;
}
