import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as domain from "../../domain/moderationConsole.mjs";

const require = createRequire(import.meta.url);
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const nativeWeb = require("react-native-web");
// Exercise the actual card and React Native Web text escaping, without loading
// the application Store or issuing any network/production requests.
const source = readFileSync(new URL("./ModerationConsole.jsx", import.meta.url), "utf8");
const code = transformSync(`${source}\nexport { ReportCard };`, {
  filename: "ModerationConsole.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const module = { exports: {} };
new Function("require", "module", "exports", code)(name => {
  if (name === "react-native") return nativeWeb;
  if (name === "../../domain/moderationConsole.mjs") return domain;
  if (name === "../../theme") return { colors: {}, mono: "monospace", radius: {}, space: value => value * 4 };
  if (name === "../../lib/img") return { isVideoUrl: () => false };
  if (["../Avatar", "../Badge", "../Icon", "../SmartImage"].includes(name)) return () => null;
  return require(name);
}, module, module.exports);

function render(report) {
  const [row] = domain.buildModerationReportRows([{ id: "synthetic", targetType: "post", targetId: "missing", reason: "Threats", ...report }]);
  return renderToStaticMarkup(React.createElement(module.exports.ReportCard, { row, selfId: "staff", canBan: false, busy: false }));
}
test("staff report card renders category and full multiline details as escaped selectable text", () => {
  const html = render({ category: "self_harm", details: 'First line\n<img src=x onerror="alert(1)"> & context 🎵' });
  assert.match(html, /CATEGORY/);
  assert.match(html, /self harm/);
  assert.match(html, /REPORTER DETAILS/);
  assert.match(html, /First line\n&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; context 🎵/);
  assert.doesNotMatch(html, /<img\b|<script\b/);
  assert.match(html, /REPORT REASON/);
  assert.match(html, /Threats/);
});
test("old reports omit empty new fields and retain the original reason", () => {
  const html = render({ category: null, details: null });
  assert.doesNotMatch(html, /REPORTER DETAILS|CATEGORY/);
  assert.match(html, /Threats/);
});
