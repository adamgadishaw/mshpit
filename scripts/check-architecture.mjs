#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_FILE), "..");
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const ROOT_RUNTIME_FILES = Object.freeze(["App.js", "index.js"]);
const PLATFORM_SUFFIX = /\.(?:android|ios|native|web)$/;
const EMPTY_CATCH_EXPLANATION = /architecture:\s*allow-empty-catch\s*--\s*\S.{7,}/i;
const AMBIGUOUS_RESULT_EXPLANATION = /architecture:\s*allow-ambiguous-result\s*--\s*\S.{7,}/i;
const CANONICAL_CONTRACTS = Object.freeze({
  "src/domain/loadState.mjs": Object.freeze([
    "beginLoadState",
    "createLoadState",
    "isLoadCancellation",
    "projectLoadState",
    "rejectLoadState",
    "resolveLoadState",
  ]),
  "src/domain/commandResult.mjs": Object.freeze([
    "commandFailure",
    "commandSuccess",
    "isAppErrorLike",
  ]),
});
const LOAD_STATE_HELPERS = new Set(CANONICAL_CONTRACTS["src/domain/loadState.mjs"]);
const CANONICAL_EXPORT_NAMES = new Set(Object.values(CANONICAL_CONTRACTS).flat());

const normalizedPath = (value) => value.split(sep).join("/");
const projectPath = (root, value) => normalizedPath(relative(root, value));
const isTestFile = (file) => /\.test\.[^.]+$/.test(basename(file));
const isClientRuntimePath = (path) => path.startsWith("src/") || ROOT_RUNTIME_FILES.includes(path);

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (CODE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function productionFiles(root) {
  return [
    ...["src", "server"].flatMap((directory) => filesUnder(resolve(root, directory))),
    ...ROOT_RUNTIME_FILES.map((path) => resolve(root, path)).filter((path) => existsSync(path)),
  ]
    .filter((file) => !isTestFile(file))
    .sort();
}

function occurrences(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

export function extractStoreStateHooks(source) {
  const hooks = [];
  const pattern = /\b(?:const|let)\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*((?:React\.)?use[A-Z][\w$]*)\s*\(/g;
  for (const match of source.matchAll(pattern)) hooks.push(`${match[3]}:${match[1]}:${match[2]}`);
  return hooks;
}

export function extractStoreHookCalls(source) {
  const hooks = [];
  const pattern = /\b((?:React\.)?use[A-Z][A-Za-z0-9_$]*)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const prefix = source.slice(Math.max(0, match.index - 24), match.index);
    if (/\bfunction\s*$/.test(prefix)) continue;
    hooks.push(match[1]);
  }
  return hooks;
}

export function extractInlineApiRoutes(source) {
  const routes = [];
  const pattern = /(["'`])((?:GET|POST|PUT|PATCH|DELETE) \/api(?:\/[^"'`\r\n]*)?)\1/g;
  for (const match of source.matchAll(pattern)) routes.push(match[2]);
  return routes;
}

function importSpecifiers(source) {
  const found = [];
  const fromPattern = /^\s*(?:import|export)\s+[^;]*?\bfrom\s*["']([^"']+)["']/gm;
  const sideEffectPattern = /^\s*import\s*["']([^"']+)["']/gm;
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const requirePattern = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [fromPattern, sideEffectPattern, dynamicPattern, requirePattern]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return [...new Set(found)];
}

function resolveProjectImport(root, sourceFile, specifier) {
  if (specifier.startsWith(".")) return projectPath(root, resolve(dirname(sourceFile), specifier));
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  if (/^(?:src|server)\//.test(specifier)) return normalizedPath(specifier);
  return null;
}

function sameModule(target, canonicalPath) {
  if (!target) return false;
  const withoutExtension = canonicalPath.slice(0, -extname(canonicalPath).length);
  return target === canonicalPath || target === withoutExtension;
}

function layerViolation(root, sourceFile, specifier) {
  const source = projectPath(root, sourceFile);
  const target = resolveProjectImport(root, sourceFile, specifier);
  if (!target) return null;
  const sourceFeature = source.match(/^src\/features\/([^/]+)\//)?.[1] || null;
  const targetFeature = target.match(/^src\/features\/([^/]+)\//)?.[1] || null;

  if (isClientRuntimePath(source) && target.startsWith("server/")) {
    return { source, target, reason: "client code cannot import server runtime code" };
  }
  if (source.startsWith("src/domain/") && !target.startsWith("src/domain/")) {
    return { source, target, reason: "domain code may depend only on domain code" };
  }
  if (source.startsWith("src/lib/") && /^(?:src\/(?:components|features|screens)\/|src\/store(?:$|\.|\/))/.test(target)) {
    return { source, target, reason: "shared adapters cannot depend on UI, features, or the legacy store" };
  }
  if (source.startsWith("src/components/") && /^(?:src\/(?:features|screens)\/|src\/store(?:$|\.|\/))/.test(target)) {
    return { source, target, reason: "shared UI cannot depend on screens, features, or the legacy store" };
  }
  if (sourceFeature && /^(?:src\/screens\/|src\/store(?:$|\.|\/))/.test(target)) {
    return { source, target, reason: "feature slices cannot depend on screens or the legacy store" };
  }
  if (sourceFeature && targetFeature && sourceFeature !== targetFeature) {
    return { source, target, reason: "feature slices cannot reach into another feature slice" };
  }
  if (source.startsWith("server/") && target.startsWith("src/") && !target.startsWith("src/domain/")) {
    return { source, target, reason: "server code may share only platform-neutral domain modules with the client" };
  }
  return null;
}

function importViolations(root, files) {
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const violation = layerViolation(root, file, specifier);
      if (!violation) continue;
      violations.push({ ...violation, id: `${violation.source} -> ${violation.target}` });
    }
  }
  return violations.sort((a, b) => a.id.localeCompare(b.id));
}

function fileNameViolations(root, files) {
  const violations = [];
  for (const file of files) {
    const path = projectPath(root, file);
    const extension = extname(file);
    let stem = basename(file, extension).replace(PLATFORM_SUFFIX, "");
    let expected = null;

    if (/^src\/(?:components|features|screens)\//.test(path) && [".jsx", ".tsx"].includes(extension)) {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(stem)) expected = "PascalCase JSX";
    } else if (/^(?:src\/(?:domain|features|lib)\/|server\/)/.test(path)) {
      if (stem !== "index" && !/^[a-z][A-Za-z0-9]*$/.test(stem)) expected = "lowerCamelCase module";
    }

    if (expected) violations.push({ id: path, path, expected });
  }
  return violations.sort((a, b) => a.id.localeCompare(b.id));
}

function lineWindow(source, start, end) {
  const currentLineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const previousLineStart = source.lastIndexOf("\n", Math.max(0, currentLineStart - 2)) + 1;
  const nextLineEnd = source.indexOf("\n", end);
  return source.slice(previousLineStart, nextLineEnd === -1 ? source.length : nextLineEnd);
}

function unexplainedEmptyCatchRanges(source) {
  const ranges = [];
  const patterns = [
    /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
    /\.catch\s*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*\}\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!EMPTY_CATCH_EXPLANATION.test(lineWindow(source, start, end))) {
        ranges.push({ start, end, kind: match[0].startsWith(".catch") ? "promise" : "block" });
      }
    }
  }
  return ranges;
}

export function unexplainedEmptyCatchCount(source) {
  return unexplainedEmptyCatchRanges(source).length;
}

function normalizedCatchContext(source, start, end) {
  const lines = source.split(/\r?\n/);
  const before = source.slice(0, start);
  const firstLine = before.split(/\r?\n/).length - 1;
  const lastLine = firstLine + source.slice(start, end).split(/\r?\n/).length - 1;
  return lines
    .slice(Math.max(0, firstLine - 2), Math.min(lines.length, lastLine + 2))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function emptyCatchSnapshot(root, files) {
  const snapshot = {};
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const signatures = unexplainedEmptyCatchRanges(source)
      .map(({ start, end, kind }) => `${kind}:${digest(normalizedCatchContext(source, start, end))}`)
      .sort();
    if (signatures.length) {
      snapshot[projectPath(root, file)] = {
        count: signatures.length,
        fingerprint: digest(signatures.join("\n")),
      };
    }
  }
  return snapshot;
}

function structuralMask(source) {
  const output = [...source];
  let state = "code";
  let quote = "";
  let escaped = false;
  let regexClass = false;

  const mask = (index) => {
    if (source[index] !== "\n" && source[index] !== "\r") output[index] = " ";
  };
  const regexCanStart = (index) => {
    const prefix = output.slice(Math.max(0, index - 60), index).join("");
    return /(?:^|[=(:,!&|?;{}\[\]\n]|\b(?:return|throw|case|delete|void|typeof|instanceof|in|of))\s*$/.test(prefix);
  };
  const stringCanStart = (index) => {
    const prefix = output.slice(Math.max(0, index - 60), index).join("");
    return /(?:^|[=(:,+!&|?;{}\[\]\n]|\b(?:return|throw|case|yield|from|import|export))\s*$/.test(prefix);
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      mask(index);
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      mask(index);
      if (char === "*" && next === "/") {
        mask(index + 1);
        index += 1;
        state = "code";
      }
      continue;
    }
    if (state === "string") {
      mask(index);
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) state = "code";
      continue;
    }
    if (state === "regex") {
      mask(index);
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "[") regexClass = true;
      else if (char === "]") regexClass = false;
      else if (char === "/" && !regexClass) {
        state = "code";
        while (/[A-Za-z]/.test(source[index + 1] || "")) {
          mask(index + 1);
          index += 1;
        }
      }
      continue;
    }
    if (char === "/" && next === "/") {
      mask(index);
      mask(index + 1);
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      mask(index);
      mask(index + 1);
      index += 1;
      state = "block-comment";
    } else if (char === "`" || ((char === "'" || char === '"') && stringCanStart(index))) {
      mask(index);
      quote = char;
      escaped = false;
      state = "string";
    } else if (char === "/" && regexCanStart(index)) {
      mask(index);
      escaped = false;
      regexClass = false;
      state = "regex";
    }
  }
  return output.join("");
}

function delimiterRanges(masked, openCharacter, closeCharacter) {
  const stack = [];
  const ranges = [];
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === openCharacter) stack.push(index);
    else if (masked[index] === closeCharacter && stack.length) {
      ranges.push({ start: stack.pop(), end: index + 1 });
    }
  }
  return ranges;
}

