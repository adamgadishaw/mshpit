import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-age-band-safety-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let userSequence = 0;
function addUser({ ageBand = "unknown", dmPolicy = "mutuals" } = {}) {
  userSequence += 1;
  const id = `age_safety_${userSequence}`;
  q.insertUser.run(
    id,
    `${id}@example.test`,
    `Age Safety ${userSequence}`,
    id,
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    "AS",
    "#123456",
    Date.now(),
  );
  db.prepare("UPDATE users SET age_band=?,dm_policy=? WHERE id=?").run(ageBand, dmPolicy, id);
  return q.userById.get(id);
}

function expectApiError(run, { status, code, message }) {
  assert.throws(run, (error) => error instanceof ApiError
    && error.status === status
    && error.code === code
    && (!message || message.test(error.message)));
}

test("signup rejects omitted or unknown age bands and persists a classified band", () => {
  const signup = routes["POST /api/signup"];
  const baseBody = {
    name: "Classified Signup",
    password: "classified-password1",
    city: "Toronto",
    genres: ["Rock"],
    termsVersion: "2026-09-02",
  };

  for (const [suffix, ageBand] of [["missing", undefined], ["unknown", "unknown"]]) {
    const email = `age-signup-${suffix}@example.test`;
    expectApiError(() => signup({
      body: { ...baseBody, email, ...(ageBand ? { ageBand } : {}) },
      ip: `age-signup-${suffix}`,
      ua: "test",
      setSession() { throw new Error("invalid signup must not issue a session"); },
    }), { status: 400, code: "VALIDATION_FAILED", message: /ageBand/u });
    assert.equal(q.userByEmail.get(email), undefined);
  }

  const email = "age-signup-classified@example.test";
  assert.deepEqual(signup({
    body: { ...baseBody, email, ageBand: "18_plus" },
    ip: "age-signup-classified",
    ua: "test",
    setSession() { throw new Error("signup must not issue a session"); },
  }), { ok: true, pending: true });
  assert.equal(q.userByEmail.get(email).age_band, "18_plus");
});

test("an unknown account cannot initiate a new DM until it classifies once", () => {
  const sender = addUser();
  const recipient = addUser({ ageBand: "18_plus", dmPolicy: "people_i_follow" });
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(recipient.id, sender.id);
  const send = routes["POST /api/dms/:otherId"];

  expectApiError(() => send({
    user: sender,
    ip: "age-unknown-first-contact",
    params: { otherId: recipient.id },
    body: { text: "Hello" },
  }), {
    status: 403,
    code: "CONTACT_NOT_ALLOWED",
    message: /Choose your age group in Settings/u,
  });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM dms WHERE from_id=?").get(sender.id).count, 0);

  expectApiError(() => routes["PATCH /api/me"]({
    user: q.userById.get(sender.id),
    ip: "age-classify-invalid",
    body: { ageBand: "unknown" },
  }), { status: 400, code: "VALIDATION_FAILED", message: /Choose 13-17 or 18 or older/u });
  assert.equal(q.userById.get(sender.id).age_band, "unknown");

  const classified = routes["PATCH /api/me"]({
    user: q.userById.get(sender.id),
    ip: "age-classify-once",
    body: { ageBand: "18_plus" },
  });
  assert.equal(classified.user.ageBand, "18_plus");
  assert.equal(q.userById.get(sender.id).age_band, "18_plus");

  const sent = send({
    user: q.userById.get(sender.id),
    ip: "age-classified-first-contact",
    params: { otherId: recipient.id },
    body: { text: "Hello after choosing" },
  });
  assert.match(sent.id, /^dm_/u);

  expectApiError(() => routes["PATCH /api/me"]({
    user: q.userById.get(sender.id),
    ip: "age-reclassify-denied",
    body: { ageBand: "13_17" },
  }), { status: 409, code: "CONFLICT", message: /already saved/u });
  assert.equal(q.userById.get(sender.id).age_band, "18_plus");

  const idempotent = routes["PATCH /api/me"]({
    user: q.userById.get(sender.id),
    ip: "age-classify-idempotent",
    body: { ageBand: "18_plus" },
  });
  assert.equal(idempotent.user.ageBand, "18_plus");
});

test("existing chat history stays readable but sending waits for age classification", () => {
  const unknown = addUser();
  const peer = addUser({ ageBand: "18_plus", dmPolicy: "nobody" });
  db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("dm_existing_age_safety", peer.id, unknown.id, "Existing conversation", Date.now());

  const history = routes["GET /api/dms/:otherId"]({
    user: unknown,
    params: { otherId: peer.id },
    query: {},
  });
  assert.equal(history.messages.at(-1).text, "Existing conversation");

  expectApiError(() => routes["POST /api/dms/:otherId"]({
    user: unknown,
    ip: "age-existing-conversation",
    params: { otherId: peer.id },
    body: { text: "Reply before choosing" },
  }), { status: 403, code: "CONTACT_NOT_ALLOWED", message: /Choose your age group/u });

  routes["PATCH /api/me"]({
    user: q.userById.get(unknown.id),
    ip: "age-existing-classify",
    body: { ageBand: "18_plus" },
  });
  const result = routes["POST /api/dms/:otherId"]({
    user: q.userById.get(unknown.id),
    ip: "age-existing-conversation",
    params: { otherId: peer.id },
    body: { text: "Reply after choosing" },
  });
  assert.match(result.id, /^dm_/u);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM dms WHERE from_id=? AND to_id=?")
    .get(unknown.id, peer.id).count, 1);
});

test("an existing adult-teen conversation becomes read-only unless follows are mutual", () => {
  const adult = addUser({ ageBand: "18_plus" });
  const teen = addUser({ ageBand: "13_17" });
  db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("dm_existing_teen_boundary", adult.id, teen.id, "Earlier message", Date.now());
  const send = () => routes["POST /api/dms/:otherId"]({
    user: adult,
    ip: "age-existing-teen",
    params: { otherId: teen.id },
    body: { text: "A new message" },
  });

  expectApiError(send, { status: 403, code: "CONTACT_NOT_ALLOWED" });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM dms WHERE from_id=? AND to_id=?")
    .get(adult.id, teen.id).count, 1);
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(adult.id, teen.id);
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(teen.id, adult.id);
  assert.match(send().id, /^dm_/u);
});
