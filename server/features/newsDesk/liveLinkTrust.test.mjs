import assert from "node:assert/strict";
import test from "node:test";
import { trustedLiveLinkHost } from "./newsLive.js";

test("live update links go only to outlets, official channels and major video or social sites", () => {
  for (const host of ["pitchfork.com", "www.billboard.com", "youtu.be", "m.youtube.com", "www.instagram.com", "grammy.com", "WWW.NME.COM."]) {
    assert.equal(trustedLiveLinkHost(host), true, host);
  }
  for (const host of ["pitchfork.com.evil.example", "billboard-news.click", "bit.ly", "youtube.com-login.example", "example.com", ""]) {
    assert.equal(trustedLiveLinkHost(host), false, host);
  }
});
