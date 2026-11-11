import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-preferences-export-"));
process.env.NODE_ENV = "test";
process.env.PIT_DATA_DIR = directory;
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
globalThis.fetch = async () => { throw new Error("Unexpected network request in account export test"); };
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { hashPassword, resetRateLimitsForTests } = await import("./auth.js");
const { createFestivalReader } = await import("./features/festivals/festivalStore.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => resetRateLimitsForTests());

const password = "Preferences-export-password1";
const passwordHash = hashPassword(password);
let sequence = 0;
function member(email) {
  const id = `preferences_export_${++sequence}`;
  q.insertUser.run(id, email || `${id}@example.test`, id, id, passwordHash,
    "fan", null, null, null, "PE", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
function edition(overrides = {}) {
  const value = { id: `preferences_edition_${++sequence}`, festivalSlug: "lollapalooza", name: "Synthetic festival edition",
    startDate: "2027-07-30", endDate: "2027-07-31", city: "Chicago", region: "IL", countryCode: "US", ...overrides };
  db.prepare(`INSERT INTO festival_editions
    (id,festival_slug,name,start_date,end_date,city,region,country_code,lineup,first_seen_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,1)`).run(value.id, value.festivalSlug, value.name, value.startDate, value.endDate,
    value.city, value.region, value.countryCode, '[{"name":"Synthetic Act"}]');
  return value;
}
const savePlan = (user, editionId, { days = '["2027-07-30"]', mustSee = '["Synthetic Act"]', createdAt = 100, updatedAt = 200 } = {}) => {
  db.prepare("INSERT INTO festival_plans(user_id,edition_id,days,must_see,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(user.id, editionId, days, mustSee, createdAt, updatedAt);
};
const context = (user, body = {}) => ({ user, body, ip: `preferences-export-${user?.id || "guest"}`, setHeader() {} });
const exportFor = (user, body = {}) => routes["POST /api/me/export"](context(user, { password, ...body }));

test("password-confirmed export includes only owned mutes and plans with stable opaque references", async () => {
  const owner = member();
  const sibling = member(owner.email);
  const hidden = member();
  const other = member();
  const event = edition();
  routes["POST /api/users/:id/mute"]({ ...context(owner, { muted: true }), params: { id: hidden.id } });
  routes["POST /api/users/:id/mute"]({ ...context(sibling, { muted: true }), params: { id: other.id } });
  routes["PUT /api/festivals/:slug/plan"]({ ...context(owner, {
    editionId: event.id, days: [event.startDate], mustSee: ["Synthetic Act"],
  }), params: { slug: event.festivalSlug } });
  savePlan(sibling, event.id, { days: '["2027-07-31"]', mustSee: '["Sibling-only act"]' });
  db.prepare("UPDATE users SET profile_audience='only_me',bio='private counterpart biography',home_city='private counterpart city' WHERE id=?").run(hidden.id);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES (?,?,1)").run(hidden.id, owner.id);
  const storedMute = db.prepare("SELECT created_at FROM account_mutes WHERE muter_id=? AND muted_id=?").get(owner.id, hidden.id);
  const storedPlan = db.prepare("SELECT created_at,updated_at FROM festival_plans WHERE user_id=? AND edition_id=?").get(owner.id, event.id);

  const data = await exportFor(owner, { userId: sibling.id });
  assert.deepEqual(data.muted, [{ id: hidden.id, createdAt: storedMute.created_at }]);
  assert.deepEqual(data.festivalPlans, [{ editionId: event.id, festivalSlug: event.festivalSlug,
    days: [event.startDate], mustSee: ["Synthetic Act"], createdAt: storedPlan.created_at, updatedAt: storedPlan.updated_at }]);
  assert.equal(data.profile.id, owner.id, "body account selectors cannot switch ownership");
  assert.doesNotMatch(JSON.stringify(data), /private counterpart biography|private counterpart city|Sibling-only act/);
  const siblingData = await exportFor(sibling);
  assert.deepEqual(siblingData.muted.map(row => row.id), [other.id]);
  assert.deepEqual(siblingData.festivalPlans[0].mustSee, ["Sibling-only act"]);
  assert.deepEqual((await exportFor(other)).muted, []);
  assert.deepEqual((await exportFor(other)).festivalPlans, []);
});

test("export retains past and hidden festival plans and selections after the catalog changes", async () => {
  const owner = member();
  const past = edition({ startDate: "2020-07-30", endDate: "2020-07-31" });
  const hidden = edition({ festivalSlug: "boots-and-hearts", name: "Boots and Hearts West 2026",
    startDate: "2026-08-28", endDate: "2026-08-29", city: "Edmonton", region: "AB", countryCode: "CA" });
  savePlan(owner, past.id, { days: '["2020-07-30"]', mustSee: '["Historical Act"]', createdAt: 11, updatedAt: 50 });
  savePlan(owner, hidden.id, { days: '["2026-08-28"]', mustSee: '["Saved Act"]', createdAt: 12, updatedAt: 50 });
  db.prepare("UPDATE festival_editions SET start_date='2028-01-01',end_date='2028-01-02',lineup='[]' WHERE id=?").run(past.id);
  assert.equal(createFestivalReader(db).edition(hidden.id), null, "fixture is hidden by public catalog policy");
  const data = await exportFor(owner);
  assert.deepEqual(data.festivalPlans, [
    { editionId: past.id, festivalSlug: past.festivalSlug, days: ["2020-07-30"], mustSee: ["Historical Act"], createdAt: 11, updatedAt: 50 },
    { editionId: hidden.id, festivalSlug: hidden.festivalSlug, days: ["2026-08-28"], mustSee: ["Saved Act"], createdAt: 12, updatedAt: 50 },
  ].sort((a,b) => a.editionId.localeCompare(b.editionId)));
});

test("export includes complete current preferences beyond management-list limits", async () => {
  const owner = member();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < 501; index++) {
      const other = member();
      db.prepare("INSERT INTO account_mutes(muter_id,muted_id,created_at) VALUES (?,?,?)").run(owner.id, other.id, index);
    }
    for (let index = 0; index < 201; index++) savePlan(owner, edition().id, { updatedAt: index });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  const data = await exportFor(owner);
  assert.equal(data.muted.length, 501);
  assert.equal(data.festivalPlans.length, 201);
  assert.equal(data.muted[0].createdAt, 500);
  assert.equal(data.festivalPlans[0].updatedAt, 200);
});

test("export safely handles malformed selection JSON and excludes future internal columns", async () => {
  const owner = member();
  const other = member();
  const invalid = edition();
  const scalar = edition();
  const mixed = edition();
  savePlan(owner, invalid.id, { days: "{", mustSee: "not json" });
  savePlan(owner, scalar.id, { days: '{"sourceUrl":"private-capability-fixture"}', mustSee: '"private-capability-fixture"' });
  savePlan(owner, mixed.id, { days: '["2027-07-30",{"sourceUrl":"private-capability-fixture"},null,5]',
    mustSee: '["Synthetic Act",["private-capability-fixture"],{"name":"private-capability-fixture"}]' });
  db.exec(`ALTER TABLE account_mutes ADD COLUMN future_internal_capability TEXT;
    ALTER TABLE festival_plans ADD COLUMN future_internal_capability TEXT;
    ALTER TABLE festival_editions ADD COLUMN future_internal_capability TEXT;`);
  db.prepare("INSERT INTO account_mutes(muter_id,muted_id,created_at,future_internal_capability) VALUES (?,?,1,?)").run(owner.id, other.id, "private-capability-fixture");
  db.exec("UPDATE festival_plans SET future_internal_capability='private-capability-fixture'; UPDATE festival_editions SET future_internal_capability='private-capability-fixture'");
  const data = await exportFor(owner);
  const plans = new Map(data.festivalPlans.map(row => [row.editionId, row]));
  for (const id of [invalid.id, scalar.id]) {
    assert.deepEqual(plans.get(id).days, []);
    assert.deepEqual(plans.get(id).mustSee, []);
  }
  assert.deepEqual(plans.get(mixed.id).days, ["2027-07-30"]);
  assert.deepEqual(plans.get(mixed.id).mustSee, ["Synthetic Act"]);
  assert.doesNotMatch(JSON.stringify(data), /private-capability-fixture|future_internal_capability/);
  assert.deepEqual(Object.keys(data.muted[0]).sort(), ["createdAt", "id"]);
  assert.deepEqual(Object.keys(data.festivalPlans[0]).sort(), ["createdAt", "days", "editionId", "festivalSlug", "mustSee", "updatedAt"]);
});

test("new export categories retain password authentication and disclosed history limits", async () => {
  const owner = member();
  const other = member();
  await assert.rejects(exportFor(owner, { password: "incorrect-password" }), { code: "AUTH_INVALID" });
  await assert.rejects(exportFor(owner, { password: "" }), { code: "AUTH_INVALID" });
  await assert.rejects(exportFor(null), { code: "AUTH_REQUIRED" });
  const insert = db.prepare("INSERT INTO dms(id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < 1001; index++) insert.run(`preferences_dm_${index}`, owner.id, other.id, "Synthetic message", index);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  const data = await exportFor(owner);
  assert.equal(data.messagesSent.length, 1000);
  assert.equal(data.messagesSent[0].createdAt, 1000);
  assert.equal(data.messagesSent.at(-1).createdAt, 1);
  assert.ok(data.exportNotes.some(note => note.includes("1,000 sent and received messages")));
  assert.ok(data.exportNotes.some(note => note.includes("account mutes") && note.includes("festival plans")));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
