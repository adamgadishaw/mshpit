import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const feed = source("../screens/FeedScreen.jsx");
const profile = source("../screens/ProfileScreen.jsx");
const ticket = source("../components/TicketStub.jsx");

test("feed viewport updates keep stable data and isolate unchanged ticket rows", () => {
  assert.doesNotThrow(() => parse(feed, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(feed, /const FeedTicketRow = memo\(function FeedTicketRow/);
  assert.match(feed, /const data = useMemo\(\(\) => full\.slice\(0, count\), \[count, full\]\)/);
  assert.match(feed, /const renderFeedItem = useCallback/);
  assert.match(feed, /rowActionsRef\.current = \{/);
  assert.match(feed, /mediaViewable=\{visibleMediaPostIds\.has\(String\(item\.id\)\) \? true : null\}/);
  assert.match(feed, /renderItem=\{renderFeedItem\}/);
  assert.match(feed, /initialNumToRender=\{phone \? 3 : PAGE\}/);
  assert.match(feed, /windowSize=\{phone \? 3 : 7\}/);
});

test("profile reuses expensive projections and stable media and post rows", () => {
  assert.doesNotThrow(() => parse(profile, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(profile, /const ProfileMediaTile = memo\(function ProfileMediaTile/);
  assert.match(profile, /const ProfileTicketRow = memo\(function ProfileTicketRow/);
  assert.match(profile, /const reviews = useMemo\(\(\) => selectConcertReviews\(logs\), \[logs\]\)/);
  assert.match(profile, /const timeline = useMemo\(\(\) => selectProfileTimeline\(logs\), \[logs\]\)/);
  assert.match(profile, /const gallery = useMemo\(\(\) => profileMediaItems\(logs, \{ isSelf \}\), \[isSelf, logs\]\)/);
  assert.match(profile, /const galleryPreview = useMemo\(\(\) => gallery\.slice\(0, 3\), \[gallery\]\)/);
  assert.match(profile, /compactContent/);
});

test("ticket cards cache static post projections across engagement-only renders", () => {
  assert.doesNotThrow(() => parse(ticket, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(ticket, /const author = useMemo\(/);
  assert.match(ticket, /const postContext = useMemo\(\(\) => concertPostContext\(log\), \[log\]\)/);
  assert.match(ticket, /const postMedia = useMemo\(\(\) => mediaDisplayItems\(log\)\.map/);
  assert.match(ticket, /const campaignPresentation = useMemo\(/);
  assert.match(ticket, /const attendanceTicketCard = useMemo\(/);
  assert.match(ticket, /const performance = useMemo\(\(\) => reviewCardPerformance\(log\), \[log\]\)/);
});
