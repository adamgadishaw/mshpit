import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  fixtures, assertPatchedRuntime, assertDefaultTrust, parseCertificates,
  validateAffectedChain, assertPositive, assertRevoked, fetchOutcome, observePublicChain,
} from "./verify-video-verifier-security.mjs";

test("runtime gate accepts the patched stable Node 24 line and rejects old, other and prerelease runtimes", () => {
  for (const version of ["v24.22.1", "v24.22.2", "v24.23.0"]) assertPatchedRuntime(version);
  for (const version of ["v24.19.0", "v24.22.0", "v24.16.0", "v22.23.4", "v26.12.1",
    "v24.22.1-rc.1", "24.22.1", "v24.22.1junk"]) {
    assert.throws(() => assertPatchedRuntime(version), /Expected stable Node/);
  }
});

test("acceptance refuses trust, proxy and command-line overrides without printing their values", () => {
  assertDefaultTrust({}, []);
  for (const name of ["NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED",
    "NODE_USE_SYSTEM_CA", "NODE_USE_ENV_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    assert.throws(() => assertDefaultTrust({ [name]: "private-value" }, []), (error) =>
      error.message.includes(name) && !error.message.includes("private-value"));
  }
  assert.throws(() => assertDefaultTrust({}, ["--use-openssl-ca"]), /command-line overrides/);
});

test("public chain fixtures exactly match immutable upstream Git blobs and the Node blocked SPKI", () => {
  assert.deepEqual(fixtures.endpoints.map((entry) => entry.hostname), [
    "dv-g3b-emudhra.we-have-a-problem.com", "dv-g3b-aaa-emudhra.we-have-a-problem.com",
  ]);
  for (const entry of fixtures.endpoints) {
    assert.doesNotMatch(entry.chainPem, /PRIVATE KEY/);
    const bytes = Buffer.from(entry.chainPem);
    const gitSha = createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
    assert.equal(gitSha, entry.sourceBlobSha1);
    assert.equal(entry.intermediateSpkiSha256, "ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105");
    const report = validateAffectedChain(entry, parseCertificates(entry.chainPem), Date.parse("2026-10-27T00:00:00Z"));
    assert.equal(report[1].sha256, entry.intermediateSha256);
  }
});

test("chain evidence rejects expired, not-yet-valid, wrong-host, wrong-key and incomplete chains", () => {
  const entry = fixtures.endpoints[0];
  const chain = parseCertificates(entry.chainPem);
  const now = Date.parse("2026-10-27T00:00:00Z");
  for (const time of ["2025-01-01T00:00:00Z", "2028-01-01T00:00:00Z"]) {
    assert.throws(() => validateAffectedChain(entry, chain, Date.parse(time)), /validity period/);
  }
  assert.throws(() => validateAffectedChain({ ...entry, hostname: "example.com" }, chain, now), /hostname/);
  assert.throws(() => validateAffectedChain({ ...entry, intermediateSha256: "0".repeat(64) }, chain, now), /intermediate/);
  assert.throws(() => validateAffectedChain({ ...entry, intermediateSpkiSha256: "0".repeat(64) }, chain, now), /public key/);
  assert.throws(() => validateAffectedChain(entry, chain.slice(0, 1), now), /Missing/);
  const other = parseCertificates(fixtures.endpoints[1].chainPem);
  assert.throws(() => validateAffectedChain(entry, [other[0], ...chain.slice(1)], now), /hostname/);
});

test("chain evidence checks signatures rather than just issuer names and fingerprints", () => {
  const entry = fixtures.endpoints[0];
  const chain = parseCertificates(entry.chainPem);
  const changedLeaf = Buffer.from(chain[0].raw);
  changedLeaf[changedLeaf.length - 1] ^= 1;
  const badSignature = new X509Certificate(changedLeaf);
  assert.throws(() => validateAffectedChain(entry, [badSignature, ...chain.slice(1)],
    Date.parse("2026-10-27T00:00:00Z")), /signature/);
});

test("only explicit revocation is accepted as a negative result", () => {
  assertRevoked({ kind: "error", code: "CERT_REVOKED", reason: "certificate revoked" });
  for (const code of ["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN",
    "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "TimeoutError", undefined]) {
    assert.throws(() => assertRevoked({ kind: "error", code }), /Only CERT_REVOKED/);
  }
  for (const status of [200, 301, 403, 500]) {
    assert.throws(() => assertRevoked({ kind: "response", status }), /chain was accepted/);
  }
});

test("positive control requires a successful HTTP response, never a connection or certificate failure", () => {
  assertPositive({ kind: "response", status: 200 });
  assert.throws(() => assertPositive({ kind: "error", code: "CERT_REVOKED" }), /control failed/);
  assert.throws(() => assertPositive({ kind: "error", code: "ETIMEDOUT" }), /control failed/);
  assert.throws(() => assertPositive({ kind: "response", status: 500 }), /HTTP status/);
});

test("fetch uses ordinary Node defaults, a bounded credential-free HEAD and no followed redirects", async () => {
  let cancelled = false;
  const result = await fetchOutcome("https://nodejs.org/", async (url, options) => {
    assert.equal(url, "https://nodejs.org/");
    assert.deepEqual(Object.keys(options).sort(), ["method", "redirect", "signal"]);
    assert.equal(options.method, "HEAD");
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    return { status: 200, body: { cancel: async () => { cancelled = true; } } };
  });
  assert.deepEqual(result, { kind: "response", status: 200 });
  assert.equal(cancelled, true);
});

test("fetch reports the actual TLS cause and keeps transport failures distinct", async () => {
  for (const code of ["CERT_REVOKED", "CERT_HAS_EXPIRED", "ENOTFOUND"]) {
    const result = await fetchOutcome("https://nodejs.org/", async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
    });
    assert.deepEqual(result, { kind: "error", code, reason: code });
  }
});

test("a diagnostic socket closing before TLS completion rejects rather than silently ending the gate", async () => {
  const socket = new EventEmitter();
  socket.destroy = () => {};
  const pending = observePublicChain(fixtures.endpoints[0].hostname, () => socket);
  socket.emit("close");
  await assert.rejects(pending, { code: "ECONNRESET" });
});

test("TLS observation records public certificates without sending application data or claiming acceptance", async () => {
  const endpoint = fixtures.endpoints[0];
  const certificates = parseCertificates(endpoint.chainPem);
  let peer;
  for (const cert of [...certificates].reverse()) peer = { raw: cert.raw, issuerCertificate: peer };
  const socket = new EventEmitter();
  let destroyed = false;
  socket.destroy = () => { destroyed = true; };
  socket.write = () => assert.fail("diagnostic must send no application data");
  socket.getPeerCertificate = (detailed) => { assert.equal(detailed, true); return peer; };
  socket.getProtocol = () => "TLSv1.3";
  socket.authorized = false;
  socket.authorizationError = "CERT_REVOKED";
  const pending = observePublicChain(endpoint.hostname, (options) => {
    assert.deepEqual(options, { host: endpoint.hostname, servername: endpoint.hostname, port: 443,
      rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
    return socket;
  });
  socket.emit("secureConnect");
  const observed = await pending;
  assert.equal(observed.authorized, false);
  assert.equal(observed.authorizationError, "CERT_REVOKED");
  assert.equal(observed.chain.length, certificates.length);
  assert.equal(destroyed, true);
});