function normalizedRangeSignature(source, range) {
  return `${range.kind}:${digest(source.slice(range.start, range.end).replace(/\s+/g, " ").trim())}`;
}

function rangeSnapshot(root, files, extractRanges) {
  const snapshot = {};
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const signatures = extractRanges(source, projectPath(root, file))
      .map((range) => normalizedRangeSignature(source, range))
      .sort();
    if (signatures.length) {
      snapshot[projectPath(root, file)] = {
        count: signatures.length,
        fingerprint: digest(signatures.join("\n")),
      };
    }
  }
  return snapshot;
}

function namedImports(source) {
  const imports = [];
  const pattern = /\bimport\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const bindings = match[1].split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
      const clean = part.replace(/^type\s+/, "").trim();
      const pieces = clean.split(/\s+as\s+/);
      return { imported: pieces[0]?.trim(), local: (pieces[1] || pieces[0])?.trim() };
    }).filter(({ imported, local }) => /^[A-Za-z_$][\w$]*$/.test(imported) && /^[A-Za-z_$][\w$]*$/.test(local));
    imports.push({ specifier: match[2], bindings });
  }
  return imports;
}

function canonicalImportLocals(root, file, source, canonicalPath) {
  const locals = [];
  for (const entry of namedImports(source)) {
    const target = resolveProjectImport(root, file, entry.specifier);
    if (!sameModule(target, canonicalPath)) continue;
    locals.push(...entry.bindings);
  }
  return locals;
}

