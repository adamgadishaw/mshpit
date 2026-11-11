// Optional offline geometry gate. Uses installed Yoga; no package downloads or
// UI automation. Synthetic text metrics do not certify native glyph layout.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { parse } from "@babel/parser";
import { postCardPresentation } from "../src/domain/postCardPresentation.ios.mjs";
const require = createRequire(import.meta.url);
const ast = parse(readFileSync(new URL("../src/components/TicketStub.ios.jsx", import.meta.url), "utf8"), { sourceType: "module", plugins: ["jsx"] });
const declaration = ast.program.body.find(node => node.type === "VariableDeclaration" && node.declarations.some(value => value.id.name === "styles")).declarations.find(value => value.id.name === "styles");
const definitions = declaration.init.arguments[0].properties;
const style = name => Object.fromEntries(definitions.find(value => value.key.name === name).value.properties
  .filter(value => ["NumericLiteral", "StringLiteral"].includes(value.value?.type))
  .map(value => [value.key.name, value.value.value]));
const card = style("card"), row = style("contextTitleRow"), stacked = style("contextTitleStack"), title = style("performanceTitle"), score = style("scorePill");
assert.equal(row.flexDirection, "row"); assert.equal(stacked.flexDirection, "column");
assert.equal(style("contextIdentity").flex, 1); assert.equal(style("contextIdentityStack").flex, 0);
assert.equal(style("contextIdentityStack").alignSelf, "stretch"); assert.equal(score.alignSelf, "flex-start");
assert.equal(score.minWidth, 44); assert.equal(style("scoreStack").marginTop, 0);
const values = [card.padding, row.gap, stacked.gap, title.fontSize, title.lineHeight, score.minHeight];
assert.ok(values.every(Number.isFinite));
for (const width of [320, 375, 390, 430, 768]) for (const fontScale of [1, 1.3, 2, 3]) for (const length of [12, 55, 120]) {
  values.push(width, fontScale, length, Number(postCardPresentation({}, { width, fontScale }).stackContext));
}
const yoga = join(dirname(require.resolve("react-native/package.json")), "ReactCommon/yoga");
const cpp = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? cpp(join(directory, entry.name)) : entry.name.endsWith(".cpp") ? [join(directory, entry.name)] : []);
const temporary = mkdtempSync(join(tmpdir(), "mshpit-post-card-yoga-"));
const binary = join(temporary, "post-card-layout");
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, TMPDIR: temporary } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "iOS post-card geometry gate failed");
};
try {
  run("c++", ["-std=c++20", "-I", yoga, fileURLToPath(new URL("./fixtures/ios-post-card-layout.cpp", import.meta.url)), ...cpp(join(yoga, "yoga")), "-o", binary]);
  run(binary, values.map(String));
} finally { rmSync(temporary, { recursive: true, force: true }); }
