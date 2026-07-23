import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] || ".";
const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(p)) out.push(p);
  }
  return out;
};

const files = walk(join(ROOT, "src")).concat([join(ROOT, "App.js")]);
const PROPS = [
  "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "paddingHorizontal", "paddingVertical", "margin", "marginTop", "marginBottom",
  "marginLeft", "marginRight", "marginHorizontal", "marginVertical",
  "gap", "rowGap", "columnGap",
];
const re = new RegExp(`\\b(${PROPS.join("|")}):\\s*(-?[0-9.]+)`, "g");

const counts = {};
const offScale = {};
const perFile = {};
const byProp = {};
let total = 0;

for (const f of files) {
  const text = readFileSync(f, "utf8");
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    const prop = m[1];
    const v = Number(m[2]);
    total++; n++;
    counts[v] = (counts[v] || 0) + 1;
    (byProp[prop] ||= {})[v] = (byProp[prop][v] || 0) + 1;
    if (v !== 0 && v % 4 !== 0) offScale[v] = (offScale[v] || 0) + 1;
  }
  if (n) perFile[f] = n;
}

console.log("total hardcoded spacing values:", total);
console.log("distinct values:", Object.keys(counts).length);
console.log("\ndistribution:");
console.log(Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0]))
  .map(([v, c]) => `${v}:${c}`).join("  "));

const offTotal = Object.values(offScale).reduce((a, b) => a + b, 0);
console.log(`\nOFF-SCALE (not a multiple of 4): ${offTotal} of ${total} (${Math.round(offTotal / total * 100)}%)`);
console.log(Object.entries(offScale).sort((a, b) => b[1] - a[1])
  .map(([v, c]) => `${v}(${c})`).join(", "));

console.log("\nvalues used per property (drift shows as many distinct values):");
for (const [prop, vals] of Object.entries(byProp).sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length).slice(0, 8)) {
  const distinct = Object.keys(vals).length;
  console.log(`  ${prop.padEnd(20)} ${String(distinct).padStart(2)} distinct  ${Object.entries(vals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, c]) => `${v}x${c}`).join(" ")}`);
}

console.log("\nworst files:");
for (const [f, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${f}`);
}
console.log("\nfiles importing space():",
  files.filter((f) => /\bspace\b/.test(readFileSync(f, "utf8")) && /from "\.\.?\/(\.\.\/)?theme"/.test(readFileSync(f, "utf8"))).length,
  "of", files.length);
