import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const modal = read("../components/ConcertMemoryModal.jsx");
const you = read("../screens/YouScreen.jsx");
const show = read("../screens/ShowScreen.jsx");
const lounge = read("../screens/LoungeScreen.jsx");
const nearby = read("../components/NearbyAfterparty.jsx");

test("concert memories remain parseable as an in-context accessible sheet", () => {
  for (const [name, source] of Object.entries({ modal, you, show, lounge, nearby })) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }), `${name} must parse`);
  }
  assert.match(modal, /<Modal[\s\S]*?onRequestClose=\{onClose\}/);
  assert.match(modal, /accessibilityViewIsModal/);
  assert.match(modal, /onAccessibilityEscape=\{onClose\}/);
  assert.match(modal, /<SafeAreaView[\s\S]*?edges=\{\["bottom"\]\}/);
  assert.match(modal, /useWindowDimensions\(\)/);
  assert.match(modal, /desktop && styles\.overlayDesktop/);
  assert.match(modal, /overlayDesktop:\s*\{[^}]*justifyContent:\s*"center"/s);
  assert.match(modal, /sheetDesktop:\s*\{[^}]*borderRadius:\s*radius\.lg[^}]*borderBottomWidth:\s*1/s);
});

test("opening a memory stays on You until the member explicitly asks for the full show", () => {
  assert.match(you, /const \[memorySelection, setMemorySelection\] = useState\(null\)/);
  assert.match(you, /memorySelection\?\.accountId === session\?\.id \? memorySelection\.memory : null/);
  assert.match(you, /onPress=\{\(\) => setMemorySelection\(\{ accountId: session\.id, memory \}\)\}/);
  assert.doesNotMatch(you, /onPress=\{\(\) => onOpen\?\.\(memory\.log\)\}/);
  assert.match(you, /onOpenFull=\{onOpen \? openMemoryBreakdown : null\}/);
  assert.match(you, /onOpenPost=\{onOpenPost \? openMemoryPost : null\}/);
  assert.match(modal, />Full show breakdown<\/Text>/);
  assert.match(modal, />Open your post<\/Text>/);
});

test("the memory sheet shows the owner post, full ratings, and manually browsed event media", () => {
  assert.match(modal, /mediaDisplayItems\(log\)/);
  assert.doesNotMatch(modal, /mediaDisplayItems\(log\)\[0\]/);
  assert.match(modal, /accessibilityLabel="Previous event photo"/);
  assert.match(modal, /accessibilityLabel="Next event photo"/);
  assert.match(modal, /\{activeMediaIndex \+ 1\} \/ \{mediaCount\}/);
  assert.doesNotMatch(modal, /setInterval|setTimeout/);
  assert.match(modal, /<Stars value=\{rating\}/);
  assert.match(modal, /text\(log\.review\)/);
  assert.match(modal, /<SmartImage/);
  assert.match(modal, />YOUR POST<\/Text>/);
  assert.match(modal, />YOUR RATING BREAKDOWN<\/Text>/);
  assert.match(modal, /<RatingBreakdown dims=\{ratingDims\}/);
  assert.match(modal, /<RatingSplit band=\{bandRating\} room=\{roomRating\}/);
  assert.match(modal, />Share<\/Text>/);
  assert.match(you, /useArtistEventReviews\(\{/);
  assert.match(you, /enabled:\s*!!selectedMemory && !!selectedArchiveShowKey/);
  assert.match(you, /limit:\s*12/);
  assert.match(you, /concertMemoryGallery\(selectedMemoryLog, selectedMemoryReviews\.data\?\.reviews, \{ limit: 12 \}\)/);
});

test("each exact show has one lifecycle-spanning Lounge and nearby maps are labeled plainly", () => {
  assert.match(lounge, /const key = concertKey\(log\)/);
  assert.match(lounge, /One room for this exact show — before, during, and after/);
  assert.match(lounge, /This is the only Lounge for this show/);
  assert.doesNotMatch(lounge, /afterparty/i);
  assert.match(show, /One Lounge for this exact show — available before, during, and until 24 hours after doors open/);
  assert.match(lounge, /enabled: !!key && entered && loungeOpen/);
  assert.match(lounge, /This show's Lounge has closed/);
  assert.match(lounge, /Continue in the artist Fan Club/);
  assert.match(lounge, /clearLounge\(key\)/);
  assert.match(show, /<Text style=\{styles\.originalPostLabel\}>FAN POST<\/Text>/);
  assert.match(show, />Open the original fan post<\/Text>/);
  assert.doesNotMatch(show, /Comments on this post|Open comments|>POST DISCUSSION<\/Text>/);
  assert.match(nearby, />AFTER THE SHOW NEARBY<\/Text>/);
  assert.match(nearby, />SPOTS NEAR THE VENUE<\/Text>/);
});
