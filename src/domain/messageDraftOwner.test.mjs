import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createIOSMessageDrafts } from "./iosMessageDrafts.mjs";
import { createIOSMessageDrafts as createIOSOwner } from "./messageDraftOwner.ios.js";
import { createIOSMessageDrafts as createDefaultOwner } from "./messageDraftOwner.js";

const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");
const { resolve } = require("metro-resolver");
const appPath = fileURLToPath(new URL("../../App.js", import.meta.url));
const app = readFileSync(appPath, "utf8");
const ast = parse(app, { sourceType: "module", plugins: ["jsx"] });
const root = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id?.name === "Root");
function findNodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...Object.values(node).flatMap(value => Array.isArray(value)
      ? value.flatMap(child => findNodes(child, predicate)) : findNodes(value, predicate)),
  ];
}
const isFactoryCall = node => node.type === "CallExpression" && node.callee?.name === "createIOSMessageDrafts";
const initialization = root.body.body.filter(node => node.type === "IfStatement" && findNodes(node, isFactoryCall).length);
const initialize = new Function("Platform", "messageDraftsRef", "communityDraftsRef", "createIOSMessageDrafts", "session", "chatAuthEpoch", "messageDraftsMountedRef", "refreshDraftCapacity",
  initialization.map(node => app.slice(node.start, node.end)).join("\n"));
const resolverContext = {
  originModulePath: appPath,
  assetExts: new Set(), sourceExts: ["js", "jsx", "mjs", "json", "ts", "tsx"], preferNativePlatform: true,
  mainFields: ["react-native", "browser", "main"], getPackageForModule: () => null,
  fileSystemLookup(path) {
    try { const stat = statSync(path); return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(path) }; }
    catch { return { exists: false }; }
  },
};

// This verifies the actual export, not a duplicate or wrapped implementation.
test("iOS platform entry preserves the existing draft factory identity", () => {
  assert.equal(createIOSOwner, createIOSMessageDrafts);
});

test("default draft owner is inert and has no runtime imports or initialization", () => {
  const source = readFileSync(new URL("./messageDraftOwner.js", import.meta.url), "utf8");
  const body = parse(source, { sourceType: "module" }).program.body;
  assert.equal(body.length, 1);
  assert.equal(body[0].type, "ExportNamedDeclaration");
  const factory = body[0].declaration.declarations[0].init;
  assert.equal(factory.type, "ArrowFunctionExpression");
  assert.equal(factory.body.type, "NullLiteral");
  const options = new Proxy({}, { get() { assert.fail("Fallback must not inspect options or register a callback"); } });
  assert.equal(createDefaultOwner(), null);
  assert.equal(createDefaultOwner(options), null);
});

test("installed Metro resolves the draft domain only through the iOS entry", () => {
  for (const platform of ["ios", "android", "web"]) {
    const entry = resolve(resolverContext, "./src/domain/messageDraftOwner", platform);
    assert.equal(entry.filePath, fileURLToPath(new URL(`./messageDraftOwner${platform === "ios" ? ".ios" : ""}.js`, import.meta.url)));
    const body = parse(readFileSync(entry.filePath, "utf8"), { sourceType: "module" }).program.body;
    const dependencies = body.filter(node => node.source).map(node => resolve({ ...resolverContext, originModulePath: entry.filePath }, node.source.value, platform).filePath);
    assert.deepEqual(dependencies, platform === "ios" ? [fileURLToPath(new URL("./iosMessageDrafts.mjs", import.meta.url))] : []);
  }
});

test("App imports the platform boundary and keeps both owner constructors behind iOS guards", () => {
  const imports = ast.program.body.filter(node => node.type === "ImportDeclaration");
  const boundary = imports.find(node => node.source.value === "./src/domain/messageDraftOwner");
  assert.ok(boundary);
  assert.deepEqual(boundary.specifiers.map(node => node.local.name), ["createIOSMessageDrafts"]);
  assert.equal(imports.some(node => node.source.value === "./src/domain/iosMessageDrafts.mjs"), false);
  assert.equal(findNodes(ast.program, isFactoryCall).length, 2);
  assert.equal(initialization.length, 2);
  for (const block of initialization) {
    assert.equal(app.slice(block.test.start, block.test.end), 'Platform.OS === "ios"');
    assert.equal(findNodes(block, isFactoryCall).length, 1);
  }
});

for (const platform of ["android", "web"]) {
  test(`${platform} Root initialization never constructs or accounts an iOS message owner`, () => {
    const messages = { current: null }, community = { current: null };
    const unexpected = () => assert.fail("Non-iOS initialization must remain inert");
    for (const session of [null, { id: "A" }, { id: "B" }]) {
      initialize({ OS: platform }, messages, community, unexpected, session, 1, { current: true }, unexpected);
    }
    assert.equal(messages.current, null);
    assert.equal(community.current, null);
  });
}

test("iOS Root retains separate draft owners and pending claims across rerenders, fencing auth changes", () => {
  const messages = { current: null }, community = { current: null };
  let constructions = 0;
  const factory = options => { constructions += 1; return createIOSOwner(options); };
  const render = (id = "A", epoch = 1) => initialize({ OS: "ios" }, messages, community, factory, id ? { id } : null, epoch, { current: true }, () => {});
  render();
  const originalMessages = messages.current, originalCommunity = community.current;
  assert.notEqual(originalMessages, originalCommunity);
  const dm = originalMessages.lease("same-target"), club = originalCommunity.lease("same-target");
  dm.edit("message draft"); club.edit("community draft");
  const claim = dm.claim();
  render();
  assert.equal(constructions, 2);
  assert.equal(messages.current, originalMessages);
  assert.equal(community.current, originalCommunity);
  assert.equal(messages.current.lease("same-target"), dm);
  assert.equal(dm.claim(), null);
  assert.equal(dm.read().sending, true);
  assert.equal(club.read().text, "community draft");
  render("A", 2);
  const fresh = messages.current.lease("same-target"); fresh.edit("fresh draft");
  dm.settle(claim, { ok: true }); club.edit("stale edit");
  assert.equal(fresh.read().text, "fresh draft");
  assert.equal(community.current.lease("same-target").read().text, "");
  assert.equal(constructions, 2);
});
