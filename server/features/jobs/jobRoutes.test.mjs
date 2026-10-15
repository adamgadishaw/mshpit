import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createJobRepository, ensureJobSchema } from "./jobRepository.js";
import { jobRoutes } from "./jobRoutes.js";
import { jobPublicPage } from "./jobPublicPage.js";
import { renderPublicPage } from "../../publicPages.js";
import { renderPublicDocumentMain } from "../seo/publicDocumentRenderer.js";
class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const draft = { title: "Test opening", location: "Test location", arrangement: "Remote", description: "Fixture description only.", application: "jobs@example.test" };
function fixture(t) {
  const database = new DatabaseSync(":memory:"); ensureJobSchema(database); t.after(() => database.close());
  const routes = jobRoutes({ database, ApiError, assertSafeAuthoredText: () => {}, now: () => 1000, rateLimit: () => {}, requireAdmin: ctx => {
    if (!ctx.user) throw new ApiError(401, "Sign in", "AUTH_REQUIRED");
    if (ctx.user.role !== "admin") throw new ApiError(403, "Admins only", "FORBIDDEN");
    return ctx.user;
  } });
  const ctx = (body = {}, role = "admin", id = "job_fixture_123") => ({ body, user: role ? { id: "account_fixture", role } : null, params: { id }, query: {}, setHeader() {} });
  const create = () => routes["POST /api/admin/jobs"](ctx({ id: "job_fixture_123", draft })).job;
  const update = (job, action, next = draft) => routes["POST /api/admin/jobs/:id"](ctx({ revision: job.revision, action, draft: next })).job;
  return { database, routes, ctx, create, update, repository: createJobRepository(database) };
}
test("guest, fan, artist, moderator and editor cannot read or mutate admin jobs", t => {
  const f = fixture(t);
  for (const role of [null, "fan", "artist", "moderator", "editor"]) {
    for (const route of ["GET /api/admin/jobs", "POST /api/admin/jobs", "POST /api/admin/jobs/:id"]) assert.throws(() => f.routes[route](f.ctx({ id: "job_fixture_123", draft }, role)), error => error.status === (role ? 403 : 401));
  }
  assert.equal(f.repository.list().jobs.length, 0);
});
test("drafts remain private; publishing atomically exposes only approved fields", t => {
  const f = fixture(t); let job = f.create();
  assert.deepEqual(f.routes["GET /api/jobs"](f.ctx({}, null)).jobs, []);
  assert.throws(() => f.routes["GET /api/jobs/:id"](f.ctx({}, null)), error => error.status === 404);
  job = f.update(job, "publish");
  assert.deepEqual(f.routes["GET /api/jobs/:id"](f.ctx({}, null)).job, { id: job.id, ...draft });
  job = f.update(job, "save", { ...draft, title: "Private pending edit" });
  assert.equal(f.repository.publicRead(job.id).title, draft.title);
  const html = renderPublicPage(`/jobs/${job.id}`, { NODE_ENV: "production", PUBLIC_ORIGIN: "https://www.mshpit.com" }, jobPublicPage(f.repository, `/jobs/${job.id}`));
  assert.ok(html.includes("mailto:jobs@example.test")); assert.ok(!html.includes("Private pending edit"));
  assert.ok(!html.includes("updated_by"));
  job = f.update(job, "publish", job.draft);
  assert.equal(f.repository.publicRead(job.id).title, "Private pending edit");
});
test("close removes public access, explicit publish reopens, archive retains a read-only record", t => {
  const f = fixture(t); let job = f.update(f.create(), "publish");
  job = f.update(job, "close");
  assert.equal(f.repository.publicRead(job.id), null);
  assert.equal(jobPublicPage(f.repository, `/jobs/${job.id}`).status, 404);
  job = f.update(job, "publish"); assert.equal(f.repository.publicList().jobs.length, 1);
  job = f.update(job, "close"); job = f.update(job, "archive");
  assert.equal(f.repository.list().jobs[0].state, "archived");
  for (const action of ["save", "publish", "close", "archive"]) assert.throws(() => f.update(job, action), error => error.status === 409);
});
test("stale updates cannot overwrite another admin's changes", t => {
  const f = fixture(t); const job = f.create();
  f.update(job, "save", { ...draft, title: "Updated by another admin" });
  assert.throws(() => f.update(job, "publish"), error => error.status === 409);
  assert.equal(f.repository.read(job.id).draft.title, "Updated by another admin");
});
test("creation retry does not duplicate jobs, and mismatched retry fails", t => {
  const f = fixture(t); f.create(); f.create();
  assert.equal(f.repository.list().jobs.length, 1);
  assert.throws(() => f.routes["POST /api/admin/jobs"](f.ctx({ id: "job_fixture_123", draft: { ...draft, title: "Different" } })), error => error.status === 409);
});
test("incomplete drafts save but unsafe application links cannot publish", t => {
  const f = fixture(t); let job = f.create();
  for (const application of ["javascript:alert(1)", "http://example.test", "https://user:password@example.test", "bad\r\n@example.test", ""]) assert.throws(() => f.update(job, "publish", { ...draft, application }), error => error.status === 400);
  job = f.update(job, "save", { ...draft, title: "" });
  assert.throws(() => f.update(job, "publish", job.draft), error => error.status === 400);
  assert.throws(() => f.update(job, "save", { ...draft, description: "x".repeat(12001) }), error => error.status === 400);
});
test("public HTML escapes authored content and empty list invents no positions", t => {
  const f = fixture(t);
  assert.ok(jobPublicPage(f.repository, "/jobs").sections[0].paragraphs[0].includes("no published openings"));
  let job = f.create(); job = f.update(job, "publish", { ...draft, title: '<script>alert("fixture")</script>' });
  const html = renderPublicPage("/jobs", {}, jobPublicPage(f.repository, "/jobs"));
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes('<script>alert("fixture")'));
  assert.equal(jobPublicPage(f.repository, "/jobs", { cursor: "invalid?" }).status, 400);
});
test("job reads are bounded and pagination cannot expose drafts", t => {
  const f = fixture(t);
  for (let i=0; i<102; i++) {
    const id = `job_fixture_${String(i).padStart(4,"0")}`;
    let job = f.routes["POST /api/admin/jobs"](f.ctx({ id, draft }, "admin", id)).job;
    f.routes["POST /api/admin/jobs/:id"](f.ctx({ revision: job.revision, action: "publish", draft }, "admin", id));
  }
  f.create();
  const page = f.repository.publicList(); assert.equal(page.jobs.length, 100); assert.ok(page.cursor);
  const next = f.repository.publicList(page.cursor); assert.equal(next.jobs.length, 2); assert.equal(next.cursor, null);
});
test("contact covers appeals and advertising through the existing address, and every full SSR news story links to it", () => {
  const contact = renderPublicPage("/contact");
  for (const text of ["Appeals", "General enquiries", "Advertising enquiries", "family-friendly", "manual review", "support@mshpit.com", 'href="/jobs"']) assert.ok(contact.includes(text));
  const html = renderPublicDocumentMain({ kind: "post", comments: [], post: { comments: 0 }, news: { headline: "Fixture article", body: "Fixture body", artists: [], sources: [], category: "tour", publishedAt: 1000 } });
  assert.match(html, /<footer><a href="\/contact">Contact us<\/a><\/footer>/);
  assert.ok(html.indexOf("Fixture body") < html.indexOf("Contact us"));
});
