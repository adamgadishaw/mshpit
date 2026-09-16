import assert from "node:assert/strict";
import test from "node:test";
import {
  ARTIST_KNOWLEDGE_BIO_LIMIT, ARTIST_KNOWLEDGE_RESPONSE_LIMIT,
  ArtistKnowledgeProviderError, artistKnowledgeRetryAt, createArtistKnowledgeProvider,
  parseArtistKnowledgeSearch, parseArtistKnowledgeEntity, parseArtistKnowledgeCountry, parseArtistKnowledgeWikipedia,
} from "./artistKnowledgeProvider.js";

const MBID = "25b7b584-d952-4662-a8b9-dd8cdfbfeb64";
const OTHER_MBID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AT = 1_800_000_000_000;
const claim = (property, value, rank = "normal") => ({ rank, mainsnak: { property, snaktype: "value", datavalue: { value } } });
const search = (ids = ["Q42"]) => ({ query: { searchinfo: { totalhits: ids.length }, search: ids.map(title => ({ ns: 0, title })) } });
const entity = (change = {}) => ({ entities: { Q42: {
  id: "Q42", type: "item", claims: { P434: [claim("P434", MBID)], P495: [claim("P495", { id: "Q16" })] },
  sitelinks: { enwiki: { site: "enwiki", title: "Fixture Artist", url: "https://untrusted.example/do-not-fetch" } }, ...change,
} } });
const wiki = (change = {}) => ({ query: { pages: [{ pageid: 123, ns: 0, title: "Fixture Artist", lastrevid: 456,
  pageprops: { wikibase_item: "Q42" }, extract: "Fixture Artist is a musical act.\n\nThe act performs live.", ...change }] } });
const country = { entities: { Q16: { id: "Q16", type: "item", labels: { en: { language: "en", value: "Canada" } } } } };
const json = (value, options = {}) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" }, ...options });

function fixture(responses = [search(), entity(), wiki(), country], options = {}) {
  let clock = AT;
  const calls = [], waits = [];
  const provider = createArtistKnowledgeProvider({ clock: () => clock, wait: async ms => { waits.push(ms); clock += ms; }, ...options });
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init, at: clock });
    const response = responses.shift();
    assert.ok(response, "Unexpected outbound request");
    return typeof response === "function" ? response(url, init) : response instanceof Response ? response : json(response);
  };
  return { calls, waits, provider, fetchImpl, run: (parameters = {}) => provider({ mbid: MBID, fetchImpl, now: () => clock, ...parameters }) };
}

test("exact MBID lookup produces bounded Wikipedia attribution and a directly related country", async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(result, {
    mbid: MBID, wikidataId: "Q42", wikidataUrl: "https://www.wikidata.org/wiki/Q42", country: "Canada",
    bio: "Fixture Artist is a musical act. The act performs live.",
    bioSource: { provider: "wikipedia", url: "https://en.wikipedia.org/wiki/Fixture_Artist",
      revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=456", license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", modified: true, mbid: MBID,
      wikidataId: "Q42", retrievedAt: AT + 2200 },
  });
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[0].url.searchParams.get("srsearch"), `haswbstatement:P434=${MBID}`);
  assert.equal(f.calls[0].url.searchParams.get("srlimit"), "2");
  assert.equal(f.calls[1].url.searchParams.get("ids"), "Q42");
  assert.equal(f.calls[2].url.searchParams.get("titles"), "Fixture Artist");
  assert.equal(f.calls[2].url.searchParams.get("exintro"), "1");
  assert.equal(f.calls[2].url.searchParams.get("explaintext"), "1");
  assert.equal(f.calls[3].url.searchParams.get("ids"), "Q16");
  for (const call of f.calls) {
    assert.ok(["www.wikidata.org", "en.wikipedia.org"].includes(call.url.hostname));
    assert.equal(call.url.searchParams.get("maxlag"), "5");
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.init.credentials, "omit");
    assert.match(call.init.headers["User-Agent"], /MshpitArtistKnowledge.*support@mshpit\.com/);
  }
  assert.deepEqual(f.waits, [1100, 1100, 1100]);
});

test("statement ambiguity, continuation and no exact match never become a guessed artist", async () => {
  for (const payload of [search([]), search(["Q42", "Q43"]), { ...search(), continue: { sroffset: 1 } }, search(["Q42|Q43"]), search(["https://evil.example"])]) {
    const f = fixture([payload]);
    assert.equal(await f.run(), null);
    assert.equal(f.calls.length, 1);
  }
  assert.throws(() => parseArtistKnowledgeSearch({}), error => error.code === "wikidata_response");
  assert.throws(() => parseArtistKnowledgeSearch({ query: { searchinfo: { totalhits: 1 }, search: [] } }), error => error.code === "wikidata_response");
});

