import { lstatSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeClientCrashLocation } from "../../../src/domain/clientCrashReport.mjs";

const WEB_ASSETS = fileURLToPath(new URL("../../../dist/_expo/static/js/web/", import.meta.url));

// Only a file actually shipped by this server can become persisted diagnostic
// identity. The basename validator forbids paths, source maps and arbitrary text.
export function resolveClientCrashLocation(value, directory = WEB_ASSETS) {
  const location = normalizeClientCrashLocation(value);
  if (!location) return null;
  try {
    if (!lstatSync(join(directory, location.asset)).isFile()) return null;
    const hash = /-([a-f0-9]{32})\.js$/.exec(location.asset)[1];
    // Full emitted-asset hash plus coordinates, losslessly encoded into <=38
    // characters for errorLog's existing cause suffix. This is not a message hash.
    return `b${BigInt(`0x${hash}`).toString(36)}.${location.line.toString(36)}.${location.column.toString(36)}`;
  } catch {
    return null;
  }
}

const TYPE_LABELS = Object.freeze({
  Error: "Error", TypeError: "Type", ReferenceError: "Ref", RangeError: "Range",
  SyntaxError: "Syntax", URIError: "Uri", EvalError: "Eval", AggregateError: "Aggregate",
  AbortError: "Abort", Unknown: "Unknown",
});

export function clientCrashCause(base, report, resolveLocation = resolveClientCrashLocation) {
  const type = Object.hasOwn(TYPE_LABELS, report.errorType) ? TYPE_LABELS[report.errorType] : null;
  const diagnosis = /^react(?:130|185|301|310|321)$/.test(report.diagnosis || "")
    ? `.${report.diagnosis}` : "";
  const cause = type ? `${base}.${type}${diagnosis}` : base;
  const location = report.platform === "web" ? resolveLocation(report.location) : null;
  return location ? `${cause}/${location}` : cause;
}