function exportedRuntimeNames(source) {
  const names = [];
  const declarationPattern = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declarationPattern)) names.push(match[1]);
  const listPattern = /\bexport\s*\{([^}]*)\}/g;
  for (const match of source.matchAll(listPattern)) {
    for (const part of match[1].split(",")) {
      const clean = part.trim().replace(/^type\s+/, "");
      const pieces = clean.split(/\s+as\s+/);
      const exported = (pieces[1] || pieces[0])?.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) names.push(exported);
    }
  }
  if (/\bexport\s+default\b/.test(source)) names.push("default");
  if (/\bexport\s*\*/.test(source)) names.push("*");
  return [...new Set(names)].sort();
}

function canonicalContractErrors(root, files) {
  const errors = [];
  for (const [path, expectedList] of Object.entries(CANONICAL_CONTRACTS)) {
    const source = readRequired(root, path);
    const actual = exportedRuntimeNames(source);
    const expected = [...expectedList].sort();
    const missing = expected.filter((name) => !actual.includes(name));
    const unexpected = actual.filter((name) => !expected.includes(name));
    if (missing.length || unexpected.length) {
      errors.push({
        code: "canonical-contract-exports",
        path,
        message: `${path} must expose exactly its reviewed contract${missing.length ? `; missing ${missing.join(", ")}` : ""}${unexpected.length ? `; unexpected ${unexpected.join(", ")}` : ""}.`,
      });
    }
  }

  for (const file of files) {
    const path = projectPath(root, file);
    if (Object.hasOwn(CANONICAL_CONTRACTS, path)) continue;
    const source = readFileSync(file, "utf8");
    for (const name of CANONICAL_EXPORT_NAMES) {
      const declaration = new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${name}\\b`);
      const commonJs = new RegExp(`\\b(?:module\\.exports|exports)\\.${name}\\s*=`);
      if (!declaration.test(source) && !commonJs.test(source)) continue;
      errors.push({
        code: "canonical-helper-duplicate",
        path,
        message: `${path} defines ${name}, which is owned by ${Object.entries(CANONICAL_CONTRACTS).find(([, names]) => names.includes(name))?.[0]}. Import the canonical helper instead.`,
      });
    }
  }
  return errors;
}

function unusedCanonicalExports(root, files) {
  const used = new Set();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const [canonicalPath, exports] of Object.entries(CANONICAL_CONTRACTS)) {
      if (projectPath(root, file) === canonicalPath) continue;
      for (const { imported } of canonicalImportLocals(root, file, source, canonicalPath)) {
        if (exports.includes(imported)) used.add(`${canonicalPath}#${imported}`);
      }
    }
  }
  return Object.entries(CANONICAL_CONTRACTS)
    .flatMap(([path, exports]) => exports.map((name) => `${path}#${name}`))
    .filter((id) => !used.has(id))
    .sort();
}

function callRanges(source, names) {
  if (!names.size) return [];
  const masked = structuralMask(source);
  const parentheses = delimiterRanges(masked, "(", ")");
  const byStart = new Map(parentheses.map((range) => [range.start, range]));
  const escaped = [...names].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`\\b(?:${escaped})\\s*\\(`, "g");
  const ranges = [];
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf("(", match.index);
    const range = byStart.get(open);
    if (range) ranges.push(range);
  }
  return ranges;
}

function smallestEnclosingRange(ranges, index) {
  return ranges
    .filter(({ start, end }) => start < index && end > index)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0] || null;
}

function hasObjectProperty(source, name) {
  return new RegExp(`(?:^|[,{}])\\s*${name}\\s*(?=[:,}])`).test(source);
}

