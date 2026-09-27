export const emptyNewsState = (scope, status = "idle") => ({ scope, stories: [], nextCursor: null, status });
export const newsPrivacyScope = ({ session, blockedIds = [], removedIds = [], mutedIds = [], followedArtists = [] }) => JSON.stringify([
  session?.id || null, [...blockedIds].sort(), [...removedIds].sort(), [...(session?.favoriteArtists || [])].sort(), [...mutedIds].sort(), [...followedArtists].sort(),
]);
export const newsStateForScope = (state, scope, enabled = true) => enabled && state.scope === scope ? state : emptyNewsState(scope, enabled ? "loading" : "idle");
export const isNewsPost = (post) => !!post?.news || String(post?.id || "").startsWith("news_");
export const newsFeedSurfaceVisible = ({ tab, hasOverlay, landing, obscured, pendingNavigation, web, pathname }) => tab === "feed"
  && !hasOverlay && !landing && !obscured && !pendingNavigation && (!web || pathname === "/feed");
const artistName = (value) => { const raw = String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim(); return raw.replace(/[^\p{L}\p{N}]+/gu, " ").trim() || raw; };
export function newsAwareFeed(rows, { filter, accountId, introduction = null, followedArtists = [] } = {}) {
  const seen = new Set();
  const follows = new Set(followedArtists.map(artistName).filter(Boolean));
  const allowed = (post) => post?.id && (!isNewsPost(post) || (filter === "everyone" && !!accountId
    && post.news?.artists?.some((artist) => follows.has(artistName(artist.name)))));
  const candidates = filter === "everyone" && accountId && introduction ? [introduction, ...rows] : rows;
  return candidates.filter((post) => {
    if (!allowed(post) || seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
}
