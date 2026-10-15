// Which photo a news story's share card uses. By default the first artist in
// the story with a usable photo (their own profile photo, then a licensed
// catalog photo). The news team can pick a different artist from the story,
// or no photo at all, when the default is wrong for the story.

export function ensureNewsCardPhotoSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS news_card_photos (
    post_id TEXT PRIMARY KEY,
    choice TEXT NOT NULL CHECK (choice IN ('artist','none')),
    artist_key TEXT,
    chosen_by TEXT,
    chosen_at INTEGER NOT NULL
  );`);
}

export function readNewsCardPhotoChoice(database, postId) {
  const row = typeof postId === "string" && postId.startsWith("news_")
    ? database.prepare("SELECT choice, artist_key FROM news_card_photos WHERE post_id=?").get(postId) : null;
  return row ? { choice: row.choice, artistKey: row.artist_key || null } : { choice: "auto", artistKey: null };
}

// "auto" clears the pick; "artist" needs one of the story's own artists.
export function setNewsCardPhotoChoice(database, { postId, choice, artistKey = null, story, actorId = null, at = Date.now() }) {
  if (!story || story.postId !== postId) return { error: "NOT_FOUND" };
  if (choice === "auto") {
    database.prepare("DELETE FROM news_card_photos WHERE post_id=?").run(postId);
    return { choice: "auto", artistKey: null };
  }
  if (choice === "none") {
    database.prepare(`INSERT INTO news_card_photos (post_id,choice,artist_key,chosen_by,chosen_at) VALUES (?,?,NULL,?,?)
      ON CONFLICT(post_id) DO UPDATE SET choice=excluded.choice, artist_key=NULL, chosen_by=excluded.chosen_by, chosen_at=excluded.chosen_at`)
      .run(postId, "none", actorId, at);
    return { choice: "none", artistKey: null };
  }
  if (choice !== "artist" || !(story.artists || []).some((artist) => artist?.key === artistKey)) return { error: "VALIDATION_FAILED" };
  database.prepare(`INSERT INTO news_card_photos (post_id,choice,artist_key,chosen_by,chosen_at) VALUES (?,?,?,?,?)
    ON CONFLICT(post_id) DO UPDATE SET choice=excluded.choice, artist_key=excluded.artist_key, chosen_by=excluded.chosen_by, chosen_at=excluded.chosen_at`)
    .run(postId, "artist", artistKey, actorId, at);
  return { choice: "artist", artistKey };
}
