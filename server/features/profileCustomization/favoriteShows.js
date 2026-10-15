// The member's pinned favorite shows, in their chosen order, as small cards
// for their profile. `ids` come from the validated profile projection. A pin
// whose review was removed, or turned into a plain post, simply drops out;
// nothing else about the post is exposed.
export function favoriteShowCards(database, { userId, ids, parseArray }) {
  if (!userId || !Array.isArray(ids) || !ids.length) return [];
  const rows = database.prepare(`SELECT id,artist,venue,city,date,end_date,show_format,overall,photos,experience_type,online_title FROM posts
    WHERE user_id=? AND removed=0 AND COALESCE(kind,'review')<>'status' AND id IN (${ids.map(() => "?").join(",")})`).all(userId, ...ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((row) => ({
    id: row.id,
    artist: row.artist || "",
    venue: row.venue || "",
    city: row.city || "",
    date: row.date || "",
    endDate: row.end_date || "",
    showFormat: row.show_format || "headline",
    overall: Number(row.overall) || 0,
    online: row.experience_type === "online",
    onlineTitle: row.online_title || "",
    photo: parseArray(row.photos).find((uri) => typeof uri === "string" && /^https:\/\//u.test(uri)) || null,
  }));
}
