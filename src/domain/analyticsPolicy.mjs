// One privacy boundary shared by the Expo client and the API. Product analytics
// intentionally records categorical behavior and internal content identifiers,
// never reviews, searches, messages, media URLs, artist/title names, or other
// user-authored strings. The server remains authoritative; client sanitizing is
// defense in depth and also keeps forbidden data out of the durable retry queue.

const IDENTIFIER = /^(?:p|evt|post|cursor|log)_[A-Za-z0-9][A-Za-z0-9_-]{1,74}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

const enums = (...values) => ({ type: "enum", values: new Set(values) });
const id = { type: "id" };
const version = { type: "version" };
const bool = { type: "boolean" };
const integer = (min, max) => ({ type: "integer", min, max });

export const ANALYTICS_BATCH_LIMIT = 40;
export const ANALYTICS_QUEUE_LIMIT = 200;

export const ANALYTICS_EVENT_SPECS = Object.freeze({
  app_open: {
    platform: enums("web", "ios", "android", "unknown"),
    entry: enums("launch", "resume", "login"),
  },
  screen_view: {
    screen: enums("landing", "tab_feed", "tab_search", "tab_discover", "tab_you", "media_viewer", "playlist_picker", "follow_list", "auth", "pick_artists", "post_edit", "post_create", "report", "profile_edit", "venue_review", "message_thread", "inbox", "activity", "calendar", "clips", "profile", "fan_club", "artist_edit", "artist", "venue", "nearby", "venues", "fan_clubs", "settings", "account_delete", "diagnostics", "privacy", "terms", "lounge", "show", "post", "badges", "top_rated", "admin", "tour_dates", "request_artist", "menu"),
    referrer: enums("landing", "tab_feed", "tab_search", "tab_discover", "tab_you", "media_viewer", "playlist_picker", "follow_list", "auth", "pick_artists", "post_edit", "post_create", "report", "profile_edit", "venue_review", "message_thread", "inbox", "activity", "calendar", "clips", "profile", "fan_club", "artist_edit", "artist", "venue", "nearby", "venues", "fan_clubs", "settings", "account_delete", "diagnostics", "privacy", "terms", "lounge", "show", "post", "badges", "top_rated", "admin", "tour_dates", "request_artist", "menu"),
  },
  feed_request: {
    surface: enums("everyone", "following", "local", "clips"),
    algorithm: enums("global-personal-v1", "chronological-v1"),
    page: integer(1, 100),
    fallback: bool,
  },
  feed_impression: {
    postId: id,
    position: integer(0, 500),
    surface: enums("everyone", "following", "local", "clips"),
    algorithm: enums("global-personal-v1", "chronological-v1"),
    algorithmVersion: integer(1, 100),
    reasonCode: enums("followed_creator", "artist_affinity", "genre_affinity", "local", "global_momentum", "fresh_global"),
  },
  content_open: {
    postId: id,
    position: integer(0, 500),
    surface: enums("everyone", "following", "local", "clips", "profile", "search", "discover", "direct"),
  },
  content_dwell: {
    postId: id,
    durationBucket: enums("under_3s", "3_to_10s", "10_to_30s", "30_to_90s", "over_90s"),
    surface: enums("everyone", "following", "local", "clips", "profile", "search", "discover", "direct"),
  },
  video_start: { postId: id, surface: enums("everyone", "following", "local", "clips", "media_viewer", "post_detail"), muted: bool },
  video_progress: { postId: id, surface: enums("everyone", "following", "local", "clips", "media_viewer", "post_detail"), milestone: enums("25", "50", "75", "100") },
  recommendation_feedback: {
    postId: id,
    action: enums("not_interested", "hide", "follow", "open", "share"),
    surface: enums("everyone", "following", "local", "clips", "post_detail"),
  },
  interaction: {
    postId: id,
    action: enums("like", "unlike", "comment", "share", "save", "report"),
    surface: enums("feed", "afterparty", "media_viewer", "post_detail", "clips"),
  },
  search: {
    kind: enums("all", "artists", "venues", "people", "events", "songs"),
    resultBucket: enums("zero", "one_to_five", "six_to_twenty", "over_twenty"),
  },
  performance: {
    metric: enums("feed_load", "feed_next_page", "screen_ready", "video_first_frame", "post_publish"),
    durationBucket: enums("under_250ms", "250_to_750ms", "750ms_to_2s", "2_to_5s", "over_5s"),
    surface: enums("everyone", "following", "local", "clips", "post_create", "screen"),
    outcome: enums("ok", "error", "cancelled"),
  },
  product_error: { code: enums("video_load_failed", "feed_load_failed", "post_publish_failed", "media_upload_failed"), surface: enums("media_viewer", "clips", "feed", "post_create", "screen"), retryable: bool },
  notification_open: { type: enums("follow", "like", "comment", "mention", "message", "system") },

  // Compatibility event names used by existing app actions. Their former
  // artist, venue, title, city, target, and search-text properties are omitted.
  view_show: { postId: id },
  view_artist: {},
  view_venue: {},
  play: { source: enums("player", "catalog", "provider", "deezer", "youtube", "spotify", "playlist", "profile", "discover") },
  login: { method: enums("password", "session", "unknown") },
  signup: { method: enums("password", "unknown") },
  post: { kind: enums("status", "review"), mediaCount: integer(0, 8) },
  follow: {},
  block: {},
  like: { postId: id },
  delete_post: { postId: id },
  join_fanclub: {},
});

