#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const encode = value => encodeURIComponent(String(value));
const writes = new Set(["claim", "renew", "propose", "commit", "finish"]);
export function createCatalogPilotClient({ baseUrl, allowLoopback = false, fetchImpl = globalThis.fetch } = {}) {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/"
    || (base.protocol !== "https:" && !(allowLoopback && base.protocol === "http:" && base.hostname === "127.0.0.1"))) {
    throw new Error("Use an HTTPS origin, or explicitly enabled local loopback.");
  }
  let token = "";
  async function request(path, { method = "GET", body, idempotencyKey, authenticated = true } = {}) {
    if (authenticated && !token) throw new Error("Pair the catalog client first.");
    const response = await fetchImpl(new URL(path, base), { method, redirect: "error", credentials: "omit",
      signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json", "Content-Type": "application/json",
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 131072) { await reader.cancel(); throw new Error("Catalog response exceeded its bound."); }
        chunks.push(value); }
    } finally { reader.releaseLock(); }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new Error("Catalog returned an invalid response."); }
    if (!response.ok) {
      const error = new Error(`Catalog request failed (${response.status}); re-read state before retrying.`);
      error.status = response.status; throw error;
    }
    return payload;
  }
  return {
    async pair(pairingCode) {
      if (token) throw new Error("This client is already paired.");
      const grant = await request("/api/catalog/v1/grants/exchange", { method: "POST", body: { pairingCode }, authenticated: false });
      if (typeof grant.accessToken !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(grant.accessToken)) throw new Error("Invalid catalog grant response.");
      token = grant.accessToken;
      const { accessToken: _secret, ...publicGrant } = grant;
      return publicGrant;
    },
    close() { token = ""; },
    async execute(command) {
      if (!command || typeof command !== "object" || Array.isArray(command)
        || !["artist", "venue", "event"].includes(command.type)) throw new Error("Choose a catalog command and entity type.");
      const { operation, type, key, body, idempotencyKey } = command;
      const prefix = `/api/catalog/v1/${type}`;
      if (operation === "inventory") return request(`${prefix}/inventory?limit=6`);
      if (operation === "status") return request(`${prefix}/status`);
      if (operation === "proposal") return request(`${prefix}/proposals/${encode(command.proposalId)}`);
      if (typeof key !== "string" || !key || key.length > 600) throw new Error("Choose an exact catalog key.");
      const entity = `${prefix}/entities/${encode(key)}`;
      if (operation === "read") return request(entity);
      if (!writes.has(operation) || command.confirmWrite !== true) throw new Error("A write needs an explicit command confirmation.");
      if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/u.test(idempotencyKey)
        || !body || typeof body !== "object" || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 22000) {
        throw new Error("Supply the same bounded body and idempotency key when resuming an interrupted write.");
      }
      // Never retry implicitly. The caller retains the exact command; replay of
      // a lost response uses that same key/body and the server's atomic receipt.
      return request(`${entity}/${operation}`, { method: "POST", body, idempotencyKey });
    },
  };
}

// JSON lines over private stdin: first {baseUrl,pairingCode,allowLoopback?}, then
// commands. Stdout contains safe grant metadata/receipts only. No token files,
// command-line secrets, provider calls, or automatic commits.
async function main() {
  let client, buffered = "", count = 0;
  async function line(value) {
    if (!value.trim()) return;
    if (++count > 60 || Buffer.byteLength(value) > 24000) throw new Error("Pilot input exceeded its bound.");
    const input = JSON.parse(value);
    if (!client) { client = createCatalogPilotClient(input); process.stdout.write(`${JSON.stringify(await client.pair(input.pairingCode))}\n`); }
    else process.stdout.write(`${JSON.stringify(await client.execute(input))}\n`);
  }
  try {
    process.stdin.setEncoding("utf8");
    for await (const bytes of process.stdin) {
      buffered += bytes;
      if (Buffer.byteLength(buffered) > 65536) throw new Error("Pilot input exceeded its bound.");
      let end; while ((end = buffered.indexOf("\n")) >= 0) { const value = buffered.slice(0, end); buffered = buffered.slice(end + 1); await line(value); }
    }
    if (buffered) await line(buffered);
  } finally { client?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write("Catalog pilot stopped. Inspect current state before resuming; no automatic retry was made.\n"); process.exitCode = 1; });
}