function clientContractShapeRanges(root, file, source) {
  const path = projectPath(root, file);
  if (!/^src\/(?:domain|features|lib)\//.test(path) || Object.hasOwn(CANONICAL_CONTRACTS, path)) return [];
  const masked = structuralMask(source);
  const objects = delimiterRanges(masked, "{", "}");
  const loadLocals = canonicalImportLocals(root, file, source, "src/domain/loadState.mjs")
    .filter(({ imported }) => LOAD_STATE_HELPERS.has(imported))
    .map(({ local }) => local);
  const approvedLoadCalls = callRanges(source, new Set(loadLocals));
  const found = new Map();

  for (const match of source.matchAll(/\bstatus\s*:\s*["'](?:idle|loading|refreshing|ready|error)["']/g)) {
    const object = smallestEnclosingRange(objects, match.index);
    if (!object || approvedLoadCalls.some(({ start, end }) => start < object.start && end >= object.end)) continue;
    const body = source.slice(object.start, object.end);
    const canonicalKeys = ["scope", "status", "data", "error", "updatedAt"].filter((name) => hasObjectProperty(body, name));
    if (canonicalKeys.length >= 3 && canonicalKeys.includes("status")) {
      found.set(`${object.start}:${object.end}:load-state`, { ...object, kind: "load-state" });
    }
  }
  for (const match of source.matchAll(/\bok\s*:\s*(?:true|false)\b/g)) {
    const object = smallestEnclosingRange(objects, match.index);
    if (object) found.set(`${object.start}:${object.end}:command-result`, { ...object, kind: "command-result" });
  }
  return [...found.values()];
}

function clientContractShapeSnapshot(root, files) {
  return rangeSnapshot(root, files, (source, path) => {
    const file = resolve(root, path);
    return clientContractShapeRanges(root, file, source);
  });
}

function isInsideAsyncFunction(source, index) {
  const masked = structuralMask(source);
  const braces = delimiterRanges(masked, "{", "}")
    .filter(({ start, end }) => start < index && end > index)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start));
  return braces.some(({ start }) => {
    const prefix = masked.slice(Math.max(0, start - 500), start);
    return /(?:\basync\s+function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)|\basync\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>|\basync\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::\s*[^={]+)?)\s*$/.test(prefix);
  });
}

function ambiguousAsyncResultRanges(source, path) {
  const masked = structuralMask(source);
  const braces = delimiterRanges(masked, "{", "}");
  const byStart = new Map(braces.map((range) => [range.start, range]));
  const ranges = [];
  const catchPattern = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
  for (const match of source.matchAll(catchPattern)) {
    const open = source.indexOf("{", match.index);
    const range = byStart.get(open);
    if (!range) continue;
    const body = source.slice(open + 1, range.end - 1);
    if (!/\breturn\s+(?:null|false|\[\s*\])\s*;?/.test(body)) continue;
    if (!path.startsWith("src/features/") && !isInsideAsyncFunction(source, match.index)) continue;
    if (AMBIGUOUS_RESULT_EXPLANATION.test(source.slice(Math.max(0, match.index - 180), Math.min(source.length, range.end + 180)))) continue;
    ranges.push({ start: match.index, end: range.end, kind: "catch-sentinel" });
  }
  const promisePattern = /\.catch\s*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:null|false|\[\s*\])\s*\)/g;
  for (const match of source.matchAll(promisePattern)) {
    const end = match.index + match[0].length;
    if (!AMBIGUOUS_RESULT_EXPLANATION.test(source.slice(Math.max(0, match.index - 180), Math.min(source.length, end + 180)))) {
      ranges.push({ start: match.index, end, kind: "promise-sentinel" });
    }
  }
  return ranges;
}

function ambiguousAsyncResultSnapshot(root, files) {
  return rangeSnapshot(root, files, ambiguousAsyncResultRanges);
}

