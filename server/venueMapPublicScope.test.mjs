import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleTourDateRowsFrom } from "./tourDateVisibilityQuery.js";
import { venueMapCatalogueResponsePayload } from "./venueMapCatalogueResponse.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-map-public-scope-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const at = Date.now(); let sequence = 0;
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

function member() {
  const id = `map_scope_${++sequence}`;
  q.insertUser.run(id, `${id}@example.com`, id, id, "fixture-hash", "fan", "Toronto", 43.65, -79.38, "AD", "#123456", at);
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(at, id);
  return q.userById.get(id);
}

test("shared map cache excludes authored rows before projection while ordinary viewer privacy still works", async () => {
  const owner = member(), viewer = member();
  routes["POST /api/artist-pages"]({ user: owner, ip: owner.id, body: { artistName: "Map privacy fixture artist" } });
  const date = new Date(at + 7 * 86400000).toISOString().slice(0, 10);
  const authored = routes["POST /api/tourdates"]({ user: q.userById.get(owner.id), ip: owner.id,
    body: { dates: [{ venue: "Authored privacy fixture room", place: "Toronto, Canada", date }] } }).tourDates[0];
  const providerId = "tm_map_scope_provider";
  db.prepare("INSERT INTO tour_dates(id,artist,venue,place,date,source,updated_at,owner_id,provider_event_id,venue_provider_id) VALUES(?,?,?,?,?,?,?,NULL,?,?)")
    .run(providerId, "Independent provider fixture", "Provider fixture room", "Toronto, Canada", date, "ticketmaster", at, "map_scope_provider", "ExactCaseProvider");
  assert.ok(visibleTourDateRowsFrom(db, null, { at }).some(row => row.id === authored.id));
  for (const actor of [null, viewer, { ...viewer, role: "admin" }]) {
    const shared = visibleTourDateRowsFrom(db, actor, { at, providerOnly: true });
    assert.equal(shared.some(row => row.id === authored.id), false);
    assert.equal(shared.some(row => row.id === providerId), true);
  }

  // Only toggle the route's exact runtime gate after importing the hermetic
  // application; no production bootstrap/server/background worker is started.
  const oldEnvironment = process.env.NODE_ENV, oldFlag = process.env.MSHPIT_WEB_MAPLIBRE_ENABLED;
  process.env.NODE_ENV = "production"; process.env.MSHPIT_WEB_MAPLIBRE_ENABLED = "1";
  try {
    const ctx = { user: viewer, query: { view: "venue-map", scope: "all-upcoming", limit: "500" } };
    const first = await routes["GET /api/tourdates"](ctx);
    const firstRows = JSON.parse(venueMapCatalogueResponsePayload(first).bytes).tourDates;
    assert.equal(firstRows.some(row => row.id === authored.id), false);
    assert.equal(firstRows.some(row => row.id === providerId), true);
    db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(owner.id, viewer.id, at);
    assert.equal(visibleTourDateRowsFrom(db, viewer, { at }).some(row => row.id === authored.id), false);
    db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
    const again = await routes["GET /api/tourdates"](ctx);
    assert.equal(again, first, "shared provider snapshot remains safe across member visibility changes");
  } finally {
    if (oldEnvironment == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnvironment;
    if (oldFlag == null) delete process.env.MSHPIT_WEB_MAPLIBRE_ENABLED; else process.env.MSHPIT_WEB_MAPLIBRE_ENABLED = oldFlag;
  }
});
