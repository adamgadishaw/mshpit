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
});

test("opening a memory stays on You until the member explicitly asks for the full show", () => {
  assert.match(you, /const \[memorySelection, setMemorySelection\] = useState\(null\)/);
  assert.match(you, /memorySelection\?\.accountId === session\?\.id \? memorySelection\.memory : null/);
  assert.match(you, /onPress=\{\(\) => setMemorySelection\(\{ accountId: session\.id, memory \}\)\}/);
  assert.doesNotMatch(you, /onPress=\{\(\) => onOpen\?\.\(memory\.log\)\}/);
  assert.match(you, /onOpenFull=\{onOpen \? openMemoryBreakdown : null\}/);
  assert.match(modal, />Full show breakdown<\/Text>/);
});

test("the memory sheet shows genuine summary, rating, review, and available media without loading show data", () => {
  assert.match(modal, /mediaDisplayItems\(log\)\[0\]/);
  assert.match(modal, /<Stars value=\{rating\}/);
  assert.match(modal, /text\(log\.review\)/);
  assert.match(modal, /<SmartImage/);
  assert.match(modal, />Share<\/Text>/);
  assert.doesNotMatch(modal, /useStore|\bapi\(|fetch\(/);
});

test("each exact show has one lifecycle-spanning Lounge and nearby maps are labeled plainly", () => {
  assert.match(lounge, /const key = concertKey\(log\)/);
  assert.match(lounge, /One room for this exact show — before, during, and after/);
  assert.match(lounge, /This is the only Lounge for this show/);
  assert.doesNotMatch(lounge, /afterparty/i);
  assert.match(show, /One Lounge for this exact show — open before, during, or after/);
  assert.match(show, /<Text style=\{styles\.discussionLabel\}>COMMENTS<\/Text>/);
  assert.doesNotMatch(show, />POST DISCUSSION<\/Text>/);
  assert.match(nearby, />AFTER THE SHOW NEARBY<\/Text>/);
  assert.match(nearby, />SPOTS NEAR THE VENUE<\/Text>/);
});
