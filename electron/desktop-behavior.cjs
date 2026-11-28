const DEFAULT_DESKTOP_BEHAVIOR_PREFERENCES = Object.freeze({
  closeToTray: true,
  unloadModelOnExit: true
});

function normalizeDesktopBehaviorPreferences(value) {
  if (value == null) return { ...DEFAULT_DESKTOP_BEHAVIOR_PREFERENCES };
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.closeToTray !== "boolean" ||
      typeof value.unloadModelOnExit !== "boolean") {
    throw new Error("Desktop behavior preferences must include closeToTray and unloadModelOnExit boolean values.");
  }
  return {
    closeToTray: value.closeToTray,
    unloadModelOnExit: value.unloadModelOnExit
  };
}

module.exports = {
  DEFAULT_DESKTOP_BEHAVIOR_PREFERENCES,
  normalizeDesktopBehaviorPreferences
};
