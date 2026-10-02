#!/usr/bin/env node
// Offline files only. No application bootstrap, database, network or provider imports.
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PILOT_MAX_BYTES, advancePilotReport, createPilotReport, parsePilotFile, pausePilotReport,
  pilotSummary, serializePilotReport, syntheticPilotSnapshot } from "../src/features/catalogMaintenance/catalogPilot.mjs";

const usage = `Offline catalog pilot: selects up to 100 existing eligible artist, venue and event records.
  node scripts/catalog-pilot-dry-run.mjs [--input snapshot.json] [--authorized-snapshot]
    [--checkpoint report.json] [--limit 100] [--batch 25] [--expected-revision N] [--pause | --resume]
Without input, uses clearly labelled synthetic fixtures. An existing checkpoint resumes its fixed selection.
With --input and an existing checkpoint, input must be a newer snapshot from the same source.
--authorized-snapshot confirms permission to use a supplied catalog-only snapshot; it grants no live authority.
Only an explicitly named local checkpoint is written. Without it, the report is printed to stdout.
No claims, catalog writes, approvals, credentials, source fetches or provider calls are made.
A .lock file prevents concurrent checkpoint writers. An abandoned lock requires operator inspection.
`;

function argumentsFor(args) {
  const options = {};
  const values = new Set(["input", "checkpoint", "limit", "batch", "expected-revision"]);
  const flags = new Set(["authorized-snapshot", "pause", "resume", "help"]);
  for (let index = 0; index < args.length; index++) {
    const name = args[index].startsWith("--") ? args[index].slice(2) : "";
    if ((!values.has(name) && !flags.has(name)) || Object.hasOwn(options, name)) throw new Error("Use supported, non-duplicate options. See --help.");
    if (values.has(name)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("An option value is missing. See --help.");
      options[name] = value;
    } else options[name] = true;
  }
  if (options.pause && options.resume) throw new Error("Choose pause or resume, not both.");
  for (const key of ["limit", "batch", "expected-revision"]) if (options[key] !== undefined) {
    if (!/^\d+$/u.test(options[key]) || !Number.isSafeInteger(Number(options[key]))) throw new Error("Counts and revisions must be whole numbers.");
    options[key] = Number(options[key]);
  }
  return options;
}
function readLocal(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > PILOT_MAX_BYTES) throw new Error("Use a bounded regular local JSON file.");
  const descriptor = openSync(path, "r");
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > PILOT_MAX_BYTES || opened.dev !== info.dev || opened.ino !== info.ino) {
      throw new Error("The local input file changed while it was opening.");
    }
    const bytes = Buffer.alloc(Math.min(opened.size + 1, PILOT_MAX_BYTES + 1));
    let size = 0, count;
    while (size < bytes.length && (count = readSync(descriptor, bytes, size, bytes.length - size, null))) size += count;
    if (size !== opened.size) throw new Error("The local input file changed while it was being read.");
    const content = bytes.subarray(0, size).toString("utf8");
    return { content, parsed: parsePilotFile(content) };
  } finally { closeSync(descriptor); }
}
function authorized(report, options) {
  const snapshot = report.kind === "catalog-pilot-dry-run" ? report.snapshot : report;
  if (snapshot.kind !== "synthetic" && !options["authorized-snapshot"]) {
    throw new Error("Confirm permission for this catalog-only snapshot with --authorized-snapshot.");
  }
}
export function runCatalogPilot(args, { at = Date.now() } = {}) {
  const options = argumentsFor(args);
  if (options.help) return { help: usage };
  const checkpoint = options.checkpoint ? resolve(options.checkpoint) : null;
  const input = options.input ? resolve(options.input) : null;
  if (checkpoint && input === checkpoint) throw new Error("Use --checkpoint alone to resume; keep input snapshots separate.");
  let descriptor, temporary;
  const lock = checkpoint ? `${checkpoint}.lock` : null, nonce = randomUUID();
  try {
    if (lock) {
      try { descriptor = openSync(lock, "wx", 0o600); }
      catch (error) { if (error.code === "EEXIST") throw new Error("The checkpoint is locked. Inspect the other run before retrying."); throw error; }
      writeFileSync(descriptor, nonce); fsyncSync(descriptor);
    }
    const saved = checkpoint && existsSync(checkpoint) ? readLocal(checkpoint) : null;
    if (saved && saved.parsed.kind !== "catalog-pilot-dry-run") throw new Error("The checkpoint path already holds another file. Choose a new path.");
    const supplied = input ? readLocal(input).parsed : null;
    if (saved && supplied?.kind === "catalog-pilot-dry-run") throw new Error("Supply a newer snapshot when resuming a checkpoint.");
    let report = saved?.parsed || (supplied?.kind === "catalog-pilot-dry-run" ? supplied
      : createPilotReport(supplied || syntheticPilotSnapshot(at), options.limit ?? 100));
    authorized(report, options);
    if (supplied) authorized(supplied, options);
    if (options.limit !== undefined && options.limit !== report.limit) throw new Error("A resumed checkpoint keeps its original selection limit.");
    if (options["expected-revision"] !== undefined && options["expected-revision"] !== report.revision) {
      throw new Error("The checkpoint revision changed. Read it before retrying.");
    }
    if (options.pause || options.resume) report = pausePilotReport(report, !!options.pause, report.revision);
    report = advancePilotReport(report, { ...(saved && supplied ? { snapshot: supplied } : {}), batchSize: options.batch ?? 25,
      expectedRevision: report.revision, at });
    const encoded = serializePilotReport(report);
    if (checkpoint) {
      if (saved ? !existsSync(checkpoint) || readLocal(checkpoint).content !== saved.content : existsSync(checkpoint)) {
        throw new Error("The checkpoint changed during this run. Its contents were preserved.");
      }
      temporary = `${checkpoint}.${nonce}.tmp`;
      const output = openSync(temporary, "wx", 0o600);
      try { writeFileSync(output, encoded); fsyncSync(output); } finally { closeSync(output); }
      renameSync(temporary, checkpoint); temporary = null;
    }
    return { report, summary: { ...pilotSummary(report), revision: report.revision, checkpointSaved: !!checkpoint }, encoded };
  } finally {
    if (temporary && existsSync(temporary)) unlinkSync(temporary);
    if (descriptor !== undefined) {
      closeSync(descriptor);
      // Never delete a lock replaced by another process or operator.
      if (existsSync(lock) && readFileSync(lock, "utf8") === nonce) unlinkSync(lock);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = runCatalogPilot(process.argv.slice(2));
    process.stdout.write(result.help || `${result.summary.checkpointSaved ? JSON.stringify(result.summary) : result.encoded}\n`);
  } catch (error) {
    // Filesystem errors contain paths; keep public CLI failures bounded and omit their raw message.
    console.error(error?.code ? "The local pilot file could not be read or saved. Check its path and permissions." : error.message);
    process.exitCode = 1;
  }
}
