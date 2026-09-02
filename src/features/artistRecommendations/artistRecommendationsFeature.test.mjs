import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beginLoadState, createLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import {
  artistRecommendationRequest,
  artistRecommendationsFromResponse,
} from "./artistRecommendationRequest.mjs";
import {
  artistRecommendationScope,
  EMPTY_ARTIST_RECOMMENDATIONS,
  projectArtistRecommendationResource,
} from "./artistRecommendationState.mjs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("artist recommendation requests are account bound and capped", () => {
  assert.deepEqual(artistRecommendationRequest({ accountId: "member-1", limit: 99 }), {
    path: "/api/me/artist-recommendations?limit=8",
    expectedAccountId: "member-1",
  });
  assert.throws(() => artistRecommendationRequest({}), /require an account/);
});

test("artist recommendation responses retain explainability while rejecting unsafe media and malformed cards", () => {
  const value = artistRecommendationsFromResponse({
    personalized: true,
    signalCount: 3,
    recommendations: [
      {
        artist: { key: "candidate", name: "Candidate", publicSlug: "candidate", photo: "https://images.example/a.jpg", genre: "Indie" },
        reason: { code: "rated", label: "Because you rated Anchor 5.0★", anchorArtist: "Anchor", genre: "Indie" },
        liveRating: 4.6,
        reviewCount: 12,
        nextDate: { id: "date-1", date: "2030-04-20", venue: "History", city: "Toronto" },
        socialProof: {
          count: 1,
          friendCount: 1,
          label: "1 friend has seen Candidate",
          basis: "Public in-person reviews from people you follow",
          people: [{ id: "friend", name: "Friend", avatarUri: "http://unsafe.example/avatar.jpg" }],
        },
      },
      { artist: { key: "missing-name" }, reason: {} },
    ],
  });
  assert.equal(value.recommendations.length, 1);
  assert.equal(value.recommendations[0].reason.anchorArtist, "Anchor");
  assert.equal(value.recommendations[0].nextDate.date, "2030-04-20");
  assert.equal(value.recommendations[0].socialProof.people[0].avatarUri, null);
  assert.equal(value.recommendations[0].liveRating, 4.6);
});

test("artist recommendation resources project empty synchronously across account changes", () => {
  const accountA = artistRecommendationScope("a", 1);
  const ready = resolveLoadState({
    scope: accountA,
    data: { ...EMPTY_ARTIST_RECOMMENDATIONS, personalized: true, recommendations: [{ artist: { key: "one" } }] },
    updatedAt: 10,
  });
  assert.equal(projectArtistRecommendationResource(ready, "a", 1).data.recommendations.length, 1);
  assert.equal(projectArtistRecommendationResource(ready, "a", 2).status, "loading", "a profile taste edit closes stale recommendations before its reload effect");
  const projected = projectArtistRecommendationResource(ready, "b", 1);
  assert.equal(projected.status, "loading");
  assert.deepEqual(projected.data, EMPTY_ARTIST_RECOMMENDATIONS);
  const refreshing = beginLoadState(createLoadState({ scope: accountA, data: EMPTY_ARTIST_RECOMMENDATIONS }), {
    scope: accountA,
    emptyData: EMPTY_ARTIST_RECOMMENDATIONS,
  });
  assert.equal(refreshing.status, "loading");
});

test("You artist recommendations use a cancellable feature hook and show real reasons, dates, and public social proof", () => {
  const hook = source("./useArtistRecommendations.js");
  const service = source("./services/artistRecommendationApi.mjs");
  const rail = source("./ArtistRecommendationsRail.jsx");
  const you = source("../../screens/YouScreen.jsx");
  const app = source("../../../App.js");
  assert.match(hook, /AbortController/);
  assert.match(hook, /projectArtistRecommendationResource/);
  assert.match(service, /expectedAccountId: request\.expectedAccountId/);
  assert.match(rail, /WHY THIS ARTIST/);
  assert.match(rail, /NEXT SHOW/);
  assert.match(rail, /proof\.people\.map/);
  assert.match(rail, /useWindowDimensions/);
  assert.match(you, /artistRecommendations\.refresh\(\{ signal: controller\.signal \}\)/);
  assert.match(you, /<ArtistRecommendationsRail/);
  assert.match(app, /onOpenArtist=\{openArtist\}/);
});
