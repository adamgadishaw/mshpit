import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./theme.js", import.meta.url), "utf8");
const PALETTES = ["STAGE", "DAYLIGHT", "NEON", "FOREST", "EMBER", "ICE", "ROSE", "MINT", "BACKSTAGE", "VINYL", "SUNSET", "LAVENDER"];

function palette(name) {
  const body = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`))?.[1];
  assert.ok(body, `Missing ${name} palette`);
  return Object.fromEntries([...body.matchAll(/(\w+):\s*"(#[0-9A-Fa-f]{6})"/g)].map((match) => [match[1], match[2]]));
}

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("secondary and semantic text colors meet WCAG AA on primary surfaces", () => {
  const failures = [];
  for (const name of PALETTES) {
    const colors = palette(name);
    for (const token of ["textFaint", "amber", "gold", "magenta", "cool", "good", "danger"]) {
      for (const surface of ["bg", "bgElev", "surface", "surfaceAlt"]) {
        const ratio = contrast(colors[token], colors[surface]);
        if (ratio < 4.5) failures.push(`${name}.${token} on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], `Theme text contrast regressed:\n${failures.join("\n")}`);
});

test("primary button fills retain readable dark labels", () => {
  const failures = [];
  for (const name of PALETTES) {
    const colors = palette(name);
    const ratio = contrast(colors.amberStrong, "#1A1206");
    if (ratio < 4.5) failures.push(`${name}.amberStrong: ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], `Primary button contrast regressed:\n${failures.join("\n")}`);
});