test("entity response must corroborate the exact, unique non-deprecated MBID", async () => {
  for (const payload of [entity({ id: "Q43" }), entity({ missing: "" }), entity({ claims: {} }), entity({ claims: { P434: [claim("P434", OTHER_MBID)] } }),
    entity({ claims: { P434: [claim("P434", MBID), claim("P434", OTHER_MBID)] } }), entity({ claims: { P434: [claim("P434", MBID, "deprecated")] } })]) {
    assert.equal(parseArtistKnowledgeEntity(payload, { mbid: MBID, wikidataId: "Q42" }), null);
    const f = fixture([search(), payload]);
    assert.equal(await f.run(), null);
    assert.equal(f.calls.length, 2);
  }
  for (const uncertain of [claim("P434", "not-an-id"), { mainsnak: { property: "P434", snaktype: "somevalue" } }]) {
    assert.equal(parseArtistKnowledgeEntity(entity({ claims: { P434: [claim("P434", MBID), uncertain] } }), { mbid: MBID, wikidataId: "Q42" }), null);
  }
});

test("MBID syntax matches the existing artist identity validator, independent of UUID version", async () => {
  const futureMbid = "11111111-1111-7111-f111-111111111111";
  const f = fixture([search(), entity({ claims: { P434: [claim("P434", futureMbid)] } })]);
  assert.deepEqual(await f.run({ mbid: futureMbid.toUpperCase(), needBio: false, needCountry: true }), {
    mbid: futureMbid, wikidataId: "Q42", wikidataUrl: "https://www.wikidata.org/wiki/Q42",
  });
  assert.equal(f.calls.length, 2);
});

test("country is omitted for multiple origins/citizenships or a wrong country-label entity", async () => {
  const ambiguous = entity({ claims: { P434: [claim("P434", MBID)], P495: [claim("P495", { id: "Q16" })], P27: [claim("P27", { id: "Q30" })] } });
  const f = fixture([search(), ambiguous]);
  const result = await f.run({ needBio: false });
  assert.equal(result.country, undefined); assert.equal(f.calls.length, 2);
  assert.equal(parseArtistKnowledgeCountry({ entities: { Q16: { id: "Q30", type: "item", labels: country.entities.Q16.labels } } }, "Q16"), null);
  assert.equal(parseArtistKnowledgeCountry({ entities: { Q16: { ...country.entities.Q16, labels: { en: { language: "fr", value: "Canada" } } } } }, "Q16"), null);
  assert.equal(parseArtistKnowledgeCountry(country, "Q16|Q30"), null);
  for (const uncertain of [claim("P27", { id: "not-a-qid" }), { mainsnak: { property: "P27", snaktype: "somevalue" } }]) {
    const projection = parseArtistKnowledgeEntity(entity({ claims: { P434: [claim("P434", MBID)], P495: [claim("P495", { id: "Q16" })], P27: [uncertain] } }), { mbid: MBID, wikidataId: "Q42" });
    assert.equal(projection.countryId, null);
  }
});

test("Wikipedia must be an existing main-namespace non-disambiguation page for the same QID", () => {
  for (const payload of [wiki({ pageprops: { wikibase_item: "Q43" } }), wiki({ pageprops: { wikibase_item: "Q42", disambiguation: "" } }),
    wiki({ ns: 1 }), wiki({ missing: true }), wiki({ lastrevid: 0 }), wiki({ lastrevid: "456" }), wiki({ title: "A|B" }),
    wiki({ extract: "<script>wrong</script>" })]) {
    assert.equal(parseArtistKnowledgeWikipedia(payload, { mbid: MBID, wikidataId: "Q42", retrievedAt: AT }), null);
  }
  assert.throws(() => parseArtistKnowledgeWikipedia({}, { mbid: MBID, wikidataId: "Q42", retrievedAt: AT }), error => error.code === "wikipedia_response");
});

test("biography text and source URLs are constructed and bounded without trusting response URLs", async () => {
  const page = wiki({ title: "AC/DC", extract: "music ".repeat(1000), fullurl: "https://evil.example/private" });
  const f = fixture([search(), entity(), page]);
  const result = await f.run({ needCountry: false });
  assert.equal([...result.bio].length <= ARTIST_KNOWLEDGE_BIO_LIMIT, true);
  assert.match(result.bio, /…$/u);
  assert.equal(result.bioSource.url, "https://en.wikipedia.org/wiki/AC%2FDC");
  assert.equal(JSON.stringify(result).includes("evil.example"), false);
  assert.equal(f.calls.some(call => call.url.hostname === "evil.example"), false);
});

