import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("online review cards use only a canonical external YouTube action", () => {
  const card = source("../components/TicketStub.jsx");
  assert.match(card, /canonicalYouTubeReviewUrl\([\s\S]*?log\.youtubeUrl \|\| log\.youtube_url,[\s\S]*?log\.youtubeVideoId \|\| log\.youtube_video_id/);
  assert.match(card, /Linking\.openURL\(youtubeUrl\)/);
  assert.match(card, /Watch on YouTube/);
  assert.match(card, /target=\{Platform\.OS === "web" \? "_blank" : undefined\}/);
  assert.match(card, /rel=\{Platform\.OS === "web" \? "ugc nofollow noopener noreferrer" : undefined\}/);
  assert.doesNotMatch(card, /canonicalYouTubeReviewUrl\([\s\S]{0,180}sourceUrl/);
  assert.doesNotMatch(card, /Watch on YouTube[\s\S]{0,300}onPlay/);
});

test("online review cards never present physical show, venue, attendance, or archive navigation", () => {
  const card = source("../components/TicketStub.jsx");
  const postScreen = source("../screens/PostScreen.jsx");
  assert.match(card, /isOnlineReview \? "ONLINE CONCERT"/);
  assert.match(card, /isOnlineReview \? \([\s\S]*?Watch on YouTube[\s\S]*?\) : \([\s\S]*?View this show/);
  assert.match(card, /!isOnlineReview && \([\s\S]*?styles\.perfWrap/);
  assert.match(card, /!isOnlineReview && setlist\.length/);
  assert.match(card, /concertContext=\{!isOnlineReview\}/);
  assert.match(postScreen, /onOpenShow=\{isOnlineReview \? undefined : onOpenShow\}/);
  assert.match(postScreen, /onOpenVenue=\{isOnlineReview \? undefined : onOpenVenue\}/);
  assert.match(postScreen, /onOpenArtistArchive=\{isOnlineReview \? undefined : onOpenArtistArchive\}/);
});

test("online cards and public links route to post detail instead of the physical show screen", () => {
  const card = source("../components/TicketStub.jsx");
  const feed = source("../screens/FeedScreen.jsx");
  const profile = source("../screens/ProfileScreen.jsx");
  const app = source("../../App.js");
  assert.match(card, /onOpenPost/);
  assert.match(card, /onNavigate=\{isOnlineReview \? openPostDetail/);
  assert.match(feed, /onOpenPost=\{onComment\}/);
  assert.match(profile, /onOpenPost=\{onOpenPost\}/);
  assert.match(app, /isOnlineReview\(log\)\) return openPost\(log, analytics\)/);
  assert.match(app, /post\.kind === "status" \|\| isOnlineReview\(post\) \? \{ post \} : \{ openLog: post \}/);
  assert.match(app, /<ProfileScreen[^>]*onOpenPost=\{openPost\}/);
});
