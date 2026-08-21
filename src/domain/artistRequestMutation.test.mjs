import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ARTIST_REQUEST_SAVE_ERROR,
  artistRequestFailureMessage,
  confirmedArtistRequest,
  mergeConfirmedArtistRequest,
} from "./artistRequestMutation.mjs";

test("artist request rows require the canonical ID returned by the server", () => {
  const submission = {
    userId: "u_fan",
    artistName: "Model/Actriz",
    note: "Management contact available",
  };
  assert.deepEqual(confirmedArtistRequest({ id: "ar_confirmed_123" }, submission), {
    id: "ar_confirmed_123",
    userId: "u_fan",
    artistName: "Model/Actriz",
    note: "Management contact available",
    status: "pending",
  });
  assert.equal(confirmedArtistRequest({}, submission), null);
  assert.equal(confirmedArtistRequest({ id: " locally-invented " }, submission), null);
  assert.equal(confirmedArtistRequest({ id: "bad/id" }, submission), null);
});

test("only a confirmed request enters local state and duplicate responses stay unique", () => {
  const current = [{ id: "ar_old", userId: "u_old", artistName: "Old Act", note: "", status: "pending" }];
  const confirmed = confirmedArtistRequest(
    { id: "ar_new" },
    { userId: "u_fan", artistName: "New Act", note: "Official email" },
  );
  assert.equal(mergeConfirmedArtistRequest(current, null), current);
  assert.deepEqual(mergeConfirmedArtistRequest(current, confirmed).map((row) => row.id), ["ar_new", "ar_old"]);
  assert.deepEqual(
    mergeConfirmedArtistRequest([confirmed, ...current], confirmed).map((row) => row.id),
    ["ar_new", "ar_old"],
  );
});

test("request failures expose only safe inline copy", () => {
  assert.equal(artistRequestFailureMessage({ userMessage: "Check your connection and try again." }), "Check your connection and try again.");
  assert.equal(artistRequestFailureMessage(new Error("database password leaked")), ARTIST_REQUEST_SAVE_ERROR);
});

test("the store awaits persistence before inserting or returning success", () => {
  const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const start = storeSource.indexOf("const requestArtist =");
  const end = storeSource.indexOf("const approveArtist =", start);
  assert.ok(start >= 0 && end > start, "requestArtist mutation should be present");
  const mutation = storeSource.slice(start, end);
  const awaitServer = mutation.indexOf("await api(");
  const insertConfirmed = mutation.indexOf("setRequests(");
  const returnSuccess = mutation.indexOf("return { ok: true");

  assert.match(mutation, /const requestArtist = async/);
  assert.ok(awaitServer >= 0, "requestArtist must await the server");
  assert.ok(insertConfirmed > awaitServer, "local state must only change after the server resolves");
  assert.ok(returnSuccess > insertConfirmed, "success must only return after the confirmed row is inserted");
  assert.match(mutation, /if \(!request\) return \{ ok: false/);
  assert.doesNotMatch(mutation, /Date\.now\(\)|\.catch\(\(\) => \{\}\)/);
});
