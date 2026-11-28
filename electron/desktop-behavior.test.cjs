const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDesktopBehaviorPreferences
} = require("./desktop-behavior.cjs");

test("desktop behavior preferences default to tray close and graceful model unload", () => {
  assert.deepEqual(normalizeDesktopBehaviorPreferences(null), {
    closeToTray: true,
    unloadModelOnExit: true
  });
});

test("desktop behavior preferences validate both explicit choices", () => {
  assert.deepEqual(normalizeDesktopBehaviorPreferences({
    closeToTray: false,
    unloadModelOnExit: false,
    ignored: true
  }), {
    closeToTray: false,
    unloadModelOnExit: false
  });
  assert.throws(() => normalizeDesktopBehaviorPreferences({ closeToTray: true }), /boolean values/);
  assert.throws(() => normalizeDesktopBehaviorPreferences([]), /boolean values/);
});
