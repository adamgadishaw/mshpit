import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { suggestionRoutes } from "./suggestionRoutes.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE product_suggestions (
      id                 TEXT PRIMARY KEY,
      client_mutation_id TEXT NOT NULL UNIQUE,
      category           TEXT NOT NULL CHECK (category IN ('friction','idea','bug','other')),
      body               TEXT NOT NULL,
      surface            TEXT,
      status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','considering','planned','shipped','closed')),
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL,
      closed_at          INTEGER
    );
    CREATE INDEX idx_product_suggestions_status_created
      ON product_suggestions(status,created_at DESC,id DESC);
  `);
  return database;
}

function context(overrides = {}) {
  const headers = {};
  return {
    body: {},
    query: {},
    params: {},
    setHeader(name, value) { headers[name] = value; },
    headers,
    ...overrides,
  };
}

function fixture({
  at = 2_000_000_000_000,
  recordModerationAction,
} = {}) {
  const database = createDatabase();
  const calls = { admin: 0, user: 0, limits: [], audits: [] };
  let clock = at;
  let sequence = 0;
  const routes = suggestionRoutes({
    database,
    ApiError,
    assertSafeAuthoredText: () => {},
    createId: () => `sg_test_${String(++sequence).padStart(2, "0")}`,
    now: () => clock,
    rateLimit: (...args) => calls.limits.push(args),
    requireUser(ctx) {
      calls.user += 1;
      if (!ctx.user) throw new ApiError(401, "Sign in.", "AUTH_REQUIRED");
      if (ctx.user.blocked) throw new ApiError(403, "Restricted.", "FORBIDDEN");
      return ctx.user;
    },
    requireAdmin(ctx) {
      calls.admin += 1;
      if (ctx.user?.role !== "admin") throw new ApiError(403, "Admins only.", "FORBIDDEN");
      return ctx.user;
    },
    recordModerationAction: recordModerationAction || ((...args) => calls.audits.push(args)),
  });
  return {
    database,
    routes,
    calls,
    setNow(value) { clock = value; },
  };
}

const submission = (suffix = "123456789012", overrides = {}) => ({
  category: "idea",
  body: "Let fans pin a favorite live memory.",
  surface: "artist",
  clientMutationId: `sgc_test_${suffix}`,
  ...overrides,
});

test("guest submissions store only the anonymous canonical payload and enforce both rate windows", () => {
  const { database, routes, calls } = fixture();
  try {
    const ctx = context({
      ip: "203.0.113.8",
      ua: "private browser fingerprint",
      body: {
        ...submission(),
        userId: "u_must_not_persist",
        email: "private@example.com",
        url: "https://www.mshpit.com/search?q=private",
        searchText: "private artist",
      },
    });
    const response = routes["POST /api/suggestions"](ctx);

    assert.deepEqual(response, { id: "sg_test_01", duplicate: false });
    assert.equal(calls.user, 0, "guests do not need an account");
    assert.deepEqual(calls.limits.map((args) => args.slice(1)), [
      ["suggestions-hourly", 5, HOUR_MS],
      ["suggestions-daily", 12, DAY_MS],
    ]);
    assert.equal(ctx.headers["Cache-Control"], "no-store");

    const row = database.prepare("SELECT * FROM product_suggestions").get();
    assert.deepEqual({
      id: row.id,
      clientMutationId: row.client_mutation_id,
      category: row.category,
      body: row.body,
      surface: row.surface,
      status: row.status,
    }, {
      id: "sg_test_01",
      clientMutationId: submission().clientMutationId,
      category: "idea",
      body: submission().body,
      surface: "artist",
      status: "new",
    });
    const stored = JSON.stringify(row);
    for (const secret of ["u_must_not_persist", "private@example.com", "203.0.113.8", "fingerprint", "search?q", "private artist"]) {
      assert.equal(stored.includes(secret), false, `${secret} must not be stored`);
    }
  } finally {
    database.close();
  }
});

test("signed-in submissions remain anonymous but still pass account restrictions", () => {
  const { database, routes, calls } = fixture();
  try {
    routes["POST /api/suggestions"](context({
      user: { id: "u_member", role: "fan" },
      body: submission("signedin_123456"),
    }));
    assert.equal(calls.user, 1);
    assert.equal(JSON.stringify(database.prepare("SELECT * FROM product_suggestions").get()).includes("u_member"), false);

    assert.throws(
      () => routes["POST /api/suggestions"](context({
        user: { id: "u_blocked", role: "fan", blocked: true },
        body: submission("blocked_1234567"),
      })),
      (error) => error.status === 403 && error.code === "FORBIDDEN",
    );
    assert.equal(database.prepare("SELECT COUNT(*) count FROM product_suggestions").get().count, 1);
  } finally {
    database.close();
  }
});

test("submission validation and mutation-id mismatches fail without duplicating rows", () => {
  const { database, routes } = fixture();
  try {
    const post = routes["POST /api/suggestions"];
    assert.throws(
      () => post(context({ body: submission("invalid_123456", { body: "x" }) })),
      (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
    );

    const original = submission("replay_1234567");
    assert.deepEqual(post(context({ body: original })), { id: "sg_test_01", duplicate: false });
    assert.deepEqual(post(context({ body: { ...original } })), { id: "sg_test_01", duplicate: true });
    assert.throws(
      () => post(context({ body: { ...original, body: "A different payload under the same mutation id." } })),
      (error) => error.status === 409 && error.code === "IDEMPOTENCY_MISMATCH",
    );
    assert.equal(database.prepare("SELECT COUNT(*) count FROM product_suggestions").get().count, 1);
    assert.equal(database.prepare("SELECT body FROM product_suggestions").get().body, original.body);
  } finally {
    database.close();
  }
});

test("admin reads are no-store, filterable, bounded, and cursor paginated", () => {
  const { database, routes, calls, setNow } = fixture();
  try {
    const post = routes["POST /api/suggestions"];
    for (let index = 0; index < 5; index += 1) {
      setNow(2_000_000_000_000 + index);
      post(context({ body: submission(`page_${String(index).padStart(8, "0")}`, {
        category: index === 4 ? "bug" : "idea",
        body: `Suggestion number ${index}`,
      }) }));
    }

    const firstCtx = context({
      user: { id: "u_admin", role: "admin" },
      query: { category: "idea", limit: "2" },
    });
    const first = routes["GET /api/admin/suggestions"](firstCtx);
    assert.deepEqual(first.suggestions.map(({ body }) => body), ["Suggestion number 3", "Suggestion number 2"]);
    assert.equal(first.hasMore, true);
    assert.equal(typeof first.nextCursor, "string");
    assert.equal(firstCtx.headers["Cache-Control"], "no-store");
    assert.equal(Object.hasOwn(first.suggestions[0], "clientMutationId"), false);

    const second = routes["GET /api/admin/suggestions"](context({
      user: { id: "u_admin", role: "admin" },
      query: { category: "idea", limit: "2", before: first.nextCursor },
    }));
    assert.deepEqual(second.suggestions.map(({ body }) => body), ["Suggestion number 1", "Suggestion number 0"]);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);
    assert.equal(calls.admin, 2);

    assert.throws(
      () => routes["GET /api/admin/suggestions"](context({ user: { role: "fan" }, query: {} })),
      (error) => error.status === 403 && error.code === "FORBIDDEN",
    );
    assert.throws(
      () => routes["GET /api/admin/suggestions"](context({ user: { role: "admin" }, query: { before: "cursor_bad" } })),
      (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
    );
  } finally {
    database.close();
  }
});

test("admin status changes audit only categorical state and maintain terminal timestamps", () => {
  const { database, routes, calls, setNow } = fixture();
  try {
    const created = routes["POST /api/suggestions"](context({ body: submission("status_1234567") }));
    setNow(2_000_000_001_000);
    const admin = { id: "u_admin", role: "admin" };
    const patchCtx = context({ user: admin, params: { id: created.id }, body: { status: "shipped" } });
    const shipped = routes["PATCH /api/admin/suggestions/:id"](patchCtx);
    assert.equal(shipped.changed, true);
    assert.equal(shipped.suggestion.status, "shipped");
    assert.equal(shipped.suggestion.closedAt, 2_000_000_001_000);
    assert.equal(patchCtx.headers["Cache-Control"], "no-store");
    assert.equal(calls.audits.length, 1);
    assert.deepEqual(calls.audits[0].slice(1), [
      "suggestion_status",
      "product_suggestion",
      created.id,
      "",
      { status: "new" },
      { status: "shipped" },
    ]);
    assert.equal(JSON.stringify(calls.audits).includes(submission().body), false, "audit history must not retain suggestion text");

    const unchanged = routes["PATCH /api/admin/suggestions/:id"](context({
      user: admin,
      params: { id: created.id },
      body: { status: "shipped" },
    }));
    assert.equal(unchanged.changed, false);
    assert.equal(calls.audits.length, 1);

    setNow(2_000_000_002_000);
    const reopened = routes["PATCH /api/admin/suggestions/:id"](context({
      user: admin,
      params: { id: created.id },
      body: { status: "considering" },
    }));
    assert.equal(reopened.suggestion.closedAt, null);
    assert.equal(database.prepare("SELECT closed_at FROM product_suggestions WHERE id=?").get(created.id).closed_at, null);
  } finally {
    database.close();
  }
});

test("a failed moderation audit rolls the status update back", () => {
  const { database, routes } = fixture({
    recordModerationAction() { throw new Error("audit unavailable"); },
  });
  try {
    const created = routes["POST /api/suggestions"](context({ body: submission("rollback_12345") }));
    assert.throws(
      () => routes["PATCH /api/admin/suggestions/:id"](context({
        user: { id: "u_admin", role: "admin" },
        params: { id: created.id },
        body: { status: "planned" },
      })),
      /audit unavailable/,
    );
    assert.equal(database.prepare("SELECT status FROM product_suggestions WHERE id=?").get(created.id).status, "new");
  } finally {
    database.close();
  }
});

test("reads prune terminal suggestions after 90 days and unresolved suggestions after one year", () => {
  const now = 2_000_000_000_000;
  const { database, routes } = fixture({ at: now });
  const day = DAY_MS;
  const insert = database.prepare(`INSERT INTO product_suggestions
    (id,client_mutation_id,category,body,surface,status,created_at,updated_at,closed_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  try {
    insert.run("sg_old_closed", "sgc_retention_closed_old", "other", "Old closed", null, "closed", now - 100 * day, now - 91 * day, now - 90 * day - 1);
    insert.run("sg_old_shipped", "sgc_retention_shippedold", "idea", "Old shipped", null, "shipped", now - 100 * day, now - 91 * day, now - 90 * day - 1);
    insert.run("sg_old_open", "sgc_retention_open_old12", "bug", "Old unresolved", null, "new", now - 365 * day - 1, now - 365 * day - 1, null);
    insert.run("sg_keep_closed", "sgc_retention_closedkeep", "other", "Recent closed", null, "closed", now - 100 * day, now - 89 * day, now - 90 * day + 1,);
    insert.run("sg_keep_open", "sgc_retention_open_keep1", "idea", "Recent unresolved", null, "planned", now - 365 * day + 1, now - 365 * day + 1, null);

    const response = routes["GET /api/admin/suggestions"](context({
      user: { id: "u_admin", role: "admin" },
      query: { limit: "100" },
    }));
    assert.deepEqual(response.suggestions.map(({ id }) => id).sort(), ["sg_keep_closed", "sg_keep_open"]);
    assert.deepEqual(
      database.prepare("SELECT id FROM product_suggestions ORDER BY id").all().map(({ id }) => id),
      ["sg_keep_closed", "sg_keep_open"],
    );
  } finally {
    database.close();
  }
});
