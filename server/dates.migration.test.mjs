// The ISO date migration rewrites primary-key material (`going.concert_key`)
// and opaque client-built ids (`lounge_messages.lounge_id`), so it gets a test
// that runs it against a database seeded with the exact shapes found in the
// real one: ISO, the DatePicker's display form, and the mangled row that forked
// The Fillmore into two performances.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const MANGLED = "2026 � 06 � 21";
const DISPLAY = "2026 · 06 · 21";

// Bring a database to its pre-migration state, then boot db.js over it again so
// the migration runs exactly as it will in production. The first import builds
// the schema; the marker is then cleared and legacy rows seeded underneath it,
// so the second import has real work to do. Importing under a fresh query
// string is what gets a second module instance out of the ESM cache.
async function migrated(seed) {
  const dataDir = mkdtempSync(join(tmpdir(), "pit-dates-"));
  process.env.PIT_DATA_DIR = dataDir;

  const first = await import(`./db.js?schema=${encodeURIComponent(dataDir)}`);
  first.db.prepare("DELETE FROM app_meta WHERE key='dates:canonical-iso:v1'").run();
  seed(first.db);
  first.db.close();

  const second = await import(`./db.js?migrate=${encodeURIComponent(dataDir)}`);
  return second.db;
}

test("the migration canonicalizes dates and merges the performances they forked", async () => {
  const db = await migrated((seed) => {
    seed.prepare("INSERT INTO users (id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)")
      .run("u_fan", "fan@example.com", "Fan", "fan", "x", 1);

    // The same night, written three ways.
    for (const [id, date] of [["p_iso", "2026-06-21"], ["p_display", DISPLAY], ["p_mangled", MANGLED]]) {
      seed.prepare("INSERT INTO posts (id,user_id,artist,venue,date,overall,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, "u_fan", "Turnstile", "The Fillmore", date, 4.5, 100);
    }
    seed.prepare("INSERT INTO posts (id,user_id,artist,venue,date,overall,created_at) VALUES (?,?,?,?,?,?,?)")
      .run("p_unparseable", "u_fan", "Turnstile", "The Fillmore", "sometime last summer", 4, 100);

    // One fan marked as going to two spellings of one night: the migration has
    // to merge them without violating PRIMARY KEY (user_id, concert_key).
    for (const date of [DISPLAY, MANGLED]) {
      seed.prepare("INSERT INTO going (user_id,concert_key,artist,venue,city,date) VALUES (?,?,?,?,?,?)")
        .run("u_fan", `turnstile|the fillmore|${date}`, "Turnstile", "The Fillmore", "SF", date);
    }

    for (const [id, date] of [["lm_a", DISPLAY], ["lm_b", MANGLED]]) {
      seed.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
        .run(id, `turnstile|the fillmore|${date}`, "u_fan", "see you there", 1);
    }
  });

  const dates = db.prepare("SELECT id,date FROM posts ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(dates, [
    { id: "p_display", date: "2026-06-21" },
    { id: "p_iso", date: "2026-06-21" },
    { id: "p_mangled", date: "2026-06-21" },
    // Too broken to parse: kept verbatim rather than destroying the only record
    // of when the night happened.
    { id: "p_unparseable", date: "sometime last summer" },
  ]);

  // Two attendance rows for one night collapse into the single row intended.
  const going = db.prepare("SELECT concert_key,date FROM going").all().map((r) => ({ ...r }));
  assert.deepEqual(going, [{ concert_key: "turnstile|the fillmore|2026-06-21", date: "2026-06-21" }]);

  // Both lounges become one room, because they were always the same night.
  const lounges = db.prepare("SELECT DISTINCT lounge_id FROM lounge_messages").all().map((r) => ({ ...r }));
  assert.deepEqual(lounges, [{ lounge_id: "turnstile|the fillmore|2026-06-21" }]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lounge_messages").get().n, 2, "no message may be lost in the merge");

  db.close();
});

test("the migration is idempotent and marks itself done", async () => {
  const db = await migrated((seed) => {
    seed.prepare("INSERT INTO users (id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)")
      .run("u_two", "two@example.com", "Two", "two", "x", 1);
    seed.prepare("INSERT INTO posts (id,user_id,artist,venue,date,overall,created_at) VALUES (?,?,?,?,?,?,?)")
      .run("p_one", "u_two", "Band", "Room", DISPLAY, 4, 100);
  });

  assert.equal(db.prepare("SELECT date FROM posts WHERE id='p_one'").get().date, "2026-06-21");
  assert.ok(db.prepare("SELECT 1 FROM app_meta WHERE key='dates:canonical-iso:v1'").get(), "marker records the run");
  db.close();
});