const ANALYTICS_REQUIRED_PROPS = Object.freeze({
  app_open: ["platform", "entry"],
  screen_view: ["screen"],
  feed_request: ["surface", "algorithm", "page", "fallback"],
  feed_impression: ["postId", "position", "surface", "algorithm"],
  content_open: ["postId", "surface"],
  content_dwell: ["postId", "durationBucket", "surface"],
  video_start: ["postId", "surface", "muted"],
  video_progress: ["postId", "surface", "milestone"],
  recommendation_feedback: ["postId", "action", "surface"],
  interaction: ["postId", "action", "surface"],
  search: ["kind", "resultBucket"],
  performance: ["metric", "durationBucket", "surface", "outcome"],
  product_error: ["code", "surface", "retryable"],
  notification_open: ["type"],
  view_show: ["postId"],
  post: ["kind", "mediaCount"],
  like: ["postId"],
  delete_post: ["postId"],
});

function cleanProperty(rule, value) {
  if (value == null) return undefined;
  if (rule.type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (rule.type === "integer") {
    return Number.isSafeInteger(value) && value >= rule.min && value <= rule.max ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  if (rule.type === "enum") return rule.values.has(value) ? value : undefined;
  if (rule.type === "id") return IDENTIFIER.test(value) ? value : undefined;
  if (rule.type === "version") return VERSION.test(value) ? value : undefined;
  return undefined;
}

export function sanitizeAnalyticsEvent(value, { requireId = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = typeof value.name === "string" ? value.name : "";
  const spec = ANALYTICS_EVENT_SPECS[name];
  if (!spec) return null;
  const eventId = typeof value.id === "string" && IDENTIFIER.test(value.id) ? value.id : null;
  if (requireId && !eventId) return null;
  const source = value.props && typeof value.props === "object" && !Array.isArray(value.props) ? value.props : {};
  const props = {};
  for (const [key, rule] of Object.entries(spec)) {
    const cleaned = cleanProperty(rule, source[key]);
    if (cleaned !== undefined) props[key] = cleaned;
  }
  if ((ANALYTICS_REQUIRED_PROPS[name] || []).some((key) => props[key] === undefined)) return null;
  return { ...(eventId ? { id: eventId } : {}), name, props };
}

export function analyticsDwellBucket(milliseconds) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  if (ms < 3000) return "under_3s";
  if (ms < 10_000) return "3_to_10s";
  if (ms < 30_000) return "10_to_30s";
  if (ms < 90_000) return "30_to_90s";
  return "over_90s";
}

export function analyticsDurationBucket(milliseconds) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  if (ms < 250) return "under_250ms";
  if (ms < 750) return "250_to_750ms";
  if (ms < 2000) return "750ms_to_2s";
  if (ms < 5000) return "2_to_5s";
  return "over_5s";
}
