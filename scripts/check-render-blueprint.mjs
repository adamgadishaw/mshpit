import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = new URL("../", import.meta.url);
const SCHEMA = new URL("fixtures/render-blueprint-schema.json", import.meta.url);

// Offline, pinned provider schema: a Render/docs outage must not break an
// already-reviewed release. --live-schema is an explicit diagnostic, not CI.
export async function validateBlueprint(text, schema) {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) return document.errors.map((error) => `YAML: ${error.message}`);
  const blueprint = document.toJS();
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
  if (!validate(blueprint)) return validate.errors.map((error) => `${error.instancePath || "/"}: ${error.message}`);
  const errors = [];
  const services = blueprint.services || [];
  const names = new Map();
  for (const service of services) {
    if (names.has(service.name)) errors.push(`Duplicate service: ${service.name}`);
    names.set(service.name, service);
    const keys = new Set();
    for (const variable of service.envVars || []) {
      if (variable.key && keys.has(variable.key)) errors.push(`${service.name}: duplicate variable ${variable.key}`);
      keys.add(variable.key);
    }
  }
  // This project intentionally defines all cross-service dependencies here.
  // Do not silently accept a typo as an imaginary externally-managed service.
  for (const service of services) for (const variable of service.envVars || []) {
    const reference = variable.fromService;
    if (!reference) continue;
    const target = names.get(reference.name);
    if (!target || target.type !== reference.type) {
      errors.push(`${service.name}.${variable.key}: missing/mismatched service ${reference.name}`);
    } else if (reference.envVarKey && !reference.envVarKey.startsWith("RENDER_")
      && !target.envVars?.some((entry) => entry.key === reference.envVarKey)) {
      errors.push(`${service.name}.${variable.key}: missing source variable ${reference.envVarKey}`);
    }
  }
  return errors;
}

export async function readProviderSchema({ live = false } = {}) {
  if (!live) return JSON.parse(await readFile(SCHEMA, "utf8"));
  const response = await fetch("https://render.com/schema/render.yaml.json", { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Render schema returned HTTP ${response.status}`);
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512 * 1024) throw new Error("Render schema exceeds the diagnostic size limit");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const errors = await validateBlueprint(await readFile(new URL("render.yaml", ROOT), "utf8"),
      await readProviderSchema({ live: process.argv.includes("--live-schema") }));
    if (errors.length) throw new Error(errors.join("\n"));
    console.log("Render Blueprint: schema, unique names and cross-service references passed. Live sync/secret presence not implied.");
  } catch (error) {
    console.error(`Render Blueprint validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
