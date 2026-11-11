const AUTOPILOT_COOLDOWN_MS = 2 * 60 * 1000;

export function shouldAutopilotUpdate(pull, { enabled, now, lastAttemptAt }) {
  if (!enabled || !pull) {
    return false;
  }
  if (!pull.approved || !pull.autoMerge || !pull.needsUpdate || !pull.headSha || pull.hasConflicts) {
    return false;
  }
  // ponytail: skip for 2 minutes after an attempt so a still-behind PR is not updated every refresh. Upgrade path: retry when the update orchestration reports finished.
  if (lastAttemptAt && now - lastAttemptAt < AUTOPILOT_COOLDOWN_MS) {
    return false;
  }
  return true;
}
