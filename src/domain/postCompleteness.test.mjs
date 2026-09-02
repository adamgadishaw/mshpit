import test from "node:test";
import assert from "node:assert/strict";
import { composerEngagementPrompt } from "./postCompleteness.mjs";

test("composer guidance never blocks or nags before a post is valid", () => {
  assert.equal(composerEngagementPrompt({ canPost: false }), null);
});

test("a sparse in-person review receives concrete missing-field guidance", () => {
  const prompt = composerEngagementPrompt({
    canPost: true,
    kind: "review",
    experienceType: "in_person",
    artistLinked: false,
    city: "",
    tour: "",
    review: "",
  });
  assert.equal(prompt.title, "Add a few details");
  assert.match(prompt.body, /choose the artist from search/);
  assert.match(prompt.body, /city/);
});

test("a useful concert post stops showing the reminder", () => {
  assert.equal(composerEngagementPrompt({
    canPost: true,
    kind: "review",
    experienceType: "in_person",
    artistLinked: true,
    city: "Toronto",
    tour: "The Tour",
    review: "A detailed and useful account of the whole concert.",
  }), null);
});

test("status and online review guidance use their own relevant fields", () => {
  assert.match(composerEngagementPrompt({
    canPost: true,
    kind: "status",
    review: "Short",
  }).body, /photo or video/);
  assert.match(composerEngagementPrompt({
    canPost: true,
    kind: "review",
    experienceType: "online",
    artistLinked: true,
    title: "",
    review: "",
  }).body, /concert or video title/);
});
