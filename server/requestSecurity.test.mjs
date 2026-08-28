import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  allowedUnsafeRequestOrigins,
  assertProductionRequestHost,
  assertUnsafeRequestOrigin,
  clientIpFromRequest,
  isJsonContentType,
  readJsonBody,
} from "./requestSecurity.js";

function request(body = "", headers = {}, remoteAddress = "127.0.0.1") {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.headers = headers;
  stream.socket = { remoteAddress };
  return stream;
}

test("unsafe requests reject foreign browser origins but admit exact production and Expo dev origins", () => {
  const production = allowedUnsafeRequestOrigins({ production: true, publicOrigin: "https://www.mshpit.com" });
  assert.doesNotThrow(() => assertUnsafeRequestOrigin("POST", {
    origin: "https://www.mshpit.com",
    "sec-fetch-site": "same-origin",
  }, production));
  assert.doesNotThrow(() => assertUnsafeRequestOrigin("POST", {
    origin: "https://mshpit.com",
    "sec-fetch-site": "same-site",
  }, production));
  assert.throws(() => assertUnsafeRequestOrigin("POST", {
    origin: "https://evil.example",
    "sec-fetch-site": "cross-site",
  }, production), (error) => error.status === 403 && error.code === "FORBIDDEN");
  assert.throws(() => assertUnsafeRequestOrigin("DELETE", {
    origin: "null",
    "sec-fetch-site": "same-site",
  }, production), (error) => error.status === 403);

  const development = allowedUnsafeRequestOrigins({ production: false, port: 3000 });
  assert.doesNotThrow(() => assertUnsafeRequestOrigin("PATCH", {
    origin: "http://localhost:8081",
    "sec-fetch-site": "same-site",
  }, development));
});

test("production Host validation allows the custom domain and canonical apex pair", () => {
  for (const host of ["www.mshpit.com", "mshpit.com", "www.mshpit.com:443"]) {
    assert.doesNotThrow(() => assertProductionRequestHost({
      production: true,
      method: "GET",
      pathname: "/feed",
      host,
      publicOrigin: "https://www.mshpit.com",
      renderExternalHostname: "mshpit.onrender.com",
    }));
  }
  assert.doesNotThrow(() => assertProductionRequestHost({
    production: true,
    method: "GET",
    pathname: "/feed",
    host: "staging.example.test",
    publicOrigin: "https://staging.example.test",
  }));
});

test("the Render hostname is limited to liveness/readiness probes and foreign or malformed hosts are rejected", () => {
  for (const pathname of ["/api/health", "/api/readiness"]) {
    assert.doesNotThrow(() => assertProductionRequestHost({
      production: true,
      method: "GET",
      pathname,
      host: "mshpit.onrender.com",
      publicOrigin: "https://www.mshpit.com",
      renderExternalHostname: "mshpit.onrender.com",
    }));
  }
  for (const candidate of [
    { host: "mshpit.onrender.com", pathname: "/api/me" },
    { host: "foreign.example", pathname: "/api/health" },
    { host: "evil.example@www.mshpit.com", pathname: "/" },
    { host: "www.mshpit.com/evil", pathname: "/" },
    { host: "", pathname: "/" },
  ]) {
    assert.throws(() => assertProductionRequestHost({
      production: true,
      method: "GET",
      ...candidate,
      publicOrigin: "https://www.mshpit.com",
      renderExternalHostname: "mshpit.onrender.com",
    }), (error) => error.status === 400 && error.code === "VALIDATION_FAILED");
  }
  assert.doesNotThrow(() => assertProductionRequestHost({ production: false, host: "foreign.example" }));
});

test("native and bodyless unsafe calls remain valid without browser origin metadata", () => {
  const production = allowedUnsafeRequestOrigins({ production: true, publicOrigin: "https://www.mshpit.com" });
  assert.doesNotThrow(() => assertUnsafeRequestOrigin("POST", {}, production));
  assert.doesNotThrow(() => assertUnsafeRequestOrigin("GET", {
    origin: "https://evil.example",
    "sec-fetch-site": "cross-site",
  }, production));
});

test("same-site sibling requests cannot use a session when their exact Origin is absent", () => {
  const production = allowedUnsafeRequestOrigins({ production: true, publicOrigin: "https://www.mshpit.com" });
  assert.throws(() => assertUnsafeRequestOrigin("POST", {
    "sec-fetch-site": "same-site",
  }, production), (error) => error.status === 403);
});

