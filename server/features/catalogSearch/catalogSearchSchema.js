import { CATALOG_SEARCH_COLUMNS } from "./catalogSearchProjection.js";

// Versioned derived index only. Authoritative publication/lifecycle/block rules
// stay in the joined read query. No provider lookup or per-search rebuild.
export const CATALOG_SEARCH_BOOTSTRAP_MAX_ROWS = 50_000;
export function ensureCatalogSearchSchema(database, { maxBuildRows = CATALOG_SEARCH_BOOTSTRAP_MAX_ROWS } = {}) {
  if (!Number.isSafeInteger(maxBuildRows) || maxBuildRows < 1) throw new TypeError("A finite search-index build budget is required");
  const documentsExisted = !!database.prepare("SELECT 1 FROM sqlite_master WHERE name='catalog_event_search_docs_v1'").get();
  const indexExisted = !!database.prepare("SELECT 1 FROM sqlite_master WHERE name='catalog_event_search_fts_v1'").get();
  const capabilities = database.prepare("SELECT sqlite_version() AS version,sqlite_compileoption_used('ENABLE_FTS5') AS fts5").get();
  const [major, minor] = capabilities.version.split(".").map(Number);
  if (!capabilities.fts5 || major < 3 || (major === 3 && minor < 34)) {
    throw Object.assign(new Error("Catalog search requires SQLite FTS5 with trigram support (SQLite 3.34 or later)"), { code: "CATALOG_SEARCH_SQLITE_UNSUPPORTED" });
  }

  if (!documentsExisted || !indexExisted) {
    const table = documentsExisted ? "catalog_event_search_docs_v1" : "tour_dates";
    const { count } = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    if (count > maxBuildRows) {
      throw Object.assign(new Error("Catalog search index exceeds the startup build budget; prepare a backed-up offline copy before rollout"), {
        code: "CATALOG_SEARCH_PREPARATION_REQUIRED", rowCount: count, limit: maxBuildRows,
      });
    }
  }
  const projection = alias => `pit_catalog_search_text_v1(${CATALOG_SEARCH_COLUMNS.map(name => `${alias}.${name}`).join(",")})`;
  const upsert = `INSERT INTO catalog_event_search_docs_v1(event_id,search_text)
    VALUES(NEW.id,${projection("NEW")}) ON CONFLICT(event_id) DO UPDATE SET search_text=excluded.search_text
    WHERE catalog_event_search_docs_v1.search_text IS NOT excluded.search_text;`;
  database.exec(`
    CREATE TABLE IF NOT EXISTS catalog_event_search_docs_v1 (
      docid INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE REFERENCES tour_dates(id) ON DELETE CASCADE ON UPDATE CASCADE,
      search_text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS catalog_event_search_fts_v1 USING fts5(
      search_text, content='catalog_event_search_docs_v1', content_rowid='docid', tokenize='trigram'
    );
    CREATE TRIGGER IF NOT EXISTS catalog_search_doc_insert_v1 AFTER INSERT ON catalog_event_search_docs_v1 BEGIN
      INSERT INTO catalog_event_search_fts_v1(rowid,search_text) VALUES(NEW.docid,NEW.search_text);
    END;
    CREATE TRIGGER IF NOT EXISTS catalog_search_doc_delete_v1 AFTER DELETE ON catalog_event_search_docs_v1 BEGIN
      INSERT INTO catalog_event_search_fts_v1(catalog_event_search_fts_v1,rowid,search_text) VALUES('delete',OLD.docid,OLD.search_text);
    END;
    CREATE TRIGGER IF NOT EXISTS catalog_search_doc_update_v1 AFTER UPDATE OF search_text ON catalog_event_search_docs_v1 BEGIN
      INSERT INTO catalog_event_search_fts_v1(catalog_event_search_fts_v1,rowid,search_text) VALUES('delete',OLD.docid,OLD.search_text);
      INSERT INTO catalog_event_search_fts_v1(rowid,search_text) VALUES(NEW.docid,NEW.search_text);
    END;
    CREATE TRIGGER IF NOT EXISTS catalog_search_source_insert_v1 AFTER INSERT ON tour_dates BEGIN ${upsert} END;
    CREATE TRIGGER IF NOT EXISTS catalog_search_source_update_v1 AFTER UPDATE OF id,${CATALOG_SEARCH_COLUMNS.join(",")} ON tour_dates BEGIN
      DELETE FROM catalog_event_search_docs_v1 WHERE event_id=OLD.id AND OLD.id IS NOT NEW.id;
      ${upsert}
    END;
    CREATE TRIGGER IF NOT EXISTS catalog_search_source_delete_v1 AFTER DELETE ON tour_dates BEGIN
      DELETE FROM catalog_event_search_docs_v1 WHERE event_id=OLD.id;
    END;
  `);
  if (!documentsExisted) {
    database.exec(`INSERT INTO catalog_event_search_docs_v1(event_id,search_text) SELECT td.id,${projection("td")} FROM tour_dates td`);
  } else if (!indexExisted) {
    database.exec("INSERT INTO catalog_event_search_fts_v1(catalog_event_search_fts_v1) VALUES('rebuild')");
  }
}
