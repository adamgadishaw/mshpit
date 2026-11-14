import assert from "node:assert/strict";
import test, { after } from "node:test";
import { THEME_KEYS, PRIMARY_THEME_KEYS } from "../src/domain/themeAccess.mjs";
const { db, q, publicUser } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => db.close());
let serial = 0;
function account(role = "fan", extras = {}) {
  const id = `theme-${++serial}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "fixture", role, "Toronto", null, null, "TH", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,extras=? WHERE id=?").run(Date.now(), JSON.stringify(extras), id);
  return q.userById.get(id);
}
const patch = (user, body, rest = {}) => routes["PATCH /api/me"]({ user, body, ip: user?.id || "guest", ...rest });
const stored = id => JSON.parse(q.userById.get(id).extras);

for (const role of ["fan", "artist", "moderator", "editor", "admin"]) {
  test(`${role}: actual profile writes enforce both theme surfaces for all 12 presets`, () => {
    const member = account(role, { theme: "daylight", pronouns: "they/them" });
    for (const key of THEME_KEYS) {
      for (const body of [{ theme: key }, { extras: { theme: key } }]) {
        const before = q.userById.get(member.id);
        if (role === "admin" || PRIMARY_THEME_KEYS.includes(key)) {
          assert.equal(patch(member, body).user.theme, key);
          assert.equal(stored(member.id).theme, key);
        } else {
          assert.throws(() => patch(member, { bio: "must not commit", ...body }), error => error.status === 403 && error.code === "FORBIDDEN");
          assert.equal(q.userById.get(member.id).extras, before.extras);
          assert.equal(q.userById.get(member.id).bio, before.bio);
        }
      }
    }
    assert.equal(stored(member.id).pronouns, "they/them");
  });
}

test("public direct themes cannot mask restricted extras, spoofed roles or badges", () => {
  const member = account("fan", { theme: "daylight" });
  for (const body of [
    { theme: "stage", extras: { theme: "neon" } },
    { theme: "forest", extras: { theme: "stage" } },
    { theme: "neon", role: "admin", badges: ["staff", "founder"], verified: true, sponsor: true },
  ]) assert.throws(() => patch(member, body), error => error.status === 403);
  assert.equal(stored(member.id).theme, "daylight");
  assert.throws(() => patch(null, { theme: "stage" }), error => error.status === 401);
});

test("write-lock role wins over a stale authenticated admin object", () => {
  const admin = account("admin", { theme: "forest" });
  db.prepare("UPDATE users SET role='fan' WHERE id=?").run(admin.id);
  assert.throws(() => patch(admin, { theme: "neon" }), error => error.status === 403);
  assert.equal(stored(admin.id).theme, "forest");
});

test("legacy restricted preferences project safely without read-time writes or loss", () => {
  const member = account("fan", { theme: "forest", pronouns: "they/them" });
  for (const self of [true, false]) assert.equal(publicUser(q.userById.get(member.id), { self }).theme, "stage");
  assert.equal(stored(member.id).theme, "forest");
  patch(member, { bio: "Still here" });
  assert.equal(stored(member.id).theme, "forest", "unrelated edits retain dormant preferences");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(member.id);
  assert.equal(publicUser(q.userById.get(member.id), { self: true }).theme, "forest");
  db.prepare("UPDATE users SET role='fan' WHERE id=?").run(member.id);
  assert.equal(patch(q.userById.get(member.id), { theme: "daylight" }).user.theme, "daylight");
});