test("cross-site text/plain login payloads fail both browser and JSON request boundaries", async () => {
  const production = allowedUnsafeRequestOrigins({ production: true, publicOrigin: "https://www.mshpit.com" });
  assert.throws(() => assertUnsafeRequestOrigin("POST", {
    origin: "https://attacker.example",
    "sec-fetch-site": "cross-site",
    "content-type": "text/plain",
  }, production), (error) => error.status === 403 && error.code === "FORBIDDEN");

  await assert.rejects(
    readJsonBody(request('{"email":"owner@example.test","password":"guess"}', {
      "content-type": "text/plain",
      "content-length": "54",
    })),
    (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED",
  );
});

test("first-party and Expo development JSON writes remain valid, including a bodyless POST", async () => {
  const production = allowedUnsafeRequestOrigins({ production: true, publicOrigin: "https://www.mshpit.com" });
  assert.doesNotThrow(() => assertUnsafeRequestOrigin("POST", {
    origin: "https://www.mshpit.com",
    "sec-fetch-site": "same-origin",
  }, production));
  assert.deepEqual(await readJsonBody(request('{"ok":true}', {
    "content-type": "application/json",
    "content-length": "11",
  })), { ok: true });

  const development = allowedUnsafeRequestOrigins({ production: false, port: 3000 });
  assert.doesNotThrow(() => assertUnsafeRequestOrigin("POST", {
    origin: "http://127.0.0.1:8081",
    "sec-fetch-site": "same-site",
  }, development));
  assert.deepEqual(await readJsonBody(request()), {});
});

test("JSON body policy accepts empty calls and JSON media types only", async () => {
  assert.equal(isJsonContentType("application/json"), true);
  assert.equal(isJsonContentType("Application/Problem+Json; charset=utf-8"), true);
  assert.equal(isJsonContentType("text/plain"), false);
  assert.deepEqual(await readJsonBody(request()), {});
  assert.deepEqual(await readJsonBody(request('{"ok":true}', {
    "content-type": "application/json; charset=utf-8",
    "content-length": "11",
  })), { ok: true });
});

test("declared and undeclared non-JSON bodies are both rejected", async () => {
  await assert.rejects(
    readJsonBody(request('{"email":"attacker@example.com"}', {
      "content-type": "text/plain",
      "content-length": "32",
    })),
    (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED",
  );
  // A misleading request with no length/transfer declaration must not bypass the
  // check if bytes still arrive on the stream.
  await assert.rejects(
    readJsonBody(request('{"ok":true}', { "content-type": "text/plain" })),
    (error) => error.status === 415,
  );
});

test("JSON body policy preserves invalid-json and size errors", async () => {
  await assert.rejects(
    readJsonBody(request("{", { "content-type": "application/json", "content-length": "1" })),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  await assert.rejects(
    readJsonBody(request('{"long":true}', { "content-type": "application/json", "content-length": "13" }), { limit: 4 }),
    (error) => error.status === 413 && error.code === "REQUEST_TOO_LARGE",
  );
});

test("outside Render, direct callers cannot forge CF-Connecting-IP or either side of XFF", () => {
  const directPublic = request("", {
    "cf-connecting-ip": "203.0.113.200",
    "x-forwarded-for": "203.0.113.201, 198.51.100.10",
  }, "198.51.100.9");
  assert.equal(clientIpFromRequest(directPublic), "198.51.100.9");

  const localDirect = request("", {
    "cf-connecting-ip": "203.0.113.200",
    "x-forwarded-for": "203.0.113.201, 198.51.100.9",
  }, "10.42.0.7");
  assert.equal(clientIpFromRequest(localDirect), "10.42.0.7");
});

test("Render trusts its overwritten single-value header only from an approved ingress socket", () => {
  const throughRender = request("", {
    "cf-connecting-ip": "203.0.113.45",
    "x-forwarded-for": "198.51.100.66, 203.0.113.99",
  }, "::ffff:10.42.0.7");
  assert.equal(clientIpFromRequest(throughRender, { renderEnvironment: true }), "203.0.113.45");

  const unapprovedSocket = request("", {
    "cf-connecting-ip": "203.0.113.45",
    "x-forwarded-for": "198.51.100.66",
  }, "198.51.100.9");
  assert.equal(clientIpFromRequest(unapprovedSocket, { renderEnvironment: true }), "198.51.100.9");
});

test("ambiguous fake-real and real-fake XFF chains both fail closed to Render ingress", () => {
  const fakeThenReal = request("", {
    "x-forwarded-for": "203.0.113.250, 198.51.100.9",
  }, "10.42.0.7");
  const realThenFake = request("", {
    "x-forwarded-for": "198.51.100.9, 203.0.113.250",
  }, "10.42.0.7");
  assert.equal(clientIpFromRequest(fakeThenReal, { renderEnvironment: true }), "10.42.0.7");
  assert.equal(clientIpFromRequest(realThenFake, { renderEnvironment: true }), "10.42.0.7");
});

test("missing, malformed, or multi-valued Render client headers fail closed to ingress", () => {
  for (const value of [undefined, "not-an-ip", "203.0.113.1, 203.0.113.2"]) {
    const headers = { "x-forwarded-for": "198.51.100.9" };
    if (value !== undefined) headers["cf-connecting-ip"] = value;
    const malformed = request("", headers, "10.42.0.7");
    assert.equal(clientIpFromRequest(malformed, { renderEnvironment: true }), "10.42.0.7");
  }
});
