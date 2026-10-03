import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogPilotClient } from "./catalog-api-pilot.mjs";

test("pilot transport rejects unsafe origins and needs explicit bounded writes", async () => {
  for (const baseUrl of ["http://example.test", "https://user:secret@example.test", "https://example.test/path", "https://example.test/?q=1", "http://localhost:8000"]) {
    assert.throws(() => createCatalogPilotClient({ baseUrl, allowLoopback: true }));
  }
  let calls = 0;
  const client = createCatalogPilotClient({ baseUrl: "https://catalog.example.test", fetchImpl: async (url, options) => {
    calls++; assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
    if (url.pathname.endsWith("/exchange")) {
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({ accessToken: "s".repeat(43), grantId: "fixture-grant" });
    }
    assert.equal(options.headers.Authorization, `Bearer ${"s".repeat(43)}`);
    return Response.json({ safe: true });
  } });
  await assert.rejects(() => client.execute({ operation: "read", type: "artist", key: "test" }), /Pair/u);
  assert.deepEqual(await client.pair("p".repeat(43)), { grantId: "fixture-grant" });
  await assert.rejects(() => client.pair("p".repeat(43)), /already paired/u);
  await assert.rejects(() => client.execute({ operation: "commit", type: "artist", key: "test" }), /explicit/u);
  await assert.rejects(() => client.execute({ operation: "commit", type: "artist", key: "test", confirmWrite: true,
    idempotencyKey: "safe-key-0001", body: { value: "x".repeat(22001) } }), /bounded/u);
  assert.equal(calls, 1);
  await client.execute({ operation: "read", type: "artist", key: "test" });
  client.close();
  await assert.rejects(() => client.execute({ operation: "read", type: "artist", key: "test" }), /Pair/u);
  assert.equal(calls, 2);
});

test("pilot bounds untrusted response bytes and does not retry failures", async () => {
  let calls = 0;
  const client = createCatalogPilotClient({ baseUrl: "https://catalog.example.test", fetchImpl: async () => {
    calls++; return new Response("x".repeat(131073));
  } });
  await assert.rejects(() => client.pair("p".repeat(43)), /exceeded/u); assert.equal(calls, 1);
  const invalid = createCatalogPilotClient({ baseUrl: "https://catalog.example.test", fetchImpl: async () => Response.json({ accessToken: "malformed" }) });
  await assert.rejects(() => invalid.pair("p".repeat(43)), /Invalid/u);
});
