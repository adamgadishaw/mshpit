import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
const source = readFileSync(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const stars = [];
const walk = node => { if (!node || typeof node !== "object") return; if (node.type === "JSXOpeningElement" && node.name.name === "TapStars") stars.push(node); for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") walk(value); };
walk(ast);
test("iOS overall and dimensional rating controls have distinct spoken labels", () => {
  assert.equal(stars.length, 3);
  const labels = stars.map(node => node.attributes.find(a => a.name?.name === "accessibilityLabel").value.expression);
  const evaluated = labels.map(expr => new Function("Platform", "d", `return (${source.slice(expr.start, expr.end)});`));
  assert.equal(evaluated[0]({ OS: "ios" }, {}), "Online performance rating");
  assert.equal(evaluated[1]({ OS: "ios" }, {}), "Overall experience rating");
  for (const label of ["Performance", "Crowd", "Sound", "Venue"]) assert.equal(evaluated[2]({ OS: "ios" }, { label }), `${label} rating`);
  for (const platform of ["android", "web"]) for (const fn of evaluated) assert.equal(fn({ OS: platform }, { label: "Sound" }), undefined);
});
