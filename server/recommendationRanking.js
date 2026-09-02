export const RECOMMENDATION_ALGORITHM = "music-affinity-v2";
export const RECOMMENDATION_ALGORITHM_VERSION = 2;

export function recommendationKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function stableUnit(seed, id) {
  const text = `${seed}:${id}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function mediaCount(value) {
  if (Number.isFinite(value)) return Math.max(0, Math.min(8, Number(value)));
  if (Array.isArray(value)) return value.length;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function reasonFor(parts) {
  if (parts.affinity >= 8) return { code: "artist_affinity", label: "Matches artists you care about" };
  if (parts.following > 0) return { code: "followed_creator", label: "From someone you follow" };
  if (parts.genre > 0) return { code: "genre_affinity", label: "Matches your music taste" };
  if (parts.local > 0) return { code: "local", label: "From your music community" };
  if (parts.engagement >= 8) return { code: "global_momentum", label: "Fans are talking about this" };
  return { code: "fresh_global", label: "New from the Mshpit community" };
}

export function scoreRecommendation(candidate, signals = {}, { snapshotAt = Date.now(), seed = "guest" } = {}) {
  const createdAt = Number(candidate.createdAt) || 0;
  const ageHours = Math.max(0, snapshotAt - createdAt) / 3_600_000;
  const freshness = 40 * Math.pow(0.5, ageHours / 96);
  const likes = Math.max(0, Number(candidate.likes) || 0);
  const comments = Math.max(0, Number(candidate.comments) || 0);
  // Engagement finds a real conversation, but is capped below music and
  // relationship relevance so the feed does not turn into engagement bait.
  const engagement = Math.min(20, Math.log2(1 + likes) * 3 + Math.log2(1 + comments) * 4.5);
  const textLength = Math.max(0, Number(candidate.reviewLength) || String(candidate.review || "").length);
  const completeness = Math.min(7, mediaCount(candidate.mediaCount ?? candidate.photos) * 3.5)
    + (textLength >= 120 ? 4 : textLength >= 40 ? 2 : 0)
    + (candidate.kind === "review" ? 1 : 0);
  const exploration = stableUnit(seed, candidate.id) * 2;

  const artistKey = recommendationKey(candidate.artistKey || candidate.artist);
  const candidateGenre = recommendationKey(candidate.genre);
  const candidateCity = recommendationKey(candidate.city);
  const affinityPoints = Number(signals.artistWeights?.get?.(artistKey)) || 0;
  const affinity = Math.min(24, Math.max(0, affinityPoints) * 1.5);
  const following = signals.followedUserIds?.has?.(candidate.userId) ? 12 : 0;
  const genre = candidateGenre && signals.genres?.has?.(candidateGenre) ? 7 : 0;
  const local = candidateCity && candidateCity === signals.city ? 3 : 0;
  const positivePersonal = Math.min(36, affinity + following + genre + local);
  const selfPenalty = signals.viewerId && signals.viewerId === candidate.userId ? -18 : 0;

  // A recently seen card rotates down, never out. This penalty decays to
  // almost zero, allowing an old post to resurface when it is relevant again.
  const viewerSeenCount = Math.max(0, Number(candidate.viewerSeenCount) || 0);
  const viewerLastSeenAt = Math.max(0, Number(candidate.viewerLastSeenAt) || 0);
  const seenAgeHours = viewerLastSeenAt ? Math.max(0, snapshotAt - viewerLastSeenAt) / 3_600_000 : Infinity;
  const seenStrength = Math.min(34, 18 + Math.log2(1 + viewerSeenCount) * 6);
  const seenPenalty = viewerSeenCount ? -seenStrength * Math.pow(0.5, seenAgeHours / (14 * 24)) : 0;

  const parts = {
    freshness, engagement, completeness, exploration, affinity, following,
    genre, local, selfPenalty, seenPenalty, viewerSeenCount, viewerLastSeenAt,
  };
  const reason = reasonFor(parts);
  return {
    score: freshness + engagement + completeness + exploration + positivePersonal + selfPenalty + seenPenalty,
    globalScore: freshness + engagement + completeness + exploration,
    personalScore: positivePersonal + selfPenalty + seenPenalty,
    parts,
    reason,
  };
}

// Greedy diversity reranking keeps one prolific author or one concert from
// consuming the entire first screen. The underlying score stays inspectable;
// diversity is a presentation constraint applied after global+personal scoring.
export function rankRecommendations(candidates, signals = {}, options = {}) {
  const scored = (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    candidate,
    ...scoreRecommendation(candidate, signals, options),
  }));
  scored.sort((a, b) => b.score - a.score || String(a.candidate.id).localeCompare(String(b.candidate.id)));

  const remaining = [...scored];
  const ranked = [];
  while (remaining.length) {
    const recentAuthors = ranked.slice(-3).map((entry) => entry.candidate.userId);
    const recentArtists = ranked.slice(-4).map((entry) => recommendationKey(entry.candidate.artistKey || entry.candidate.artist)).filter(Boolean);
    let bestIndex = 0;
    let bestAdjusted = -Infinity;
    // The sorted top window contains every plausible next card; limiting the
    // diversity comparison makes reranking O(N*k), k=40, instead of O(N^2) for
    // the 600-candidate production bound.
    const windowSize = Math.min(40, remaining.length);
    const openingAuthorCounts = ranked.length < 20 ? new Map() : null;
    if (openingAuthorCounts) {
      for (const entry of ranked) {
        const id = entry.candidate.userId;
        openingAuthorCounts.set(id, (openingAuthorCounts.get(id) || 0) + 1);
      }
    }
    const openingAllows = (entry) => !openingAuthorCounts || (openingAuthorCounts.get(entry.candidate.userId) || 0) < 2;
    for (let index = 0; index < windowSize; index++) {
      const entry = remaining[index];
      if (!openingAllows(entry)) continue;
      const authorRepeats = recentAuthors.filter((id) => id === entry.candidate.userId).length;
      const artistKey = recommendationKey(entry.candidate.artistKey || entry.candidate.artist);
      const artistRepeats = artistKey ? recentArtists.filter((key) => key === artistKey).length : 0;
      const adjusted = entry.score - authorRepeats * 12 - artistRepeats * 9;
      if (adjusted > bestAdjusted || (adjusted === bestAdjusted && String(entry.candidate.id) < String(remaining[bestIndex].candidate.id))) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }
    if (bestAdjusted === -Infinity && openingAuthorCounts) {
      const eligibleIndex = remaining.findIndex(openingAllows);
      if (eligibleIndex >= 0) {
        bestIndex = eligibleIndex;
        bestAdjusted = remaining[eligibleIndex].score;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    ranked.push({ ...chosen, diversityAdjustedScore: bestAdjusted });
  }
  return ranked;
}
