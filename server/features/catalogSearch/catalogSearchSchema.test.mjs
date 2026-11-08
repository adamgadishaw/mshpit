import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerPitSqliteFunctions } from "../../sqliteFunctions.js";
import { CATALOG_SEARCH_COLUMNS, catalogSearchMatchExpression, catalogSearchSqliteText } from "./catalogSearchProjection.js";
import { ensureCatalogSearchSchema } from "./catalogSearchSchema.js";

test("search index backfills once, follows inserts/updates/deletes, and survives VACUUM with registered functions", () => {
  const db = registerPitSqliteFunctions(new DatabaseSync(":memory:"));
  try {
    db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE tour_dates(id TEXT PRIMARY KEY,${CATALOG_SEARCH_COLUMNS.map(name => name + " TEXT").join(",")})`);
    db.prepare("INSERT INTO tour_dates(id,artist,event_name,tour_name) VALUES(?,?,?,?)").run("old", "Beyoncé", "Moonlight Evening", "Moonlight Tour");
    let calls = 0;
    db.function("pit_catalog_search_text_v1", { deterministic: true, varargs: true }, (...values) => { calls++; return catalogSearchSqliteText(...values); });
    ensureCatalogSearchSchema(db);
    assert.equal(calls, 1);
    const find = query => db.prepare(`SELECT doc.event_id FROM catalog_event_search_fts_v1 fts
      JOIN catalog_event_search_docs_v1 doc ON doc.docid=fts.rowid WHERE catalog_event_search_fts_v1 MATCH ?`).all(catalogSearchMatchExpression(query)).map(row => row.event_id);
    assert.deepEqual(find("beyonce"), ["old"]); assert.deepEqual(find("moonlight"), ["old"]);
    const changes = db.prepare("SELECT total_changes() AS count").get().count;
    ensureCatalogSearchSchema(db);
    assert.equal(calls, 1, "Restart must not scan/recompute the catalogue");
    assert.equal(db.prepare("SELECT total_changes() AS count").get().count, changes);
    db.prepare("UPDATE tour_dates SET event_name='Starlight Evening',tour_name=NULL WHERE id='old'").run();
    assert.deepEqual(find("moonlight"), []); assert.deepEqual(find("starlight"), ["old"]);
    db.prepare("INSERT INTO tour_dates(id,artist) VALUES('new','New Performer')").run();
    assert.deepEqual(find("performer"), ["new"]);
    db.prepare("DELETE FROM tour_dates WHERE id='new'").run(); assert.deepEqual(find("performer"), []);
    const beforeReads = calls;
    find("beyonce"); find("starlight");
    assert.equal(calls, beforeReads, "Search must not recompute public projections per scanned row");
    db.exec("VACUUM");
    assert.deepEqual(find("starlight"), ["old"]);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("the versioned search schema can reopen on backup-style registered connections", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-search-index-reopen-"));
  const path = join(directory, "index.db");
  try {
    const writer = registerPitSqliteFunctions(new DatabaseSync(path));
    try {
      writer.exec(`CREATE TABLE tour_dates(id TEXT PRIMARY KEY,${CATALOG_SEARCH_COLUMNS.map(name => name + " TEXT").join(",")})`);
      ensureCatalogSearchSchema(writer);
      writer.prepare("INSERT INTO tour_dates(id,artist) VALUES('reopened','Beyoncé')").run();
    } finally { writer.close(); }
    const reader = registerPitSqliteFunctions(new DatabaseSync(path));
    try {
      ensureCatalogSearchSchema(reader);
      assert.equal(reader.prepare("SELECT COUNT(*) AS count FROM catalog_event_search_fts_v1 WHERE catalog_event_search_fts_v1 MATCH ?").get(catalogSearchMatchExpression("beyonce")).count, 1);
      reader.exec("VACUUM");
      reader.exec("INSERT INTO catalog_event_search_fts_v1(catalog_event_search_fts_v1,rank) VALUES('integrity-check',1)");
      assert.equal(reader.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    } finally { reader.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("oversized upgrade/rebuild fails before index writes and explicit preparation is idempotent", () => {
  const db = registerPitSqliteFunctions(new DatabaseSync(":memory:"));
  try {
    db.exec(`CREATE TABLE tour_dates(id TEXT PRIMARY KEY,${CATALOG_SEARCH_COLUMNS.map(name => name + " TEXT").join(",")})`);
    db.prepare("INSERT INTO tour_dates(id,artist) VALUES('one','First'),('two','Second')").run();
    assert.throws(() => ensureCatalogSearchSchema(db, { maxBuildRows: 1 }), error => error.code === "CATALOG_SEARCH_PREPARATION_REQUIRED" && error.rowCount === 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'catalog_event_search_%'").get().count, 0);
    ensureCatalogSearchSchema(db, { maxBuildRows: 2 });
    const changes = db.prepare("SELECT total_changes() AS count").get().count;
    ensureCatalogSearchSchema(db, { maxBuildRows: 1 }); // Already built: no scan/rebuild.
    assert.equal(db.prepare("SELECT total_changes() AS count").get().count, changes);
    db.exec("DROP TABLE catalog_event_search_fts_v1");
    assert.throws(() => ensureCatalogSearchSchema(db, { maxBuildRows: 1 }), error => error.code === "CATALOG_SEARCH_PREPARATION_REQUIRED");
    ensureCatalogSearchSchema(db, { maxBuildRows: 2 });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM catalog_event_search_fts_v1 WHERE catalog_event_search_fts_v1 MATCH ?").get(catalogSearchMatchExpression("second")).count, 1);
    db.exec("INSERT INTO catalog_event_search_fts_v1(catalog_event_search_fts_v1,rank) VALUES('integrity-check',1)");
  } finally { db.close(); }
});

test("an existing populated database has a consistent pre-upgrade snapshot and restorable indexed copy", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-search-upgrade-backup-"));
  const path = join(directory, "existing.db"), before = join(directory, "before.db"), after = join(directory, "after.db");
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  try {
    const writer = registerPitSqliteFunctions(new DatabaseSync(path));
    try {
      writer.exec(`PRAGMA journal_mode=WAL; CREATE TABLE tour_dates(id TEXT PRIMARY KEY,${CATALOG_SEARCH_COLUMNS.map(name => name + " TEXT").join(",")})`);
      writer.prepare("INSERT INTO tour_dates(id,artist,tour_name) VALUES('retained','Beyoncé','Moonlight Tour')").run();
      writer.exec(`VACUUM INTO ${literal(before)}`); // Same consistent-snapshot primitive used by the normal backup gate.
      writer.exec("BEGIN IMMEDIATE");
      try { ensureCatalogSearchSchema(writer); writer.exec("COMMIT"); } catch (error) { writer.exec("ROLLBACK"); throw error; }
      writer.exec(`VACUUM INTO ${literal(after)}`);
    } finally { writer.close(); }
    for (const [copy, indexed] of [[before, false], [after, true]]) {
      const restored = registerPitSqliteFunctions(new DatabaseSync(copy));
      try {
        assert.equal(restored.prepare("SELECT artist FROM tour_dates WHERE id='retained'").get().artist, "Beyoncé");
        assert.equal(!!restored.prepare("SELECT 1 FROM sqlite_master WHERE name='catalog_event_search_docs_v1'").get(), indexed);
        ensureCatalogSearchSchema(restored);
        assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM catalog_event_search_fts_v1 WHERE catalog_event_search_fts_v1 MATCH ?").get(catalogSearchMatchExpression("moonlight")).count, 1);
        assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      } finally { restored.close(); }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("SQLite capability failure is explicit and precedes persistent schema writes", () => {
  for (const capabilities of [{ version: "3.53.0", fts5: 0 }, { version: "3.33.0", fts5: 1 }]) {
    let writes = 0;
    const database = { prepare(sql) { return { get() { return sql.includes("sqlite_version") ? capabilities : null; } }; }, exec() { writes++; } };
    assert.throws(() => ensureCatalogSearchSchema(database), error => error.code === "CATALOG_SEARCH_SQLITE_UNSUPPORTED");
    assert.equal(writes, 0);
  }
});
