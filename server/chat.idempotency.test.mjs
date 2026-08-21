import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-chat-idempotency-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id.replace(/[^a-z0-9_]/g, "").slice(0, 20),
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  return q.userById.get(id);
}

const sender = addUser("chat_sender");
const recipient = addUser("chat_recipient");
const alternate = addUser("chat_alternate");

test("DM retries return one row and reject mutation-token reuse", () => {
  const send = routes["POST /api/dms/:otherId"];
  const body = { text: "one logical direct message", clientMutationId: "dm_retry_token_001" };
  const first = send({ user: sender, ip: "dm-idempotency", params: { otherId: recipient.id }, body });
  const retry = send({ user: sender, ip: "dm-idempotency", params: { otherId: recipient.id }, body });

  assert.equal(retry.id, first.id);
  assert.equal(retry.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM dms WHERE from_id=? AND client_mutation_id=?")
    .get(sender.id, body.clientMutationId).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE user_id=? AND type='dm' AND post_id=?")
    .get(recipient.id, first.id).count, 1, "a retry must not notify twice");

  assert.throws(
    () => send({
      user: sender,
      ip: "dm-idempotency-conflict",
      params: { otherId: alternate.id },
      body: { ...body, text: "different payload" },
    }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "CONFLICT",
  );
});

test("fan-club retries return one row and keep the token bound to its room and text", () => {
  const artist = "test artist";
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run(artist, sender.id);
  const send = routes["POST /api/fanclubs/:artist/messages"];
  const ctx = {
    user: sender,
    ip: "fan-idempotency",
    params: { artist: encodeURIComponent(artist) },
    body: { text: "one logical fan message", clientMutationId: "fan_retry_token_001" },
  };
  const first = send(ctx);
  const retry = send(ctx);

  assert.equal(retry.id, first.id);
  assert.equal(retry.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM fan_club_messages WHERE user_id=? AND client_mutation_id=?")
    .get(sender.id, ctx.body.clientMutationId).count, 1);
  assert.throws(
    () => send({ ...ctx, body: { ...ctx.body, text: "changed fan message" } }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "CONFLICT",
  );
});

test("lounge retries return one row and malformed tokens are rejected", () => {
  const loungeKey = "artist|venue|2026-08-21";
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,city,date) VALUES (?,?,?,?,?,?)")
    .run(sender.id, loungeKey, "Artist", "Venue", "Toronto", "2026-08-21");
  const send = routes["POST /api/lounges/:key/messages"];
  const ctx = {
    user: sender,
    ip: "lounge-idempotency",
    params: { key: encodeURIComponent(loungeKey) },
    body: { text: "one logical lounge message", clientMutationId: "lounge_retry_token_001" },
  };
  const first = send(ctx);
  const retry = send(ctx);

  assert.equal(retry.id, first.id);
  assert.equal(retry.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM lounge_messages WHERE user_id=? AND client_mutation_id=?")
    .get(sender.id, ctx.body.clientMutationId).count, 1);
  assert.throws(
    () => send({ ...ctx, body: { text: "bad token", clientMutationId: "short" } }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
});
