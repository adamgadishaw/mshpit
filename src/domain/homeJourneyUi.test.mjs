import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const landing = source("../screens/LandingScreen.jsx");
const feed = source("../screens/FeedScreen.jsx");
const card = source("../components/TicketStub.jsx");
const commentPreview = source("../components/AfterpartyPreview.jsx");
const post = source("../screens/PostScreen.jsx");
const profile = source("../screens/ProfileScreen.jsx");
const app = source("../../App.js");

test("landing and home explain the same compact concert-social journey", () => {
  assert.ok(landing.includes("HOME_JOURNEY_LINE"));
  assert.ok(landing.includes("HOW MSHPIT WORKS"));
  assert.ok(feed.includes("HOME_JOURNEY_LINE"));
  assert.ok(feed.includes("homeGuideStorageKey(accountId)"));
  assert.ok(!feed.includes("pit.gsDismissed"));
  assert.ok(feed.includes('label="Find a show"'));
  assert.ok(feed.includes('label="Log a show"'));
});

test("feed comment previews are bounded, request-free, and have no inline composer", () => {
  assert.ok(commentPreview.includes("export default function CommentPreview"));
  assert.ok(commentPreview.includes("Math.max(0, Math.min(2"));
  assert.ok(commentPreview.includes("inlineCommentPreview(log.commentPreview, []"));
  for (const forbidden of ["TextInput", "useEffect", "loadComments", "addComment", "commentsFor"]) {
    assert.ok(!commentPreview.includes(forbidden), forbidden);
  }
  assert.ok(card.includes(">Comments</Text>"));
  assert.ok(!card.includes(">Afterparty</Text>"));
  assert.ok(!card.includes("Open the afterparty discussion"));
});

test("concert posts link to the exact post and the canonical artist concert archive", () => {
  assert.ok(card.includes("concertPostContext(log)"));
  assert.ok(card.includes("href={canonicalPostHref}"));
  assert.ok(card.includes(">View this show</Text>"));
  assert.ok(card.includes("href={postContext.artistConcertsHref}"));
  assert.ok(card.split("href={postContext.artistConcertsHref}").length - 1 >= 2);
  assert.ok(card.includes("attendanceTicketCard && canCompareArtistShows"));
  const callback = card.slice(card.indexOf("onOpenArtistArchive?.("));
  const artist = callback.indexOf("postContext.artist,");
  const artistKey = callback.indexOf("postContext.artistKey,");
  const publicSlug = callback.indexOf("postContext.artistPublicSlug");
  assert.ok(artist >= 0 && artist < artistKey && artistKey < publicSlug);
  assert.ok(card.includes("Compare {postContext.artist} shows"));
  assert.ok(!card.includes("tourPath"));
  assert.ok(!card.includes("tourHref"));
});

test("artist archive navigation reaches feed, direct post, and member profile cards", () => {
  assert.ok(feed.includes("onOpenArtistArchive={onOpenArtistArchive}"));
  assert.ok(post.includes("onOpenArtistArchive={onOpenArtistArchive}"));
  assert.ok(profile.includes("onOpenArtistArchive={onOpenArtistArchive}"));
  assert.ok(app.split("onOpenArtistArchive={openArtistArchive}").length - 1 >= 3);
});
