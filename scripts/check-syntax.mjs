#!/usr/bin/env node

// Fast, dependency-free syntax gate for code Node executes directly. Expo's
// production export remains the parser/build gate for the React Native frontend.
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOTS = ["server", "scripts"];
const NODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (NODE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const files = ROOTS.flatMap(filesUnder).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
    process.exit(result.status || 1);
  }
}

console.log(`Syntax check passed (${files.length} Node files).`);
