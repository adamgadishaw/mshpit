import test from "node:test";
import assert from "node:assert/strict";
import { readSensitiveLinkToken, scrubSensitiveLinkToken } from "./sensitiveLinkTokens.mjs";

const TOKEN = "0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE";

test("reads new fragment credentials before legacy query credentials", () => {
  assert.equal(readSensitiveLinkToken({ search: `?reset=${TOKEN}old`, hash: `#reset=${TOKEN}` }, "reset"), TOKEN);
});

test("continues to accept a valid legacy query credential", () => {
  assert.equal(readSensitiveLinkToken({ search: `?reset=${TOKEN}`, hash: "" }, "reset"), TOKEN);
});

test("rejects malformed or implausibly short credentials", () => {
  assert.equal(readSensitiveLinkToken({ search: "?reset=hello%20world", hash: "" }, "reset"), null);
  assert.equal(readSensitiveLinkToken({ search: "", hash: "#reset=short" }, "reset"), null);
});

test("scrubs only the consumed credential and preserves navigation state", () => {
  assert.equal(
    scrubSensitiveLinkToken({ pathname: "/artist/alpha", search: `?from=email&reset=${TOKEN}`, hash: "#section" }, "reset"),
    "/artist/alpha?from=email#section",
  );
  assert.equal(
    scrubSensitiveLinkToken({ pathname: "/", search: "?from=email", hash: `#reset=${TOKEN}&campaign=one` }, "reset"),
    "/?from=email#campaign=one",
  );
});