test("invalid input and unwanted fields cannot trigger injected URLs or extra provider work", async () => {
  for (const mbid of ["", MBID + '" SERVICE <https://evil.example>', "https://evil.example", "../" + MBID]) {
    const f = fixture([]);
    await assert.rejects(f.run({ mbid }), TypeError); assert.equal(f.calls.length, 0);
  }
  const neither = fixture([]);
  assert.equal(await neither.run({ needBio: false, needCountry: false }), null);
  const noWiki = fixture([search(), entity({ sitelinks: { enwiki: { site: "enwiki", title: "Bad|title" } } }), country]);
  assert.equal((await noWiki.run()).bio, undefined);
  assert.equal(noWiki.calls.some(call => call.url.hostname === "en.wikipedia.org"), false);
});

test("redirect responses and unexpected final origins are rejected and disposed without following", async () => {
  for (const redirected of [false, true]) {
    let cancelled = false;
    const f = fixture([() => ({ ok: redirected, status: redirected ? 200 : 302, redirected,
      url: redirected ? "https://evil.example/secret" : "", headers: new Headers({ location: "http://127.0.0.1/private" }),
      body: { cancel: async () => { cancelled = true; } },
    })]);
    await assert.rejects(f.run(), error => error.code === "wikidata_redirect");
    assert.equal(cancelled, true); assert.equal(f.calls.length, 1);
  }
});

test("429, 503 and action maxlag retain Retry-After and prevent immediate subsequent requests", async () => {
  for (const [status, payload, code] of [[429, {}, "wikidata_rate_limited"], [503, {}, "wikidata_unavailable"], [200, { error: { code: "maxlag", info: "not retained" } }, "wikidata_maxlag"]]) {
    let cancelled = false;
    const response = status === 200 ? json(payload, { headers: { "retry-after": "120" } }) : {
      ok: false, status, headers: new Headers({ "retry-after": "120" }), body: { cancel: async () => { cancelled = true; } },
    };
    const f = fixture([response instanceof Response ? response : () => response]);
    await assert.rejects(f.run(), error => error instanceof ArtistKnowledgeProviderError && error.code === code && error.retryAt === AT + 120_000);
    await assert.rejects(f.run(), error => error.code === code && error.retryAt === AT + 120_000);
    assert.equal(f.calls.length, 1);
    if (status !== 200) assert.equal(cancelled, true);
  }
  assert.equal(artistKnowledgeRetryAt({ headers: new Headers({ "retry-after": new Date(AT + 3600_000).toUTCString() }) }, AT), AT + 3600_000);
});

test("network errors, malformed JSON and oversized bodies remain provider errors rather than no-match", async () => {
  for (const response of [() => { throw new Error("network down"); }, new Response("not json"), json({ padding: "x".repeat(ARTIST_KNOWLEDGE_RESPONSE_LIMIT) })]) {
    const f = fixture([response]);
    await assert.rejects(f.run(), error => error instanceof ArtistKnowledgeProviderError && /wikidata_(?:network|response)/u.test(error.code));
  }
  let cancelled = false;
  const f = fixture([() => ({ ok: true, status: 200, headers: new Headers({ "content-length": String(ARTIST_KNOWLEDGE_RESPONSE_LIMIT + 1) }),
    body: { cancel: async () => { cancelled = true; } },
  })]);
  await assert.rejects(f.run(), error => error.code === "wikidata_response");
  assert.equal(cancelled, true);
});

