import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { archiveShowKey } from "./features/artistArchive/artistArchiveKeys.js";
import { concertPath } from "../src/domain/urls.mjs";

const dataDir = mkdtempSync(join(tmpdir(), "pit-seo-canonical-aliases-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PUBLIC_ORIGIN = "https://www.example.com";
const { db, q } = await import("./db.js");
const { seoHttpPlan, resolveEntity, pageHeadFor, headTagsFor } = await import("./seo.js");
const { concertSitemapEntries } = await import("./features/seo/sitemapService.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

q.insertUser.run("canonical-fan", "canonical@example.com", "Canonical Fan", "canonicalfan", "hash", "fan",
  null, null, null, "CA", "#111111", Date.now());
db.prepare(`INSERT INTO posts
  (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,room,review,photos,photos_public,kind,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,'[]',0,'review',?)`).run(
  "canonical-review", "canonical-fan", "Canonical Band", "canonical band", "Canonical Hall", "canonical hall",
  "Toronto", "2026-08-20", 5, 4,
  "A firsthand account of the concert, with precise details about the sound, room and encore for this night.", Date.now(),
);

const identity = { artistIdentity: "canonical band", venueIdentity: "canonical hall", date: "2026-08-20" };
const canonicalKey = archiveShowKey(identity);
const canonicalPath = concertPath(canonicalKey);
const encoded = (parts, pretty = false) => `show.${Buffer.from(JSON.stringify(parts, null, pretty ? 1 : undefined)).toString("base64url")}`;

test("old city-bearing and equivalent encoded concert keys redirect to the exact sitemap identity", () => {
  const canonical = seoHttpPlan(canonicalPath);
  assert.equal(canonical.type, "document");
  assert.equal(canonical.status, 200);
  assert.equal(canonical.indexable, true);
  assert.equal(canonical.document.reviews[0].id, "canonical-review");
  assert.equal(concertSitemapEntries(db).filter((entry) => entry.path === canonicalPath).length, 1);
  const variants = [
    encoded([identity.artistIdentity, identity.venueIdentity, "Toronto", identity.date]),
    encoded([identity.artistIdentity, identity.venueIdentity, "Toronto, Ontario, Canada", identity.date]),
    encoded([identity.artistIdentity, identity.venueIdentity, "", identity.date], true),
    `${canonicalKey}=`,
    encoded([" CANONICAL  BAND ", "Canonical Hall", "Toronto", identity.date]),
  ];
  for (const key of variants) {
    const path = concertPath(key);
    const route = seoHttpPlan(path);
    assert.equal(route.type, "redirect", path);
    assert.equal(route.status, 301, path);
    assert.equal(route.location, canonicalPath, path);
    const entity = resolveEntity(path);
    assert.equal(entity.showKey, canonicalKey);
    assert.equal(entity.archiveShowKey, canonicalKey);
    assert.equal(entity.path, canonicalPath);
    assert.equal(pageHeadFor(path).head, headTagsFor(canonicalPath));
    assert.equal(seoHttpPlan(route.location).document.canonicalUrl, `https://www.example.com${canonicalPath}`);
  }
});

test("canonical normalization never redirects malformed or unknown concerts into an existing show", () => {
  for (const key of [
    "show.not-a-json-key",
    encoded([identity.artistIdentity, identity.venueIdentity, "Toronto", "2026-02-30"]),
    encoded(["different artist", identity.venueIdentity, "Toronto", identity.date]),
    encoded([identity.artistIdentity, "different hall", "Toronto", identity.date]),
    encoded([identity.artistIdentity, identity.venueIdentity, "Toronto", "2026-08-21"]),
    encoded(["", identity.venueIdentity, "Toronto", identity.date]),
  ]) {
    const path = concertPath(key);
    const route = seoHttpPlan(path);
    assert.equal(route.type, "not-found", path);
    assert.equal(route.status, 404, path);
    assert.match(headTagsFor(path), /name="robots" content="noindex,follow"/);
    assert.doesNotMatch(headTagsFor(path), /rel="canonical"/);
  }
});

test("city directory case and trailing-slash variants consolidate without admitting unknown subpaths", () => {
  const canonical = seoHttpPlan("/cities");
  assert.equal(canonical.type, "document");
  assert.equal(canonical.status, 200);
  for (const path of ["/cities/", "/cities//", "/CITIES/", "/Cities"]) {
    const route = seoHttpPlan(path);
    assert.equal(route.type, "redirect", path);
    assert.equal(route.status, 301, path);
    assert.equal(route.location, "/cities", path);
    assert.equal(pageHeadFor(path).head, pageHeadFor("/cities").head);
  }
  for (const path of ["/cities/unknown", "/cities-extra/", "/cities/../unknown"]) {
    assert.equal(seoHttpPlan(path).status, 404, path);
  }
});

test("legacy archive keys cannot bypass conflicting-location or withdrawn-review publication guards", () => {
  const alias = concertPath(encoded([identity.artistIdentity, identity.venueIdentity, "Toronto", identity.date]));
  const addEvent = db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,updated_at,release_at,venue_city,venue_country_code)
    VALUES (?, 'Canonical Band', 'Canonical Hall', ?, ?, 'ticketmaster', ?, 0, ?, 'CA')`);
  try {
    addEvent.run("canonical-toronto", "Toronto, Canada", identity.date, Date.now(), "Toronto");
    addEvent.run("canonical-ottawa", "Ottawa, Canada", identity.date, Date.now(), "Ottawa");
    for (const path of [canonicalPath, alias]) {
      assert.equal(seoHttpPlan(path).status, 404, "ambiguous city evidence never points to an unavailable canonical");
      assert.doesNotMatch(headTagsFor(path), /rel="canonical"/);
    }
  } finally {
    db.prepare("DELETE FROM tour_dates WHERE id IN ('canonical-toronto','canonical-ottawa')").run();
  }
  assert.equal(seoHttpPlan(alias).location, canonicalPath);
  try {
    db.prepare("UPDATE posts SET removed=1 WHERE id='canonical-review'").run();
    assert.equal(seoHttpPlan(alias).status, 404);
    assert.equal(seoHttpPlan(canonicalPath).status, 404);
  } finally {
    db.prepare("UPDATE posts SET removed=0 WHERE id='canonical-review'").run();
  }
});
