#!/usr/bin/env node
// Add production-shaped recommendation rows to an isolated benchmark database.
// The script refuses the real server data directory and owns only `bench_*`
// records, making the capacity report repeatable without touching real content.

import { resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};
const databasePath = valueFor("database");
const requested = Number(valueFor("posts") || 600);
const postCount = Math.max(200, Math.min(1200, Math.floor(requested) || 600));
if (!databasePath) {
  console.error("Pass --database <isolated .tmp capacity database>.");
  process.exit(2);
}

const resolved = resolve(databasePath);
const normalized = resolved.toLowerCase();
if (!normalized.includes(`${sep}.tmp${sep}capacity-`) || !normalized.endsWith(`${sep}pit.db`)) {
  console.error("Refusing to seed outside a .tmp/capacity-*/pit.db fixture.");
  process.exit(2);
}

const database = new DatabaseSync(resolved);
database.exec("PRAGMA foreign_keys=ON; PRAGMA wal_checkpoint(TRUNCATE);");
const users = database.prepare("SELECT id FROM users ORDER BY id").all().map((row) => row.id);
const artists = database.prepare("SELECT norm,name FROM artists WHERE length(name)>0 ORDER BY rank_score DESC,name LIMIT 80").all();
if (users.length < 2 || artists.length < 10) {
  database.close();
  console.error("The fixture needs at least two users and ten artists.");
  process.exit(2);
}

const insertPost = database.prepare(`INSERT INTO posts(
  id,user_id,artist,venue,city,date,overall,band,room,review,photos,
  photos_public,setlist,removed,created_at,updated_at,dims,tags,kind,
  artist_key,venue_key
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertLike = database.prepare("INSERT OR IGNORE INTO likes(post_id,user_id) VALUES(?,?)");
const insertComment = database.prepare("INSERT INTO comments(id,post_id,user_id,text,removed,created_at) VALUES(?,?,?,?,0,?)");

database.exec("BEGIN IMMEDIATE");
try {
  database.exec(`
    DELETE FROM comments WHERE id LIKE 'bench_c_%';
    DELETE FROM likes WHERE post_id LIKE 'bench_p_%';
    DELETE FROM posts WHERE id LIKE 'bench_p_%';
  `);
  const at = Date.now();
  for (let index = 0; index < postCount; index++) {
    const id = `bench_p_${String(index).padStart(4, "0")}`;
    const artist = artists[index % artists.length];
    const author = users[index % users.length];
    const createdAt = at - index * 30 * 60 * 1000;
    const photos = index % 3 === 0 ? JSON.stringify([`https://media.example.test/${id}.jpg`]) : "[]";
    insertPost.run(
      id, author, artist.name, `Benchmark Hall ${index % 24}`, "Toronto", "2026-08-13",
      3.5 + (index % 4) * 0.5, 4, 4,
      "A production-shaped synthetic concert review used only for local capacity measurement. ".repeat(3),
      photos, 1, "[]", 0, createdAt, createdAt, "{}", "[]",
      index % 7 === 0 ? "status" : "review", artist.norm, `benchmark-hall-${index % 24}`,
    );
    for (let offset = 1; offset <= Math.min(8, index % 9); offset++) {
      insertLike.run(id, users[(index + offset) % users.length]);
    }
    for (let offset = 0; offset < index % 4; offset++) {
      insertComment.run(`bench_c_${index}_${offset}`, id, users[(index + offset + 2) % users.length], "Synthetic benchmark comment", createdAt + offset);
    }
  }
  database.exec("COMMIT; PRAGMA wal_checkpoint(TRUNCATE);");
} catch (error) {
  try { database.exec("ROLLBACK"); } catch {}
  database.close();
  throw error;
}

const totals = database.prepare(`SELECT
  (SELECT COUNT(*) FROM posts WHERE id LIKE 'bench_p_%') posts,
  (SELECT COUNT(*) FROM likes WHERE post_id LIKE 'bench_p_%') likes,
  (SELECT COUNT(*) FROM comments WHERE id LIKE 'bench_c_%') comments
`).get();
database.close();
console.log(JSON.stringify({ database: resolved, ...totals }));
