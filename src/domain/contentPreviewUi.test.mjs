import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";

const component = readFileSync(new URL("../components/ExpandableText.jsx", import.meta.url), "utf8");
const ticketStub = readFileSync(new URL("../components/TicketStub.jsx", import.meta.url), "utf8");
const feedScreen = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
const postScreen = readFileSync(new URL("../screens/PostScreen.jsx", import.meta.url), "utf8");
const profileScreen = readFileSync(new URL("../screens/ProfileScreen.jsx", import.meta.url), "utf8");

test("expandable text exposes full source meaning and an accessible sibling toggle", () => {
  assert.doesNotThrow(() => parse(component, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(component, /const bodyProps = \{ text: preview\.text, accessibilityLabel: original \}/);
  assert.match(component, /accessibilityState=\{\{ expanded \}\}/);
  assert.match(component, /accessibilityLabel=\{expanded \? lessAccessibilityLabel : moreAccessibilityLabel\}/);
  assert.match(component, /const expandable = compact && preview\.expandable/);
  assert.match(component, /typeof renderText === "function"\s*\? renderText\(bodyProps\)/);
});

test("feed and profile cards use compact copy while a dedicated post keeps the complete review open", () => {
  for (const source of [ticketStub, feedScreen, postScreen, profileScreen]) {
    assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }));
  }

  assert.match(ticketStub, /compactContent = false/);
  assert.match(ticketStub, /key={`status-copy:\${log\.id}`}/);
  assert.match(ticketStub, /key={`review-copy:\${log\.id}`}/);
  assert.match(ticketStub, /accessibilityLabel={`\${accessibilityLabel}\. Open post and comments\.`}/);
  assert.match(feedScreen, /<TicketStub[\s\S]*?log=\{item\}[\s\S]*?compactContent/);
  assert.match(profileScreen, /<TicketStub[\s\S]*?compactContent/);
  assert.match(postScreen, /<TicketStub log={activeLog} compactContent={false}/);
});
