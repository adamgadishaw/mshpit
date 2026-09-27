// Component-only visual regression: real RN Web controls/theme, synthetic hook states.
// No production calls, dist rebuild, credentials, or dependency installation.
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToString, renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "@babel/core";
import * as states from "./searchGrowthState.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const native = require("react-native-web");
let renderedState;
const moduleCache = new Map();
const knownFiles = new Set(["src/features/searchGrowth/SearchGrowthPanel.jsx", "src/components/Button.jsx", "src/theme.js"]);
function load(relative) {
  const filename = resolve(root, relative);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  assert.ok(knownFiles.has(relative.replaceAll("\\", "/")), "Unexpected component dependency: " + relative);
  const module = { exports: {} }; moduleCache.set(filename, module);
  const code = transformSync(readFileSync(filename, "utf8"), {
    filename, configFile: false, babelrc: false,
    plugins: [["@babel/plugin-transform-react-jsx", { runtime: "automatic" }], "@babel/plugin-transform-modules-commonjs"],
  }).code;
  const localRequire = id => {
    if (id === "react-native") return native;
    if (id === "./useSearchGrowth") return { __esModule: true, default: () => renderedState };
    if (id === "./searchGrowthState.mjs") return states;
    if (id === "./Icon") return { __esModule: true, default: () => null }; // This panel uses no icons.
    if (id === "./credential-form") return { CredentialSubmit: native.Pressable }; // Never submit mode.
    if (!id.startsWith(".")) return require(id);
    const candidate = resolve(dirname(filename), id);
    if (id.endsWith(".mjs")) return require(candidate);
    const resolved = [candidate, candidate + ".js", candidate + ".jsx"].find(existsSync);
    assert.ok(resolved, "Missing existing module: " + id);
    return load(resolved.slice(root.length + 1).replaceAll("\\", "/"));
  };
  new Function("module", "exports", "require", code)(module, module.exports, localRequire);
  return module.exports;
}
const Panel = load("src/features/searchGrowth/SearchGrowthPanel.jsx").default;
const status = {
  enabled: true, configured: true, mode: "monitor",
  connection: { state: "connected", property: "sc-domain:mshpit.com" },
  lastSuccessAt: Date.UTC(2026, 8, 27), nextRunAt: Date.UTC(2026, 8, 28), lastErrorCode: null, running: false,
  window: { startDate: "2026-08-25", endDate: "2026-09-21" },
  previousWindow: { startDate: "2026-07-28", endDate: "2026-08-24" },
  totals: { current: { clicks: 99, impressions: 18756, ctr: 99 / 18756, position: 18.54 }, previous: { clicks: 51, impressions: 13002, ctr: 51 / 13002, position: 21.13 } },
  truncated: true,
  opportunities: [{ path: "/artist/an-example-artist-with-a-long-page-name-for-layout-verification", clicks: 2, impressions: 439, ctr: 2 / 439, previousCtr: null, position: 8.44, score: 26.12, reason: "ctr_opportunity" }],
  limits: { maxPages: 1000, maxPrioritiesPerDay: 10, retentionDays: 90 },
  history: [{ at: Date.UTC(2026, 8, 27), outcome: "success", opportunities: 7 }],
  measurement: { state: "not_connected" },
};
const initial = states.emptySearchGrowthState("admin-a");
const available = { available: true, active: true, refresh: () => {}, setMode: () => {} };
const ready = data => ({ ...initial, ...available, confirmed: true, resource: { ...initial.resource, status: "ready", data } });
const cases = [
  ["ready", ready(status)],
  ["paused", ready({ ...status, mode: "paused" })],
  ["disabled", ready({ ...status, enabled: false, connection: { ...status.connection, state: "disabled" } })],
  ["unconfigured", ready({ ...status, enabled: false, configured: false, mode: "paused", lastSuccessAt: null, nextRunAt: null, connection: { state: "missing_credentials", property: "sc-domain:mshpit.com" }, totals: { current: null, previous: null }, window: null, previousWindow: null, opportunities: [], history: [], truncated: false })],
  ["refresh-error", { ...ready(status), confirmed: false, errorMessage: "Search Growth could not refresh. Any previous figures are a saved snapshot. Try again.", resource: { ...ready(status).resource, status: "stale" } }],
  ["saving", { ...ready(status), pendingMode: "prioritize" }],
  ["loading", { ...initial, ...available, resource: { ...initial.resource, status: "loading" } }],
  ["initial-error", { ...initial, ...available, errorMessage: "Search Growth could not refresh. Try again.", resource: { ...initial.resource, status: "error" } }],
];
native.AppRegistry.registerComponent("SearchGrowthFixture", () => () => React.createElement(Panel, {
  accountId: "admin-a", role: "admin", emailVerified: true, active: true,
}));
export async function main() {
  const modulePath = process.env.PIT_PLAYWRIGHT_MODULE;
  assert.ok(modulePath, "Set PIT_PLAYWRIGHT_MODULE to the existing Playwright installation.");
  const playwright = require(modulePath);
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.PIT_BROWSER_EXECUTABLE });
  const output = resolve(root, ".tmp"); mkdirSync(output, { recursive: true });
  const requests = [];
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
      const page = await context.newPage();
      for (const [name, state] of cases) {
        renderedState = state;
        const { element, getStyleElement } = native.AppRegistry.getApplication("SearchGrowthFixture");
        const html = "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>" +
          renderToStaticMarkup(getStyleElement()) +
          "<style>body{margin:0;background:#09090B}main{max-width:1080px;margin:auto;padding:12px;box-sizing:border-box}</style></head><body><main>" +
          renderToString(element) + "</main></body></html>";
        await page.setContent(html, { waitUntil: "load" });
        await page.getByTestId("search-growth-panel").waitFor({ state: "visible" });
        const dimensions = await page.evaluate(() => ({ screen: innerWidth, content: document.documentElement.scrollWidth }));
        assert.ok(dimensions.content <= dimensions.screen + 1, name + " horizontal overflow at " + width + ": " + JSON.stringify(dimensions));
        if (state.resource.data) {
          assert.equal(await page.getByText("Signup conversion measurement is not connected to this report yet.", { exact: false }).count(), 1);
          assert.equal(await page.getByRole("button", { name: "Prioritize pages Search Growth", exact: true }).isDisabled(), name !== "ready" && name !== "paused");
          if (name === "paused") assert.equal(await page.getByText("Next scheduled check: Paused", { exact: true }).count(), 1);
          if (name === "disabled") assert.equal(await page.getByText("Next scheduled check: Worker disabled", { exact: true }).count(), 1);
          if (name === "unconfigured") {
            assert.equal(await page.getByText("Google access not configured", { exact: true }).count(), 1);
            assert.equal(await page.getByText("No scheduled checks recorded yet.", { exact: true }).count(), 1);
          }
          if (name === "refresh-error") assert.equal(await page.getByText("99", { exact: true }).count(), 1);
          if (name === "ready" || name === "unconfigured") await page.screenshot({ path: resolve(output, "search-growth-component-" + name + "-" + width + ".png"), fullPage: true });
        }
        if (name === "loading") assert.equal(await page.getByText("Loading Search Growth…", { exact: true }).count(), 1);
        console.log("PASS component " + name + " at " + width + "px");
      }
      await context.close();
    }
    assert.deepEqual(requests, [], "Component fixture must not make any network request.");
    console.log("16 component-only checks passed; real RN Web/shared controls, synthetic hook states. No application/hook browser integration is claimed.");
  } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1; });
