import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("post artist picker is debounced, abortable, bounded, and can search beyond the ingested catalog", () => {
  const composer = source("../screens/LogScreen.jsx");
  const store = source("../store.js");
  const artistSearch = source("../features/artistSearch/artistSearchApi.mjs");

  assert.match(composer, /const controller = new AbortController\(\)/);
  assert.match(composer, /searchArtistsApi\(q, \{[\s\S]*?throwOnError: true,[\s\S]*?limit: COMPOSER_ARTIST_SEARCH_LIMIT,[\s\S]*?remoteFallback: true/);
  assert.match(composer, /\}\), 320\)/, "composer artist lookup remains debounced");
  assert.match(composer, /sequence === artistRequestRef\.current/);
  assert.doesNotMatch(store, /artistSearchCacheRef/, "search caching stays out of the Store hook");
  assert.match(artistSearch, /const settledCachesByClient = new WeakMap\(\)/);
  assert.match(artistSearch, /cache\.size > ARTIST_SEARCH_CACHE_MAX_ENTRIES/);
  assert.match(composer, /attachArtistSuggestionApi\(candidate, \{ signal: controller\.signal \}\)/);
  assert.match(composer, /posting \|\| artistAttaching/);
  assert.match(artistSearch, /method: "POST"[\s\S]*?body: \{ name/);
  assert.match(artistSearch, /Pit did not return a durable artist identity/);
});

test("unified search reuses local matches and production does not scan the demo artist fixture", () => {
  const search = source("../screens/SearchScreen.jsx");
  const store = source("../store.js");
  const server = source("../../server/api.js");
  const database = source("../../server/db.js");

  assert.doesNotMatch(search, /const venueCount = searchVenues\(query, 24\)\.length/);
  assert.match(search, /localResultCountRef\.current = venues\.length \+ events\.length \+ clubs\.length/);
  assert.match(search, /const localResultCount = localResultCountRef\.current/);
  assert.match(search, /\+ localResultCount/);
  assert.match(search, /if \(ENABLE_DEMO_DATA\) Object\.values\(ingestedArtists\)/);
  assert.match(store, /memoizedUnifiedVenueSearchIndex\(\{[\s\S]*?tourDates,[\s\S]*?curatedVenues: arenaVenues,[\s\S]*?catalogVenues,[\s\S]*?ratedShows/);
  assert.match(store, /searchUnifiedVenueIndex\(venueSearchIndex, query, \{ limit \}\)/);
  assert.match(store, /Object\.values\(arenaVenues\)\.forEach\(\(v\) => add\(v\.name, v\.place\)\)/);
  assert.doesNotMatch(store, /const upcomingByVenue = new Map\(\)/, "venue queries reuse one snapshot index");
  assert.match(database, /searchPrefix: db\.prepare/);
  assert.match(server, /artistStmts\.searchPrefix\.all/);
});

test("official provider titles remain distinct while clear tour names prefill the review", () => {
  const app = source("../../App.js");
  const composer = source("../screens/LogScreen.jsx");
  const card = source("../components/TicketStub.jsx");

  assert.match(app, /tour: log\.tourName \|\| log\.tour \|\| ""/);
  assert.match(app, /officialEventName: log\.eventName \|\| null/);
  assert.match(composer, /editing\?\.tour \|\| prefill\?\.tour \|\| ""/);
  assert.doesNotMatch(composer, /prefill\?\.tour \|\| prefill\?\.eventName/);
  assert.match(composer, /EVENT LISTING NAME/);
  assert.match(composer, /TOUR OR SPECIAL EVENT/);
  assert.match(card, /const performance = useMemo\(\(\) => reviewCardPerformance\(log\), \[log\]\)/);
  assert.match(card, /const performanceTitle = performance\.primary/);
  assert.match(card, /styles\.performanceCard/);
  assert.match(card, /styles\.performanceRegister/);
  assert.match(card, /MSHPIT \/ LIVE MEMORY/);
  assert.match(card, /styles\.performancePerforation/);
  assert.match(card, /style=\{styles\.performanceCardShadow\}[\s\S]*?style=\{\[styles\.performanceCard, !isOnlineReview && styles\.performanceCardAttached\]\}/);
  assert.match(card, /performanceCardShadow: \{[^}]*\.\.\.shadow\.card \}/);
  assert.match(card, /performanceCard: \{ overflow: "hidden",[^}]*backgroundColor: colors\.bgElev \}/);
  assert.doesNotMatch(card, /performanceCard: \{[^}]*\.\.\.shadow\.card/);
  assert.match(card, /<PublicTextLink href=\{artistHref\}[\s\S]*?\{performanceTitle\}<\/PublicTextLink>/);
  assert.match(card, />View this show<\/Text>/);
  assert.match(card, /Compare \{artist\} shows/);
  assert.match(card, /ticketActionRail: \{[^}]*borderTopWidth: 0[^}]*borderBottomLeftRadius/);
  assert.match(card, /onOpenArtistArchive/);
  for (const field of ["log.artist", "log.venue", "log.city", "log.date"]) assert.ok(card.includes(field));
});