test("timeouts bound both response headers and a stalled body; caller abort remains caller cancellation", async () => {
  const never = () => new Promise(() => {});
  const headers = fixture([never], { timeoutMs: 20 });
  await assert.rejects(headers.run(), error => error.code === "wikidata_timeout");
  let cancelled = false;
  const body = fixture([new Response(new ReadableStream({ cancel() { cancelled = true; } }))], { timeoutMs: 20 });
  await assert.rejects(body.run(), error => error.code === "wikidata_timeout");
  assert.equal(cancelled, true);
  const controller = new AbortController();
  const cancel = fixture([(_url, init) => { controller.abort(); assert.equal(init.signal.aborted, true); return never(); }]);
  await assert.rejects(cancel.run({ signal: controller.signal }), error => error.name === "AbortError" && !(error instanceof ArtistKnowledgeProviderError));
  const noRequest = fixture([]); controller.abort();
  await assert.rejects(noRequest.run({ signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(noRequest.calls.length, 0);
});

test("concurrent request starts are serialized and spaced; capacity and queued cancellation are bounded", async () => {
  const f = fixture([search([]), search([]), search([])]);
  assert.deepEqual(await Promise.all([f.run(), f.run(), f.run()]), [null, null, null]);
  assert.deepEqual(f.calls.map(call => call.at), [AT, AT + 1100, AT + 2200]);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const limited = fixture([() => held], { maxPending: 2 });
  const first = limited.run();
  const controller = new AbortController();
  const queued = limited.run({ signal: controller.signal });
  await assert.rejects(limited.run(), error => error.code === "knowledge_busy");
  controller.abort();
  await assert.rejects(queued, error => error.name === "AbortError");
  release(json(search([])));
  assert.equal(await first, null);
  assert.equal(limited.calls.length, 1);
});

test("three lookups overlap slow responses without multiplying aggregate request-start rate", async () => {
  let clock = AT;
  const starts = [], releases = [];
  const provider = createArtistKnowledgeProvider({ clock: () => clock, wait: async ms => { clock += ms; } });
  const fetchImpl = () => {
    starts.push(clock);
    return new Promise(resolve => releases.push(() => resolve(json(search([])))));
  };
  const runs = [1, 2, 3].map(() => provider({ mbid: MBID, fetchImpl, now: () => clock }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.length, 3, "three response reads can overlap");
  assert.deepEqual(starts, [AT, AT + 1100, AT + 2200]);
  releases.forEach(release => release());
  assert.deepEqual(await Promise.all(runs), [null, null, null]);
});

test("durable per-request admission can stop later provider steps before fetching", async () => {
  let reserved = 0;
  const f = fixture([search(), entity()]);
  await assert.rejects(f.run({ beforeRequest: () => {
    if (++reserved > 2) throw Object.assign(new Error("Paused"), { code: "CATALOG_PAUSED" });
  } }), error => error.code === "CATALOG_PAUSED");
  assert.equal(f.calls.length, 2);
});

test("a shared cooldown is rechecked at the gate after another lane reports an outage", async () => {
  let clock = AT;
  let releaseWait;
  const calls = [];
  const provider = createArtistKnowledgeProvider({ clock: () => clock, wait: () => new Promise(resolve => { releaseWait = resolve; }) });
  const first = provider({ mbid: MBID, now: () => clock, fetchImpl: async () => {
    calls.push(clock); return new Response("unavailable", { status: 503, headers: { "retry-after": "120" } });
  } });
  const second = provider({ mbid: OTHER_MBID, now: () => clock, fetchImpl: async () => {
    calls.push(clock); return json(search([]));
  } });
  const outcomes = Promise.allSettled([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  clock += 1100; releaseWait();
  const results = await outcomes;
  assert.equal(results.every(value => value.status === "rejected"), true);
  assert.equal(calls.length, 1);
});

test("a deferred lookup resumes validated steps without spending the request budget again", async () => {
  const f = fixture();
  let spent = 0;
  await assert.rejects(f.run({ beforeRequest: () => {
    if (++spent > 2) throw Object.assign(new Error("Time slice ended"), { code: "CATALOG_PAUSED" });
  } }), error => error.code === "CATALOG_PAUSED");
  assert.equal(f.calls.length, 2);
  const resumed = await f.run();
  assert.equal(resumed.country, "Canada");
  assert.ok(resumed.bio);
  assert.equal(f.calls.length, 4, "the two already validated source requests are reused");
  resumed.bioSource.wikidataId = "Q999";
  assert.equal((await f.run()).bioSource.wikidataId, "Q42", "caller cannot mutate cached source proof");
  assert.equal(f.calls.length, 4);
});

test("country labels are shared across exact identities, never artist facts", async () => {
  const second = entity({ claims: { P434: [claim("P434", OTHER_MBID)], P495: [claim("P495", { id: "Q16" })] } });
  const f = fixture([search(), entity(), country, search(), second]);
  const first = await f.run({ needBio: false });
  const next = await f.run({ mbid: OTHER_MBID, needBio: false });
  assert.equal(first.country, "Canada"); assert.equal(next.country, "Canada");
  assert.equal(next.mbid, OTHER_MBID);
  assert.equal(f.calls.length, 5, "one validated country label serves both artist checks");
});

test("source checkpoints expire and revalidate identity instead of extending forever on reads", async () => {
  const f = fixture([search(), entity(), wiki(), country, search([])]);
  await f.run();
  assert.equal(await f.run({ now: () => AT + 60 * 60_000 + 1 }), null);
  assert.equal(f.calls.length, 5);
});

test("ten catch-up slots retain the same shared request rate and reject an eleventh", async () => {
  let clock = AT;
  const starts = [], releases = [];
  const provider = createArtistKnowledgeProvider({ clock: () => clock, wait: async ms => { clock += ms; } });
  const options = { mbid: MBID, now: () => clock, fetchImpl: () => {
    starts.push(clock); return new Promise(resolve => releases.push(() => resolve(json(search([])))));
  } };
  const runs = Array.from({ length: 10 }, () => provider(options));
  await assert.rejects(provider(options), error => error.code === "knowledge_busy");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts.length, 10);
  assert.ok(starts.every((start, i) => i === 0 || start - starts[i - 1] >= 1100));
  releases.forEach(release => release());
  await Promise.all(runs);
});