function apiCallSignatures(source) {
  const matches = [...source.matchAll(/\bapi\s*\(/g)];
  return matches.map((match, index) => {
    const argumentStart = match.index + match[0].length;
    const remainder = source.slice(argumentStart);
    const leading = remainder.match(/^\s*/)?.[0].length || 0;
    const first = remainder[leading];
    let argumentEnd = leading;
    if (first === '"' || first === "'" || first === "`") {
      let escaped = false;
      for (argumentEnd = leading + 1; argumentEnd < remainder.length; argumentEnd += 1) {
        const char = remainder[argumentEnd];
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === first) {
          argumentEnd += 1;
          break;
        }
      }
    } else {
      const plain = remainder.slice(leading).match(/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/)?.[0] || "<dynamic>";
      argumentEnd = leading + plain.length;
    }
    const firstArgument = remainder.slice(leading, argumentEnd).replace(/\s+/g, " ").trim();
    const nextCall = matches[index + 1]?.index ?? source.length;
    const callRegion = source.slice(match.index, Math.min(nextCall, match.index + 1200));
    const method = callRegion.match(/\bmethod\s*:\s*["']([A-Z]+)["']/)?.[1] || "GET";
    return `${method}:${firstArgument}`;
  }).sort();
}

function importsApiAdapter(root, file, source) {
  return importSpecifiers(source).some((specifier) => sameModule(resolveProjectImport(root, file, specifier), "src/lib/api.js"));
}

function isApprovedApiBoundary(path) {
  if (path.startsWith("src/lib/")) return true;
  if (!/^src\/features\/[^/]+\//.test(path) || /\.(?:jsx|tsx)$/.test(path)) return false;
  return /\/services\//.test(path) || /(?:Api|Service)\.(?:js|mjs|cjs|ts)$/.test(path);
}

function legacyDirectApiSnapshot(root, files) {
  const snapshot = {};
  for (const file of files) {
    const path = projectPath(root, file);
    if (!isClientRuntimePath(path) || isApprovedApiBoundary(path)) continue;
    const source = readFileSync(file, "utf8");
    if (!importsApiAdapter(root, file, source)) continue;
    const signatures = apiCallSignatures(source);
    snapshot[path] = { count: signatures.length, fingerprint: digest(signatures.join("\n")) };
  }
  return snapshot;
}

function apiAdapterReexportViolations(root, files) {
  const violations = [];
  for (const file of files) {
    const path = projectPath(root, file);
    if (!isClientRuntimePath(path) || path === "src/lib/api.js") continue;
    const source = readFileSync(file, "utf8");
    const apiLocals = canonicalImportLocals(root, file, source, "src/lib/api.js")
      .filter(({ imported }) => imported === "api")
      .map(({ local }) => local);
    const exportsImportedApi = apiLocals.some((local) => new RegExp(`\\bexport\\s*\\{[^}]*\\b${local}\\b[^}]*\\}`).test(source));
    const directReexport = [...source.matchAll(/\bexport\s*(?:\*|\{([^}]*)\})\s*from\s*["']([^"']+)["']/g)].some((match) => {
      if (!sameModule(resolveProjectImport(root, file, match[2]), "src/lib/api.js")) return false;
      return !match[1] || /(?:^|,)\s*api(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*(?:,|$)/.test(match[1]);
    });
    if (exportsImportedApi || directReexport) violations.push({ path });
  }
  return violations;
}

function rawFetchViolations(root, files) {
  const violations = [];
  for (const file of files) {
    const path = projectPath(root, file);
    if (!isClientRuntimePath(path) || path.startsWith("src/lib/")) continue;
    const source = readFileSync(file, "utf8");
    const masked = structuralMask(source);
    const callsFetch = /\b(?:(?:globalThis|window)\s*\.\s*)?fetch\s*\(/.test(masked);
    const importsExpoFetch = importSpecifiers(source).includes("expo/fetch");
    if (callsFetch || importsExpoFetch) violations.push({ path, id: path });
  }
  return violations;
}

function readRequired(root, path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) throw new Error(`Required architecture input is missing: ${path}`);
  return readFileSync(absolute, "utf8");
}

function baselineArray(baseline, key) {
  const value = baseline?.[key];
  return Array.isArray(value) ? value : [];
}

function baselineCounts(baseline, key) {
  const value = baseline?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
  return new Map(Object.entries(value).map(([name, count]) => [name, Number(count) || 0]));
}

function countObject(values) {
  return Object.fromEntries([...occurrences(values)].sort(([a], [b]) => a.localeCompare(b)));
}

function architectureBaselineErrors(baseline) {
  if (!baseline || baseline.version !== 3) {
    return [{ code: "baseline-invalid", message: "Architecture baseline version 3 is required." }];
  }
  const errors = [];
  if (baseline.legacyStore?.file !== "src/store.js") {
    errors.push({ code: "baseline-invalid", message: "The legacy Store ratchet must remain pinned to src/store.js." });
  }
  if (baseline.legacyApi?.file !== "server/api.js") {
    errors.push({ code: "baseline-invalid", message: "The legacy API ratchet must remain pinned to server/api.js." });
  }
  const hookCounts = baselineCounts(baseline.legacyStore, "allowedHookCalls");
  const declaredHookCount = Number(baseline.legacyStore?.maxHookCalls);
  const namedHookCount = [...hookCounts.values()].reduce((total, count) => total + count, 0);
  if (!Number.isInteger(declaredHookCount) || declaredHookCount < 0 || declaredHookCount !== namedHookCount) {
    errors.push({ code: "baseline-invalid", message: "legacyStore.maxHookCalls must equal the sum of its named hook-call allowances." });
  }
  const declaredUseStateCount = Number(baseline.legacyStore?.maxUseStateCalls);
  const namedUseStateCount = (hookCounts.get("useState") || 0) + (hookCounts.get("React.useState") || 0);
  if (!Number.isInteger(declaredUseStateCount) || declaredUseStateCount < 0 || declaredUseStateCount !== namedUseStateCount) {
    errors.push({ code: "baseline-invalid", message: "legacyStore.maxUseStateCalls must equal its named useState and React.useState allowances." });
  }
  const declaredRouteCount = Number(baseline.legacyApi?.maxInlineRoutes);
  const namedRoutes = baselineArray(baseline.legacyApi, "allowedInlineRoutes");
  if (!Number.isInteger(declaredRouteCount) || declaredRouteCount < 0 || declaredRouteCount !== namedRoutes.length) {
    errors.push({ code: "baseline-invalid", message: "legacyApi.maxInlineRoutes must equal its named inline-route allowances." });
  }
  return errors;
}

function compareExactSnapshots(errors, current, allowed, {
  addedCode,
  driftCode,
  label,
  addedGuidance,
}) {
  const baseline = allowed && typeof allowed === "object" && !Array.isArray(allowed) ? allowed : {};
  for (const [path, entry] of Object.entries(current)) {
    const prior = baseline[path];
    if (!prior || entry.count > Number(prior.count)) {
      errors.push({ code: addedCode, path, message: `${path} adds ${label}. ${addedGuidance}` });
    } else if (entry.count < Number(prior.count)) {
      errors.push({ code: "baseline-stale", path, message: `${path} removed ${label}. Shrink its exact architecture baseline in this change.` });
    } else if (entry.fingerprint !== prior.fingerprint) {
      errors.push({ code: driftCode, path, message: `${path} changed an exact ${label} signature. ${addedGuidance}` });
    }
  }
  for (const path of Object.keys(baseline)) {
    if (!current[path]) {
      errors.push({ code: "baseline-stale", path, message: `${path} removed its last ${label}. Remove that exact allowance from the architecture baseline in this change.` });
    }
  }
}

export function captureArchitectureBaseline(root = DEFAULT_ROOT) {
  const files = productionFiles(root);
  const storeSource = readRequired(root, "src/store.js");
  const apiSource = readRequired(root, "server/api.js");
  const stateHooks = extractStoreStateHooks(storeSource).sort();
  const hookCalls = extractStoreHookCalls(storeSource).sort();
  const inlineRoutes = extractInlineApiRoutes(apiSource).sort();
  return {
    version: 3,
    legacyStore: {
      file: "src/store.js",
      maxUseStateCalls: (storeSource.match(/\buseState\s*\(/g) || []).length,
      allowedStateHooks: stateHooks,
      maxHookCalls: hookCalls.length,
      allowedHookCalls: countObject(hookCalls),
    },
    legacyApi: {
      file: "server/api.js",
      maxInlineRoutes: inlineRoutes.length,
      allowedInlineRoutes: inlineRoutes,
    },
    allowedImportViolations: importViolations(root, files).map(({ id }) => id),
    allowedFileNameViolations: fileNameViolations(root, files).map(({ id }) => id),
    unexplainedEmptyCatchSignaturesByFile: emptyCatchSnapshot(root, files),
    legacyDirectApiCallsByFile: legacyDirectApiSnapshot(root, files),
    legacyClientContractShapesByFile: clientContractShapeSnapshot(root, files),
    ambiguousAsyncResultSignaturesByFile: ambiguousAsyncResultSnapshot(root, files),
    allowedUnusedCanonicalExports: unusedCanonicalExports(root, files),
  };
}

export function inspectArchitecture({ root = DEFAULT_ROOT, baseline }) {
  const invalidBaseline = architectureBaselineErrors(baseline);
  if (invalidBaseline.length) return { errors: invalidBaseline, summary: {} };

  const errors = [];
  const files = productionFiles(root);
  const storeFile = baseline.legacyStore?.file || "src/store.js";
  const apiFile = baseline.legacyApi?.file || "server/api.js";
  const storeSource = readRequired(root, storeFile);
  const apiSource = readRequired(root, apiFile);

  errors.push(...canonicalContractErrors(root, files));

  const unusedExports = unusedCanonicalExports(root, files);
  const allowedUnusedExports = new Set(baselineArray(baseline, "allowedUnusedCanonicalExports"));
  for (const id of unusedExports) {
    if (!allowedUnusedExports.has(id)) {
      errors.push({ code: "canonical-export-unused", path: id.split("#")[0], message: `${id} has no production importer. Remove the misleading export or record an explicit transitional allowance.` });
    }
  }
  const currentUnusedExports = new Set(unusedExports);
  for (const id of allowedUnusedExports) {
    if (!currentUnusedExports.has(id)) {
      errors.push({ code: "baseline-stale", path: id.split("#")[0], message: `${id} now has a production consumer. Remove its dormant-export allowance so it cannot become dead again.` });
    }
  }

  const stateHooks = extractStoreStateHooks(storeSource);
  const stateHookCounts = occurrences(stateHooks);
  const allowedStateHookCounts = occurrences(baselineArray(baseline.legacyStore, "allowedStateHooks"));
  const hookCalls = extractStoreHookCalls(storeSource);
  const hookCallCounts = occurrences(hookCalls);
  const allowedHookCallCounts = baselineCounts(baseline.legacyStore, "allowedHookCalls");
  const maxHookCalls = Number(baseline.legacyStore?.maxHookCalls) || 0;
  const useStateCalls = (storeSource.match(/\buseState\s*\(/g) || []).length;
  const maxUseStateCalls = Number(baseline.legacyStore?.maxUseStateCalls) || 0;
  if (useStateCalls > maxUseStateCalls) {
    errors.push({
      code: "legacy-store-state-count",
      path: storeFile,
      message: `${storeFile} has ${useStateCalls} useState calls; the legacy ceiling is ${maxUseStateCalls}. Put new state in a feature slice.`,
    });
  } else if (useStateCalls < maxUseStateCalls) {
    errors.push({
      code: "baseline-stale",
      path: storeFile,
      message: `${storeFile} reduced useState calls from ${maxUseStateCalls} to ${useStateCalls}. Shrink the architecture baseline in this change so the state cannot return.`,
    });
  }
  for (const [hook, count] of stateHookCounts) {
    const allowed = allowedStateHookCounts.get(hook) || 0;
    if (count > allowed) {
      errors.push({
        code: "legacy-store-state",
        path: storeFile,
        message: `${storeFile} adds state hook ${hook}. Put new state in a feature slice instead of the legacy Store.`,
      });
    }
  }
  for (const [hook, allowed] of allowedStateHookCounts) {
    const count = stateHookCounts.get(hook) || 0;
    if (count < allowed) {
      errors.push({
        code: "baseline-stale",
        path: storeFile,
        message: `${storeFile} removed legacy state hook ${hook}. Shrink its named baseline in this change.`,
      });
    }
  }
  if (hookCalls.length > maxHookCalls) {
    errors.push({
      code: "legacy-store-hook-count",
      path: storeFile,
      message: `${storeFile} has ${hookCalls.length} hook calls; the legacy ceiling is ${maxHookCalls}. Put new state and lifecycle work in a feature slice.`,
    });
  } else if (hookCalls.length < maxHookCalls) {
    errors.push({
      code: "baseline-stale",
      path: storeFile,
      message: `${storeFile} reduced hook calls from ${maxHookCalls} to ${hookCalls.length}. Shrink the architecture baseline in this change.`,
    });
  }
  for (const [hook, count] of hookCallCounts) {
    const allowed = allowedHookCallCounts.get(hook) || 0;
    if (count > allowed) {
      errors.push({
        code: "legacy-store-hook",
        path: storeFile,
        message: `${storeFile} adds ${hook}(). Put new state and lifecycle work in a feature slice instead of the legacy Store.`,
      });
    }
  }
  for (const [hook, allowed] of allowedHookCallCounts) {
    const count = hookCallCounts.get(hook) || 0;
    if (count < allowed) {
      errors.push({
        code: "baseline-stale",
        path: storeFile,
        message: `${storeFile} removed a legacy ${hook}() call. Shrink its hook baseline in this change.`,
      });
    }
  }

  const inlineRoutes = extractInlineApiRoutes(apiSource);
  const allowedRoutes = new Set(baselineArray(baseline.legacyApi, "allowedInlineRoutes"));
  const maxInlineRoutes = Number(baseline.legacyApi?.maxInlineRoutes) || 0;
  if (inlineRoutes.length > maxInlineRoutes) {
    errors.push({
      code: "legacy-api-route-count",
      path: apiFile,
      message: `${apiFile} has ${inlineRoutes.length} inline routes; the legacy ceiling is ${maxInlineRoutes}. Register a feature-owned route module.`,
    });
  } else if (inlineRoutes.length < maxInlineRoutes) {
    errors.push({
      code: "baseline-stale",
      path: apiFile,
      message: `${apiFile} reduced inline routes from ${maxInlineRoutes} to ${inlineRoutes.length}. Shrink the architecture baseline in this change so those routes cannot return.`,
    });
  }
  for (const route of inlineRoutes) {
    if (!allowedRoutes.has(route)) {
      errors.push({
        code: "legacy-api-route",
        path: apiFile,
        message: `${apiFile} adds inline route ${route}. Implement and register it from a feature-owned route module.`,
      });
    }
  }
  const currentRoutes = new Set(inlineRoutes);
  for (const route of allowedRoutes) {
    if (!currentRoutes.has(route)) {
      errors.push({
        code: "baseline-stale",
        path: apiFile,
        message: `${apiFile} removed legacy inline route ${route}. Shrink its named baseline in this change.`,
      });
    }
  }

  const allowedImports = new Set(baselineArray(baseline, "allowedImportViolations"));
  const imports = importViolations(root, files);
  for (const violation of imports) {
    if (allowedImports.has(violation.id)) continue;
    errors.push({
      code: "import-layer",
      path: violation.source,
      message: `${violation.id}: ${violation.reason}.`,
    });
  }
  const currentImports = new Set(imports.map(({ id }) => id));
  for (const id of allowedImports) {
    if (!currentImports.has(id)) {
      errors.push({ code: "baseline-stale", message: `Legacy import ${id} was removed. Remove it from the architecture baseline in this change.` });
    }
  }

  const allowedFileNames = new Set(baselineArray(baseline, "allowedFileNameViolations"));
  const fileNames = fileNameViolations(root, files);
  for (const violation of fileNames) {
    if (allowedFileNames.has(violation.id)) continue;
    errors.push({
      code: "file-name",
      path: violation.path,
      message: `${violation.path} must use ${violation.expected}.`,
    });
  }
  const currentFileNames = new Set(fileNames.map(({ id }) => id));
  for (const id of allowedFileNames) {
    if (!currentFileNames.has(id)) {
      errors.push({ code: "baseline-stale", path: id, message: `Legacy file name ${id} was removed. Remove it from the architecture baseline in this change.` });
    }
  }

  const fetches = rawFetchViolations(root, files);
  for (const violation of fetches) {
    errors.push({
      code: "raw-fetch-boundary",
      path: violation.path,
      message: `${violation.path} performs raw fetch outside src/lib. Put provider/PIT transport in a shared adapter and expose a feature service instead.`,
    });
  }

  for (const violation of apiAdapterReexportViolations(root, files)) {
    errors.push({
      code: "api-adapter-reexport",
      path: violation.path,
      message: `${violation.path} re-exports the raw api() transport. Export a domain-named service operation instead of moving the boundary by alias.`,
    });
  }

  const directApiCalls = legacyDirectApiSnapshot(root, files);
  compareExactSnapshots(errors, directApiCalls, baseline.legacyDirectApiCallsByFile, {
    addedCode: "direct-api-boundary",
    driftCode: "direct-api-drift",
    label: "a direct PIT API dependency outside an adapter or feature service",
    addedGuidance: "UI and state modules consume a service; only src/lib adapters or feature *Api/*Service modules call api().",
  });

  const contractShapes = clientContractShapeSnapshot(root, files);
  compareExactSnapshots(errors, contractShapes, baseline.legacyClientContractShapesByFile, {
    addedCode: "canonical-contract-bypass",
    driftCode: "canonical-contract-drift",
    label: "a parallel LoadState or CommandResult object shape",
    addedGuidance: "Construct resource and command outcomes through src/domain/loadState.mjs and src/domain/commandResult.mjs.",
  });

  const ambiguousResults = ambiguousAsyncResultSnapshot(root, files);
  compareExactSnapshots(errors, ambiguousResults, baseline.ambiguousAsyncResultSignaturesByFile, {
    addedCode: "ambiguous-async-result",
    driftCode: "ambiguous-async-result-drift",
    label: "an async error path that resolves null, false, or []",
    addedGuidance: "Throw AppError, return CommandResult, or add \"architecture: allow-ambiguous-result -- <reason>\" at a truly optional boundary.",
  });

  const catches = emptyCatchSnapshot(root, files);
  const catchBaseline = baseline.unexplainedEmptyCatchSignaturesByFile || {};
  for (const [path, current] of Object.entries(catches)) {
    const allowed = catchBaseline[path];
    if (!allowed || current.count > Number(allowed.count)) {
      errors.push({
        code: "empty-catch",
        path,
        message: `${path} adds an unexplained empty catch. Handle the error or add \"architecture: allow-empty-catch -- <reason>\" beside the intentional best-effort boundary.`,
      });
    } else if (current.count < Number(allowed.count)) {
      errors.push({
        code: "baseline-stale",
        path,
        message: `${path} removed an unexplained empty catch. Refresh its exact baseline signature in this change so the catch cannot return.`,
      });
    } else if (current.fingerprint !== allowed.fingerprint) {
      errors.push({
        code: "empty-catch-drift",
        path,
        message: `${path} changed an unexplained empty-catch signature. Handle or explain the catch; update the baseline only when an existing intentional boundary merely moved.`,
      });
    }
  }
  for (const path of Object.keys(catchBaseline)) {
    if (!catches[path]) {
      errors.push({
        code: "baseline-stale",
        path,
        message: `${path} removed its last unexplained empty catch. Remove that signature from the architecture baseline in this change.`,
      });
    }
  }

  return {
    errors,
    summary: {
      useStateCalls,
      maxUseStateCalls,
      hookCalls: hookCalls.length,
      maxHookCalls,
      inlineRoutes: inlineRoutes.length,
      maxInlineRoutes,
      importViolations: imports.length,
      fileNameViolations: fileNames.length,
      unexplainedEmptyCatches: Object.values(catches).reduce((total, entry) => total + entry.count, 0),
      legacyDirectApiFiles: Object.keys(directApiCalls).length,
      legacyClientContractShapes: Object.values(contractShapes).reduce((total, entry) => total + entry.count, 0),
      ambiguousAsyncResults: Object.values(ambiguousResults).reduce((total, entry) => total + entry.count, 0),
      dormantCanonicalExports: unusedExports.length,
    },
  };
}

export function formatArchitectureReport(result) {
  if (result.errors.length) {
    return [
      `Architecture check failed (${result.errors.length} violation${result.errors.length === 1 ? "" : "s"}):`,
      ...result.errors.map((error) => `- [${error.code}] ${error.message}`),
    ].join("\n");
  }
  const summary = result.summary;
  return `Architecture check passed (legacy Store hooks ${summary.hookCalls}/${summary.maxHookCalls}, including state ${summary.useStateCalls}/${summary.maxUseStateCalls}; inline API routes ${summary.inlineRoutes}/${summary.maxInlineRoutes}; ${summary.legacyDirectApiFiles} legacy direct-API files; ${summary.legacyClientContractShapes} legacy result shapes; ${summary.ambiguousAsyncResults} ambiguous async fallbacks; ${summary.unexplainedEmptyCatches} silent catches; ${summary.dormantCanonicalExports} dormant canonical exports).`;
}

export function architectureBaselineRefreshBlockers(result) {
  return (result?.errors || []).filter(({ code }) => code !== "baseline-stale");
}

function parseArguments(argv) {
  const options = { root: DEFAULT_ROOT, baselinePath: null, printBaseline: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root") options.root = resolve(argv[++index]);
    else if (value === "--baseline") options.baselinePath = resolve(argv[++index]);
    else if (value === "--print-baseline") options.printBaseline = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.printBaseline) {
    const baselinePath = options.baselinePath || resolve(options.root, "scripts/architecture-baseline.json");
    if (existsSync(baselinePath)) {
      const existing = JSON.parse(readFileSync(baselinePath, "utf8"));
      const blockers = architectureBaselineRefreshBlockers(inspectArchitecture({ root: options.root, baseline: existing }));
      if (blockers.length) {
        const report = formatArchitectureReport({ errors: blockers, summary: {} });
        process.stderr.write(`${report}\nRefusing to print an expanded baseline. Resolve the new debt; edit an exceptional allowance only under architecture review.\n`);
        process.exitCode = 1;
        return;
      }
    }
    process.stdout.write(`${JSON.stringify(captureArchitectureBaseline(options.root), null, 2)}\n`);
    return;
  }
  const baselinePath = options.baselinePath || resolve(options.root, "scripts/architecture-baseline.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const result = inspectArchitecture({ root: options.root, baseline });
  const report = formatArchitectureReport(result);
  (result.errors.length ? process.stderr : process.stdout).write(`${report}\n`);
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_FILE) main();
