import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPublicIdentityFixture, identityPaths } from "../scripts/verify-public-identity-browser.mjs";
import { publicBrowserDestination } from "../src/domain/publicBrowserDestination.mjs";
import { publicFramePath } from "../src/domain/publicFrameNavigation.mjs";
import { publicNavigationLinks } from "../src/domain/publicNavigationLinks.mjs";
import { normalizePublicEventSnapshot } from "../src/domain/publicEventSnapshot.mjs";

const fixture = await createPublicIdentityFixture();
after(async () => { await fixture.close(); assert.deepEqual(fixture.failures, []); });
const get = async (path) => {
  const response = await fetch(fixture.origin + path);
  assert.equal(response.status, 200, path);
  return response;
};
const resolveEntity = async path => (await (await get(`/api/resolve?path=${encodeURIComponent(path)}`)).json()).entity;

test("provider-specific venue identity survives real HTTP resolution, hydration and canonical roundtrip", async () => {
  for (const [path, providerVenueId, city] of [
    [identityPaths.toronto, "identity-toronto-room", "Toronto"],
    [identityPaths.ottawa, "identity-ottawa-room", "Ottawa"],
  ]) {
    const html = await (await get(path)).text();
    assert.ok(html.includes(`rel="canonical" href="${fixture.origin}${path}"`));
    assert.ok(html.includes(city));
    const entity = await resolveEntity(path);
    assert.equal(entity.providerVenueId, providerVenueId);
    assert.equal(entity.source, "ticketmaster");
    const destination = await publicBrowserDestination(path, { resolveEntity });
    assert.equal(destination.path, path);
    assert.equal(publicFramePath(destination.stack.at(-1)), path);
    assert.deepEqual(await resolveEntity(publicFramePath(destination.stack.at(-1))), entity);
    const head = await (await get(`/api/page-head?path=${encodeURIComponent(path)}`)).json();
    assert.ok(head.head.includes(`rel="canonical" href="${fixture.origin}${path}"`));
  }
  assert.equal(await resolveEntity(identityPaths.ambiguousVenue), null);
  assert.equal((await fetch(fixture.origin + identityPaths.ambiguousVenue)).status, 404);
});

test("real event SSR, resolver, normalized snapshot and hydrated artist href agree on a colliding stable identity", async () => {
  const entity = await resolveEntity(identityPaths.event);
  assert.equal(entity.artistKey, "identity-twins-ca");
  assert.equal(entity.artistPublicSlug, "identity-twins-ca");
  assert.equal(normalizePublicEventSnapshot(entity, entity.id).artistPublicSlug, "identity-twins-ca");
  const destination = await publicBrowserDestination(identityPaths.event, { resolveEntity });
  const link = publicNavigationLinks(destination.stack.at(-1)).find(item => item.label === "Identity Twins");
  assert.equal(link.href, identityPaths.artist);
  assert.equal(link.target.value.publicSlug, "identity-twins-ca");
  const html = await (await get(identityPaths.event)).text();
  assert.ok(html.includes(`href="${identityPaths.artist}"`));
  assert.equal((await resolveEntity(link.href)).artistKey, entity.artistKey);
  assert.equal((await resolveEntity(identityPaths.namesake)).artistKey, "identity-twins-us");
});

test("pending, conflicting and unbound events remain readable without a fabricated artist destination", async () => {
  for (const path of [identityPaths.pending, identityPaths.conflict, identityPaths.unknown]) {
    const entity = await resolveEntity(path);
    assert.equal(entity.artistKey, null);
    assert.equal(entity.artistPublicSlug, null);
    assert.equal(normalizePublicEventSnapshot(entity, entity.id).artistPublicSlug, null);
    const destination = await publicBrowserDestination(path, { resolveEntity });
    const link = publicNavigationLinks(destination.stack.at(-1)).find(item => item.label === "Identity Twins");
    assert.equal(link.href, null);
    assert.equal(link.target, null);
    assert.equal(destination.path, path);
    const html = await (await get(path)).text();
    assert.ok(!html.includes(`href="${identityPaths.artist}"`));
    assert.ok(!html.includes(`href="${identityPaths.namesake}"`));
  }
});
