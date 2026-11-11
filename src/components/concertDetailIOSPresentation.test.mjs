import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { parse } from "@babel/parser";
import { concertDetailStyles, concertDetailWide } from "./concertDetailIOSPresentation.mjs";

const require = createRequire(import.meta.url);
const sources = Object.fromEntries(["show", "venue"].map((kind) => [kind,
  readFileSync(new URL(`../screens/${kind === "show" ? "Show" : "Venue"}Screen.jsx`, import.meta.url), "utf8"),
]));
function styleFixture(kind, os) {
  const source = sources[kind];
  return new vm.Script(source.slice(source.indexOf("const baseStyles = {")) + "\n({ baseStyles, styles });").runInNewContext({
    Platform: { OS: os, select: (options) => options[os] || options.default },
    StyleSheet: { create: (value) => value, absoluteFillObject: {} },
    colors: new Proxy({}, { get: (_, name) => String(name) }),
    radius: {}, space: (value) => value * 4, shadow: {}, mono: "mono", displayFont: "display",
    concertDetailStyles,
  });
}

test("Android and web retain the exact base show and venue styles", () => {
  for (const kind of ["show", "venue"]) for (const os of ["android", "web"]) {
    const { baseStyles, styles } = styleFixture(kind, os);
    assert.equal(styles, baseStyles);
  }
});

test("iOS show uses readable full-width date/venue context and real 44pt controls", () => {
  const { styles: s, baseStyles } = styleFixture("show", "ios");
  assert.equal(s.stubRow.flexDirection, "column");
  assert.equal(s.stubDateColumn.maxWidth, "100%");
  assert.equal(s.artist.fontFamily, "System");
  assert.equal(s.notch.display, "none");
  for (const name of ["reviewUnavailableRetry", "ticketsBtn", "goingBtn", "loungeBtn"]) assert.ok(s[name].minHeight >= 44, name);
  for (const name of ["reviewMediaArrow", "previewBtn"]) assert.ok(s[name].width >= 44 && s[name].height >= 44, name);
  assert.equal(baseStyles.previewBtn.width, 26, "base styles are not mutated");
});

test("iOS venue sections wrap and scaled counts have no fixed height", () => {
  const { styles: s } = styleFixture("venue", "ios");
  assert.equal(s.sectionNav.flexWrap, "wrap");
  assert.equal(s.sectionNavItem.minHeight, 48);
  assert.equal(s.heroMeta.flexDirection, "column");
  assert.equal(s.countPill.height, "auto");
  assert.equal(s.reviewReportBtn.width, 44);
  assert.ok(s.guideActionBody.fontSize >= 15);
});

test("live text-size changes stack iOS columns without changing other platforms", () => {
  for (const threshold of [720, 760]) {
    for (const scale of [1, 2, 3.1, 1]) {
      assert.equal(concertDetailWide(900, scale, "ios", threshold), scale < 1.4);
      assert.equal(concertDetailWide(900, scale, "android", threshold), true);
      assert.equal(concertDetailWide(900, scale, "web", threshold), true);
      assert.equal(concertDetailWide(390, scale, "ios", threshold), false);
    }
  }
});

function publicEventFixture(os, cancelled = false) {
  const ast = parse(sources.show, { sourceType: "module", plugins: ["jsx"] });
  const node = ast.program.body.find((entry) => entry.type === "FunctionDeclaration" && entry.id.name === "PublicEventSnapshotPanel");
  const code = require("@babel/core").transformSync(sources.show.slice(node.start, node.end) + "\nmodule.exports = PublicEventSnapshotPanel;", {
    babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code;
  const opened = [], module = { exports: {} }, jsx = (type, props) => ({ type, props });
  new vm.Script(code).runInNewContext({
    module, exports: module.exports, require: () => ({ jsx, jsxs: jsx }),
    Platform: { OS: os }, styles: {}, colors: {}, Date,
    ScrollView: "ScrollView", View: "View", Text: "Text", Pressable: "Pressable", Icon: "Icon", ActivityIndicator: "ActivityIndicator", CatalogText: "CatalogText",
    showLifecycleView: () => ({ lifecycle: cancelled ? "cancelled" : "upcoming" }),
    formatDate: (date, fallback) => date || fallback,
    restrictedShowAvailabilityCopy: () => null, // Unrestricted legacy panel; actual iOS restriction is covered by the screen fixture.
    useIOSTicketAction: () => ({ open: (url) => opened.push(url), error: "" }),
  });
  return { render: module.exports, opened };
}
function descendants(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(descendants)];
}

test("public event ticket links retain cancellation protection and external-link owner", () => {
  for (const os of ["ios", "android", "web"]) for (const cancelled of [false, true]) {
    const f = publicEventFixture(os, cancelled);
    const tree = f.render({ event: { name: "The night", venue: "The room", date: "2026-12-01", ticketUrl: "https://tickets.example/show" }, status: "ready" });
    const links = descendants(tree).filter((node) => node.props.accessibilityRole === "link");
    assert.equal(links.length, cancelled ? 0 : 1);
    if (!cancelled) {
      links[0].props.onPress();
      assert.deepEqual(f.opened, ["https://tickets.example/show"]);
      assert.match(links[0].props.accessibilityLabel, os === "ios" ? /View tickets at seller/ : /Get tickets/);
    }
  }
});

test("public event loading and error states retain actionable retries", () => {
  const f = publicEventFixture("ios");
  let retried = 0;
  for (const status of ["loading", "error"]) {
    const tree = f.render({ event: null, status, onRetry: () => retried++ });
    const retry = descendants(tree).find((node) => node.props.accessibilityLabel === "Retry loading event details");
    assert.equal(!!retry, status === "error");
    retry?.props.onPress();
  }
  assert.equal(retried, 1);
});
