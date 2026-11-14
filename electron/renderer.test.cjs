const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

test("the desktop renderer is plain HTML, CSS and ordered classic JavaScript", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");
  assert.match(html, /renderer\/app\.js/);
  assert.match(html, /src\/styles\.css/);
  assert.match(html, /<script defer src="\.\/renderer\/api\.js"><\/script>/);
  assert.match(html, /<script defer src="\.\/renderer\/shared\.js"><\/script>/);
  assert.doesNotMatch(html, /type="module"|vite|tsx|src\/main/);
  assert.doesNotMatch(app, /react|createRoot|jsx|vite|^import |^export /im);
  for (const page of ["chat","history","models","workspace","tasks","library","runtime","settings","preview"]) {
    const code = fs.readFileSync(path.join(root, "renderer", "pages", page + ".js"), "utf8");
    assert.doesNotMatch(code, /^import |^export /m, page + " page must be a classic script");
  }
});

test("renderer API uses only the narrow preload bridge for native commands", () => {
  const api = fs.readFileSync(path.join(root, "renderer", "api.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
  assert.match(api, /window\.syncAI/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("syncAI"/);
  assert.doesNotMatch(api, /node:|child_process|fs\.readFile/);
});
