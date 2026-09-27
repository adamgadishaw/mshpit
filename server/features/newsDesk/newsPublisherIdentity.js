import { accountIsPublic } from "../../accountVisibility.js";

export const NEWS_PUBLISHER_IDENTITY_KEY = "news-desk:publisher-identity:v1";
const validId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
const reasons = Object.freeze({
  publisher_not_configured: "No trusted news publisher is bound. Set NEWS_DESK_ACCOUNT_ID to the reviewed account ID.",
  publisher_history_ambiguous: "Historical news has multiple authors. Review the publisher identity before resuming.",
  publisher_config_mismatch: "Publisher configuration conflicts with the durable identity. Review the binding; it will not switch automatically.",
  publisher_binding_invalid: "The durable publisher binding is invalid. Review it before resuming.",
  publisher_account_unavailable: "The bound publisher is missing, banned, dormant, or suspended. Review that account before resuming.",
});
const stopped = reason => ({ ok: false, reason, message: reasons[reason] });

// app_meta and environment configuration are server-owned authority. Handles
// are not: users can rename or reclaim them. Bootstrap only from explicit
// configuration or one historical server-created news author, never @news_mod.
// A savepoint also works inside the final publication write transaction.
export function resolveNewsPublisher(database, { env = process.env, at = Date.now() } = {}) {
  const configured = typeof env.NEWS_DESK_ACCOUNT_ID === "string" ? env.NEWS_DESK_ACCOUNT_ID.trim() : "";
  if (env.NEWS_DESK_ACCOUNT_ID && !validId(configured)) return stopped("publisher_config_mismatch");
  database.exec("SAVEPOINT news_publisher_identity");
  try {
    const saved = database.prepare("SELECT value FROM app_meta WHERE key=?").get(NEWS_PUBLISHER_IDENTITY_KEY);
    let binding = null;
    if (saved) {
      try { binding = JSON.parse(saved.value); } catch { /* Invalid evidence fails closed below. */ }
      if (binding?.version !== 1 || !validId(binding?.userId)
        || !Number.isSafeInteger(binding?.boundAt) || binding.boundAt < 1
        || !["history", "configuration"].includes(binding?.source)) {
        database.exec("RELEASE news_publisher_identity");
        return stopped("publisher_binding_invalid");
      }
      if (configured && configured !== binding.userId) {
        database.exec("RELEASE news_publisher_identity");
        return stopped("publisher_config_mismatch");
      }
    } else {
      // Include withdrawn/removed stories: withdrawal never transfers identity.
      const authors = database.prepare(`SELECT DISTINCT p.user_id AS id FROM news_stories s
        JOIN posts p ON p.id=s.post_id WHERE s.post_id IS NOT NULL LIMIT 2`).all();
      if (authors.length > 1) {
        database.exec("RELEASE news_publisher_identity");
        return stopped("publisher_history_ambiguous");
      }
      if (authors.length && (!validId(authors[0].id) || (configured && configured !== authors[0].id))) {
        database.exec("RELEASE news_publisher_identity");
        return stopped("publisher_config_mismatch");
      }
      const userId = authors[0]?.id || configured;
      if (!userId) {
        database.exec("RELEASE news_publisher_identity");
        return stopped("publisher_not_configured");
      }
      if (!Number.isSafeInteger(at) || at < 1) throw new TypeError("A valid publisher binding timestamp is required.");
      binding = { version: 1, userId, boundAt: at, source: authors.length ? "history" : "configuration" };
      database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?)")
        .run(NEWS_PUBLISHER_IDENTITY_KEY, JSON.stringify(binding));
    }
    const account = database.prepare("SELECT id,is_banned,dormant_at,suspended_until FROM users WHERE id=?").get(binding.userId);
    database.exec("RELEASE news_publisher_identity");
    return accountIsPublic(account, at) ? { ok: true, accountId: account.id } : stopped("publisher_account_unavailable");
  } catch (error) {
    database.exec("ROLLBACK TO news_publisher_identity; RELEASE news_publisher_identity");
    throw error;
  }
}
