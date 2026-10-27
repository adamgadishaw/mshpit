import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import tls from "node:tls";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const fixtures = JSON.parse(await readFile(new URL("./fixtures/video-verifier-security.json", import.meta.url), "utf8"));
const positiveUrl = "https://nodejs.org/";
const timeoutMs = 15_000;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fingerprint = (cert) => sha256(cert.raw);
const spkiHash = (cert) => sha256(cert.publicKey.export({ type: "spki", format: "der" }));
const emit = (event, result) => console.log(JSON.stringify({ event, ...result }));

export function assertPatchedRuntime(version) {
  const match = /^v24\.(\d+)\.(\d+)$/.exec(version);
  assert.ok(match && (Number(match[1]) > 22 || (Number(match[1]) === 22 && Number(match[2]) >= 1)),
    `Expected stable Node 24.22.1 or later within 24; actual ${version}`);
}

export function assertDefaultTrust(env, execArgv) {
  // Do not print values: a caller's proxy/options could contain private data.
  const overrides = ["NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED",
    "NODE_USE_SYSTEM_CA", "NODE_USE_ENV_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
  for (const name of overrides) assert.ok(!env[name], `Unexpected trust/proxy override: ${name}`);
  assert.equal(execArgv.length, 0, "Run the check without Node command-line overrides");
}

export function parseCertificates(pem) {
  const blocks = String(pem).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  assert.ok(blocks?.length, "No public certificates found");
  return blocks.map((block) => new X509Certificate(block));
}

export function describeCertificate(cert) {
  return { subject: cert.subject, issuer: cert.issuer, sha256: fingerprint(cert),
    spkiSha256: spkiHash(cert), validFrom: cert.validFrom, validTo: cert.validTo, ca: cert.ca };
}

export function validateAffectedChain(endpoint, chain, now = Date.now()) {
  const pinned = parseCertificates(endpoint.chainPem);
  assert.ok(chain.length >= pinned.length && chain.length <= 8, "Missing or excessive peer chain");
  assert.equal(chain[0].ca, false, "Expected an endpoint leaf certificate");
  assert.equal(tls.checkServerIdentity(endpoint.hostname, chain[0].toLegacyObject()), undefined,
    "The leaf must match the exact test hostname");
  assert.equal(fingerprint(chain[1]), endpoint.intermediateSha256, "Unexpected affected intermediate");
  assert.equal(spkiHash(chain[1]), endpoint.intermediateSpkiSha256, "Unexpected affected public key");
  // Allow a renewed leaf only when it is signed by the same pinned intermediate.
  for (let i = 1; i < pinned.length; i += 1) {
    assert.equal(fingerprint(chain[i]), fingerprint(pinned[i]), "Unexpected issuer chain");
  }
  for (let i = 0; i < chain.length; i += 1) {
    const cert = chain[i];
    assert.ok(Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo),
      `Certificate outside validity period: ${cert.subject}`);
    if (i > 0) assert.equal(cert.ca, true, "Expected a CA issuer");
    if (i + 1 < chain.length) {
      assert.equal(cert.checkIssued(chain[i + 1]), true, "Issuer does not match");
      assert.equal(cert.verify(chain[i + 1].publicKey), true, "Invalid certificate signature");
    }
  }
  // Signature checks identify the public evidence; they do not establish trust.
  return chain.map(describeCertificate);
}

export function assertPositive(result) {
  assert.equal(result.kind, "response", `Valid-chain control failed: ${JSON.stringify(result)}`);
  assert.ok(result.status >= 200 && result.status < 400, `Unexpected control HTTP status: ${result.status}`);
}

export function assertRevoked(result) {
  assert.equal(result.kind, "error", "Affected endpoint returned HTTP; its chain was accepted");
  assert.equal(result.code, "CERT_REVOKED",
    `Only CERT_REVOKED proves this check; network, expiry, hostname and issuer errors do not: ${JSON.stringify(result)}`);
}

