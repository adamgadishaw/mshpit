import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { parse } from "@babel/parser";
import * as poster from "../domain/clipPoster.mjs";
const require = createRequire(import.meta.url);
const jsx = (type, props) => ({ type, props });
function nodes(tree) {
  if (!tree) return []; if (Array.isArray(tree)) return tree.flatMap(nodes); if (typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function component(file, platform = "ios") {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const modules = {
    react: { useMemo: fn => fn(), useEffect: () => {}, useRef: current => ({ current }), useState: initial => [typeof initial === "function" ? initial() : initial, () => {}] },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Platform: { OS: platform }, ActivityIndicator: "Spinner", View: "View", Text: "Text", Pressable: "Pressable", StyleSheet: { create: s => s, absoluteFill: {} }, useWindowDimensions: () => ({ width: 393 }) },
    "expo-image": { Image: "Image" }, "../theme": { colors: new Proxy({}, { get: () => "#111" }), mono: "mono" },
    "./Icon": "Icon", "./ClipPoster": "ClipPoster", "../lib/img": { displaySrc: u => u, previewSrc: u => u, isHttp: () => false, proxied: u => u, isVideoUrl: u => u?.endsWith(".mp4") },
    "../domain/imageLoadPolicy.mjs": { imageLoadPolicy: () => ({ priority: "normal", loading: "eager" }) },
    "../hooks/useImageAttempt": (_scope, candidates) => ({ uri: candidates[0] }),
    "../domain/clipPoster.mjs": poster, "../domain/posterVisibility.mjs": { posterGenerationEnabled: () => false },
    "../domain/postMediaGridLayout.mjs": { videoPosterContain: () => true },
    "../lib/videoPoster": { generateVideoPosterAsset: () => { throw new Error("Should not generate in render"); }, releaseVideoPosterAsset: () => {} },
    "../lib/videoPosterScheduler.mjs": {}, "../lib/videoPosterRetryPolicy.mjs": {}, "../lib/videoPosterAssetLease.mjs": {},
    "../lib/usePosterViewability": () => ({ targetRef: null, autoViewable: false, onLayout: () => {} }),
  };
  const code = transformSync(source, { filename: file, babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => { assert.ok(name in modules, name); return modules[name]; }, module, module.exports);
  return module.exports.default;
}

test("SmartImage passes explicit caller cache policy to image and video renditions", () => {
  const render = component("./SmartImage.jsx");
  for (const cachePolicy of ["none", "memory", "disk", "memory-disk"]) {
    const image = nodes(render({ uri: "file://photo.jpg", cachePolicy })).find(n => n.type === "Image");
    const video = nodes(render({ uri: "file://clip.mp4", cachePolicy, posterUri: "file://poster.jpg" })).find(n => n.type === "ClipPoster");
    assert.equal(image.props.cachePolicy, cachePolicy); assert.equal(video.props.cachePolicy, cachePolicy);
  }
});

test("iOS durable posters respect caller policy; public default and Android/web are unchanged", () => {
  for (const platform of ["ios", "android", "web"]) {
    const render = component("./ClipPoster.jsx", platform);
    for (const cachePolicy of [undefined, "none", "memory", "disk", "memory-disk"]) {
      const image = nodes(render({ uri: "file://clip.mp4", posterUri: "https://example.test/poster.jpg", cachePolicy })).find(n => n.type === "Image");
      assert.equal(image.props.cachePolicy, platform === "ios" ? cachePolicy || "memory-disk" : "memory-disk");
    }
  }
});

test("generated iOS posters never acquire disk storage and respect a no-cache caller", () => {
  const source = readFileSync(new URL("./ClipPoster.jsx", import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const expressions = [];
  const walk = node => { if (!node || typeof node !== "object") return; if (node.type === "JSXAttribute" && node.name.name === "cachePolicy") expressions.push(node.value.expression); for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") walk(value); };
  walk(ast); assert.equal(expressions.length, 2);
  const evaluate = new Function("Platform", "cachePolicy", `return (${source.slice(expressions[1].start, expressions[1].end)});`);
  for (const platform of ["ios", "android", "web"]) for (const policy of ["none", "memory", "disk", "memory-disk"]) {
    assert.equal(evaluate({ OS: platform }, policy), platform === "ios" && policy === "none" ? "none" : "memory");
  }
});
