import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
const source = readFileSync(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const stars = [];
const walk = node => { if (!node || typeof node !== "object") return; if (node.type === "JSXOpeningElement" && node.name.name === "TapStars") stars.push(node); for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") walk(value); };
walk(ast);
test("overall and dimensional rating controls have distinct spoken labels on every platform", () => {
  assert.equal(stars.length, 3);
  const labels = stars.map(node => { const value = node.attributes.find(a => a.name?.name === "accessibilityLabel").value; return value.expression || value; });
  const evaluated = labels.map(expr => new Function("Platform", "d", `return (${source.slice(expr.start, expr.end)});`));
  for (const platform of ["ios", "android", "web"]) {
    assert.equal(evaluated[0]({ OS: platform }, {}), "Online concert rating");
    assert.equal(evaluated[1]({ OS: platform }, {}), "Overall concert rating");
    for (const label of ["Performance", "Crowd", "Sound", "Venue"]) assert.equal(evaluated[2]({ OS: platform }, { label }), `Detailed ${label} rating`);
  }
});
