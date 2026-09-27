import assert from "node:assert/strict";
import test from "node:test";
import { rankRecommendations, scoreRecommendation } from "./recommendationRanking.js";

const NOW = Date.UTC(2026, 7, 13, 12);
const candidate = (id, overrides = {}) => ({
  id,
  userId: `u_${id}`,
  artist: `Artist ${id}`,
  city: "Toronto",
  genre: "Indie",
  createdAt: NOW - 3_600_000,
  likes: 0,
  comments: 0,
  photos: "[]",
  reviewLength: 20,
  kind: "review",
  ...overrides,
});

test("global quality leads cold start and ranking is deterministic", () => {
  const quiet = candidate("quiet");
  const global = candidate("global", { likes: 80, comments: 20, photos: '["https://example.test/a.jpg"]', reviewLength: 200 });
  const first = rankRecommendations([quiet, global], {}, { snapshotAt: NOW, seed: "guest" });
  const second = rankRecommendations([quiet, global], {}, { snapshotAt: NOW, seed: "guest" });
  assert.equal(first[0].candidate.id, "global");
  assert.deepEqual(first.map((entry) => entry.candidate.id), second.map((entry) => entry.candidate.id));
  assert.equal(first[0].reason.code, "global_momentum");
});

test("personal boosts are bounded and explainable", () => {
  const post = candidate("taste", { artist: "Favorite Act", genre: "Shoegaze", userId: "u_followed" });
  const signals = {
    viewerId: "u_viewer",
    artistWeights: new Map([["favorite act", 20]]),
    followedUserIds: new Set(["u_followed"]),
    genres: new Set(["shoegaze"]),
    city: "toronto",
  };
  const score = scoreRecommendation(post, signals, { snapshotAt: NOW, seed: "u_viewer" });
  assert.equal(score.personalScore, 36);
  assert.equal(score.reason.code, "artist_affinity");
});

test("seen rotation decays and never removes a candidate", () => {
  const base = candidate("seen", { viewerSeenCount: 3, viewerLastSeenAt: NOW });
  const recent = scoreRecommendation(base, {}, { snapshotAt: NOW, seed: "viewer" });
  const old = scoreRecommendation({
    ...base,
    viewerLastSeenAt: NOW - 120 * 24 * 60 * 60_000,
  }, {}, { snapshotAt: NOW, seed: "viewer" });
  assert.ok(recent.parts.seenPenalty < -20);
  assert.ok(Math.abs(old.parts.seenPenalty) < 0.1);
  assert.deepEqual(
    rankRecommendations([base], {}, { snapshotAt: NOW, seed: "viewer" }).map((entry) => entry.candidate.id),
    ["seen"],
  );
});

test("diversity prevents one author from filling the opening run", () => {
  const rows = [
    candidate("a1", { userId: "u_same", likes: 100 }),
    candidate("a2", { userId: "u_same", likes: 90 }),
    candidate("a3", { userId: "u_same", likes: 80 }),
    candidate("other", { userId: "u_other", likes: 15 }),
  ];
  const ranked = rankRecommendations(rows, {}, { snapshotAt: NOW, seed: "guest" });
  assert.ok(ranked.findIndex((entry) => entry.candidate.id === "other") < 3);
});

test("opening page enforces an author cap even beyond the rerank window", () => {
  const prolific = Array.from({ length: 59 }, (_, index) => candidate(`same_${index}`, {
    userId: "u_same",
    likes: 10_000 - index,
  }));
  const alternatives = Array.from({ length: 20 }, (_, index) => candidate(`other_${index}`, {
    userId: `u_other_${index}`,
    likes: 1,
  }));
  const firstPage = rankRecommendations([...prolific, ...alternatives], {}, { snapshotAt: NOW, seed: "guest" }).slice(0, 20);
  const sameCount = firstPage.filter((entry) => entry.candidate.userId === "u_same").length;
  assert.equal(sameCount, 2);
});

test("small feeds reserve discovery beyond followed creators without losing posts", () => {
  const following = Array.from({ length: 18 }, (_, i) => candidate(`followed_${i}`, { likes: 80, comments: 10 }));
  const strangers = [candidate("new_one"), candidate("new_two")];
  const signals = { viewerId: "viewer", followedUserIds: new Set(following.map(p => p.userId)) };
  const ranked = rankRecommendations([...following, ...strangers], signals, { snapshotAt: NOW, seed: "viewer" });
  for (let start = 0; start < 10; start += 5) assert.ok(ranked.slice(start, start + 5).some(p => !signals.followedUserIds.has(p.candidate.userId)));
  assert.equal(new Set(ranked.map(p => p.candidate.id)).size, 20);
  assert.deepEqual(ranked.map(p => p.candidate.id), rankRecommendations([...following,...strangers],signals,{snapshotAt:NOW,seed:"viewer"}).map(p=>p.candidate.id));
});

test("network repost relevance stays capped and explainable", () => {
  const score = scoreRecommendation(candidate("repost", { networkReposts: 10000 }), {}, { snapshotAt: NOW });
  assert.equal(score.parts.networkRepost, 9);
  assert.equal(score.reason.code, "network_repost");
});

test("discovery does not force stale seen or news cards above fresh followed posts", () => {
  const followed = Array.from({length: 5}, (_, i) => candidate(`friend_${i}`, {likes:80}));
  const stale = candidate("old", {createdAt:NOW-100*86400000,viewerSeenCount:1,viewerLastSeenAt:NOW});
  const signals = {viewerId:"viewer",followedUserIds:new Set(followed.map(p=>p.userId))};
  assert.ok(rankRecommendations([...followed,stale],signals,{snapshotAt:NOW}).slice(0,5).every(p=>p.candidate.id!=="old"));
});