export async function fetchOutcome(url, fetchImpl = globalThis.fetch) {
  try {
    // Same unmodified global Node fetch/TLS defaults as videoVerifierService.js.
    // No authorization, cookies, body, custom dispatcher, CA, or redirect follow.
    const response = await fetchImpl(url, {
      method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return { kind: "response", status: response.status };
  } catch (error) {
    return { kind: "error", code: error.cause?.code ?? error.code ?? error.name,
      reason: error.cause?.message ?? error.message };
  }
}

export async function observePublicChain(hostname, connect = tls.connect) {
  // Diagnostic handshake ONLY: allow inspection of an untrusted peer, but send
  // no HTTP/application data. This socket never supplies a positive-control or
  // fetch result and never changes process/global trust. The independent fetch
  // below keeps rejectUnauthorized at its default true.
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, servername: hostname, port: 443,
      rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(Object.assign(
      new Error("Public certificate observation timed out"), { code: "ETIMEDOUT" })), timeoutMs);
    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled) finish(Object.assign(new Error("TLS closed before certificate observation"), { code: "ECONNRESET" }));
    });
    socket.once("secureConnect", () => {
      try {
        const chain = [];
        const seen = new Set();
        let peer = socket.getPeerCertificate(true);
        while (peer?.raw) {
          const cert = new X509Certificate(peer.raw);
          const hash = fingerprint(cert);
          if (seen.has(hash)) break;
          assert.ok(chain.length < 8, "Excessive peer certificate chain");
          chain.push(cert);
          seen.add(hash);
          peer = peer.issuerCertificate;
        }
        finish(null, { chain, authorized: socket.authorized, authorizationError: socket.authorizationError,
          protocol: socket.getProtocol() });
      } catch (error) { finish(error); }
    });
  });
}

export async function inventory() {
  const { stdout } = await exec("dpkg-query", ["-W", "-f=${Status}\t${Version}\n", "ca-certificates"],
    { timeout: 10_000, maxBuffer: 16_384 });
  assert.match(stdout, /^install ok installed\t\S+\n?$/);
  const bundle = await readFile("/etc/ssl/certs/ca-certificates.crt");
  const config = await readFile("/etc/ca-certificates.conf");
  const stores = Object.fromEntries(["default", "bundled", "system", "extra"].map((type) => {
    const certs = tls.getCACertificates(type).map((pem) => new X509Certificate(pem));
    return [type, { count: certs.length, certificates: certs.map(describeCertificate) }];
  }));
  assert.ok(stores.default.count > 0 && stores.bundled.count > 0 && stores.system.count > 0,
    "CA inventory unexpectedly empty");
  assert.equal(stores.extra.count, 0, "Unexpected extra trust anchors");
  return { caPackage: stdout.trim(), bundlePath: "/etc/ssl/certs/ca-certificates.crt",
    bundleSha256: sha256(bundle), bundleCertificates: parseCertificates(bundle).map(describeCertificate),
    configSha256: sha256(config), stores };
}

async function networkChecks() {
  const before = await fetchOutcome(positiveUrl);
  emit("positive-control-before", { url: positiveUrl, ...before });
  assertPositive(before);
  for (const endpoint of fixtures.endpoints) {
    const observed = await observePublicChain(endpoint.hostname);
    emit("affected-peer", { hostname: endpoint.hostname, authorized: observed.authorized,
      authorizationError: observed.authorizationError, protocol: observed.protocol,
      certificates: observed.chain.map(describeCertificate) });
    validateAffectedChain(endpoint, observed.chain);
    assert.equal(observed.authorized, false);
    assert.equal(observed.authorizationError, "CERT_REVOKED",
      "The diagnostic TLS verification must identify revocation, not a different failure");
    const url = `https://${endpoint.hostname}/`;
    const result = await fetchOutcome(url);
    emit("affected-fetch", { url, ...result });
    assertRevoked(result);
  }
  const after = await fetchOutcome(positiveUrl);
  emit("positive-control-after", { url: positiveUrl, ...after });
  assertPositive(after);
}

async function main() {
  assert.equal(process.argv.length, 3, "Choose --inventory or --network");
  const mode = process.argv[2];
  assert.ok(["--inventory", "--network"].includes(mode), "Unknown check mode");
  emit("runtime", { mode, version: process.version, openssl: process.versions.openssl,
    platform: process.platform, arch: process.arch, uid: process.getuid?.() });
  assertPatchedRuntime(process.version);
  assertDefaultTrust(process.env, process.execArgv);
  assert.equal(process.platform, "linux", "Run acceptance inside the Linux verifier image");
  assert.ok(process.getuid() > 0, "Acceptance must run as non-root");
  if (mode === "--inventory") emit("ca-inventory", await inventory());
  else await networkChecks();
  emit("passed", { mode });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    emit("failed", { code: error.code ?? error.name, reason: error.message });
    process.exitCode = 1;
  });
}

