import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sharedYouTubeUrl } from "./sharedYouTubeAttachment.mjs";

test("shared YouTube attachments open only exact canonical video URLs", () => {
  assert.equal(
    sharedYouTubeUrl({ videoId: "dQw4w9WgXcQ" }),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  assert.equal(sharedYouTubeUrl({ videoId: "too-short" }), null);
  assert.equal(sharedYouTubeUrl({ videoId: "dQw4w9WgXcQ&list=private" }), null);
  assert.equal(sharedYouTubeUrl({ videoId: "dQw4w9WgXc/" }), null);
  assert.equal(sharedYouTubeUrl({}), null);
});

test("paused post attachments stay watchable and uploaded media stays rendered", () => {
  const songAttachment = readFileSync(new URL("../components/SongAttachment.jsx", import.meta.url), "utf8");
  const ticketStub = readFileSync(new URL("../components/TicketStub.jsx", import.meta.url), "utf8");

  assert.match(songAttachment, /WATCH ON YOUTUBE/);
  assert.match(songAttachment, /Linking\.openURL\(track\.youtubeUrl\)/);
  assert.doesNotMatch(songAttachment, /Pit player/i);
  assert.match(ticketStub, /<SongAttachment\b/);
  assert.match(ticketStub, /<PostMediaGrid\b/);
});
