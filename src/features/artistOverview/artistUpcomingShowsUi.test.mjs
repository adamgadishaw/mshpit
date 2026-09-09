import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";

// Exercise the real component with React Native Web, not a reimplementation of
// its markup. Only the platform package name and decorative SVG are adapted.
const require = createRequire(import.meta.url);
const React = require("react");
const RN = require("react-native-web");
const ReactDOMServer = require("react-dom/server");
const babel = require("@babel/core");
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = babel.transformSync(readFileSync(file, "utf8"), {
    filename: file, babelrc: false, configFile: false,
    plugins: [[require.resolve("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require.resolve("@babel/plugin-transform-modules-commonjs")],
  }).code;
  const localRequire = (name) => {
    if (name === "react-native") return RN;
    if (name === "react-native-svg") {
      const svg = { __esModule: true, default: (props) => React.createElement("svg", props) };
      for (const tag of ["Path", "Circle", "Line", "Polyline", "Polygon", "Rect"]) svg[tag] = (props) => React.createElement(tag.toLowerCase(), props);
      return svg;
    }
    if (!name.startsWith(".")) return require(name);
    const base = resolve(dirname(file), name);
    const target = [base, base + ".jsx", base + ".js", base + ".mjs"].find((value) => existsSync(value) && statSync(value).isFile());
    if (!target) throw new Error(`Missing component dependency: ${name}`);
    return load(target);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}
const ArtistUpcomingShows = load(fileURLToPath(new URL("../../components/artist/ArtistUpcomingShows.jsx", import.meta.url))).default;
const noop = () => {};
function render({ count = 4, status = "ready", condensed = false, coverage = "fresh", legacy = false, moreError = null, countryCode = "", city = "", customCopy = null, eventStatus = null, errorCode = "PIT-NET-001", serverCode = null, hasSchedule = status !== "loading" } = {}) {
  const items = Array.from({ length: count }, (_, index) => ({ id: `show-${index}`, artist: "Example", eventName: "Example at the Hall", venue: "The Hall", place: "Toronto, Ontario, Canada", date: "2026-10-01", startLocalTime: "2026-10-01T19:30:00", ticketUrl: "https://www.ticketmaster.ca/event/123", eventStatus }));
  const controller = { resource: { status, error: status === "error" ? { code: errorCode, serverCode } : null, data: hasSchedule ? { schedule: { items, total: count, legacy, hasMore: count > 3, coverage: { status: coverage } } } : null }, countryCode, city, moreError, reload: noop, refresh: noop, loadMore: noop, setLocation: noop };
  return ReactDOMServer.renderToStaticMarkup(React.createElement(ArtistUpcomingShows, { controller, artistName: "Example", condensed, onViewAll: noop, onOpenShow: noop, copy: customCopy }));
}

test("overview is three rows maximum but View all remains available for two or three shows", () => {
  for (const count of [2, 3, 4, 12]) {
    const html = render({ count, condensed: true });
    assert.equal((html.match(/data-testid="artist-show-/g) || []).length, Math.min(3, count));
    assert.match(html, /View all shows/);
    assert.doesNotMatch(html, /More shows/);
  }
});
test("show details and tickets remain separate real anchors with local event time", () => {
  const html = render({ count: 1 });
  assert.match(html, /href="\/event\/show-0"/);
  assert.match(html, /href="https:\/\/www.ticketmaster.ca\/event\/123"/);
  assert.match(html, /7:30 PM/);
  assert.match(html, /Toronto, Ontario, Canada/);
});
test("loading, empty, partial coverage and stale errors have distinct rendered wording", () => {
  assert.match(render({ status: "loading" }), /Loading show dates/);
  assert.doesNotMatch(render({ status: "loading" }), /No upcoming dates/);
  assert.match(render({ count: 0 }), /No upcoming dates are listed here yet/);
  assert.match(render({ count: 0, city: "Paris", countryCode: "FR" }), /No dates are listed for this location/);
  assert.match(render({ coverage: "partial" }), /Some dates may be missing/);
  const stale = render({ status: "error" });
  assert.match(stale, /Showing the last loaded dates/);
  assert.match(stale, /PIT-NET-001/);
  assert.match(stale, /data-testid="artist-show-show-0"/);
});
test("legacy and memorial schedules render no live controls", () => {
  assert.equal(render({ legacy: true }), "");
  assert.equal(render({ coverage: "disabled" }), "");
});

test("missing catalog is not an empty schedule or a temporary server failure", () => {
  const missing = render({ status: "error", errorCode: "PIT-REQ-002", hasSchedule: false });
  assert.match(missing, /catalog record is unavailable/);
  assert.match(missing, /Go back and search for the artist again/);
  assert.match(missing, /PIT-REQ-002/);
  assert.doesNotMatch(missing, /No upcoming dates|Show dates could not load|data-testid="artist-show-/);
  const serverFailure = render({ status: "error", errorCode: "PIT-SVC-001", hasSchedule: false });
  assert.match(serverFailure, /Show dates could not load/);
  assert.doesNotMatch(serverFailure, /catalog record is unavailable|No upcoming dates/);
  assert.match(render({ count: 0 }), /No upcoming dates are listed here yet/);
  assert.match(render({ status: "error", serverCode: "NOT_FOUND", hasSchedule: false }), /catalog record is unavailable/);
});

test("catalog disappearance retains prior dates with an explicit unconfirmed warning", () => {
  const html = render({ status: "error", errorCode: "PIT-REQ-002" });
  assert.match(html, /Showing the last loaded dates/);
  assert.match(html, /catalog record is unavailable/);
  assert.match(html, /these dates could not be confirmed/);
  assert.match(html, /data-testid="artist-show-show-0"/);
  assert.doesNotMatch(html, /No upcoming dates/);
  assert.match(render({ status: "error", errorCode: "PIT-REQ-002", hasSchedule: false,
    customCopy: { catalogUnavailable: "Artist record is being checked." },
  }), /Artist record is being checked/);
});
test("cancelled shows keep their status and show page but never offer tickets", () => {
  const html = render({ count: 1, eventStatus: "cancelled" });
  assert.match(html, /Cancelled/);
  assert.match(html, /href="\/event\/show-0"/);
  assert.doesNotMatch(html, /href="https:\/\/www.ticketmaster/);
});
test("page failure has a retry and custom wording replaces default copy", () => {
  const html = render({ moreError: { code: "PIT-NET-001" }, customCopy: { title: "Next on stage" } });
  assert.match(html, /Next on stage/);
  assert.match(html, /More dates could not load/);
  assert.match(html, /Try again/);
});
