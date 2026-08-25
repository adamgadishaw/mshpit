import assert from "node:assert/strict";
import test from "node:test";

const { parseMailFrom, mailConfigured, mailDiagnostics, mailFailureLabel, sendEmail } = await import("./mailer.js");

// Each test owns the mail env vars outright so ordering can't leak between them.
function withEnv(key, from, fn) {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.MAIL_FROM;
  const prevReplyTo = process.env.MAIL_REPLY_TO;
  if (key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = key;
  if (from === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = from;
  delete process.env.MAIL_REPLY_TO;
  try { fn(); } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = prevFrom;
    if (prevReplyTo === undefined) delete process.env.MAIL_REPLY_TO; else process.env.MAIL_REPLY_TO = prevReplyTo;
  }
}

test("parseMailFrom accepts both the bare and display-name sender forms", () => {
  assert.deepEqual(parseMailFrom("noreply@mail.mshpit.com"), {
    ok: true, reason: null, address: "noreply@mail.mshpit.com", domain: "mail.mshpit.com",
  });
  const display = parseMailFrom("Pit <noreply@mail.mshpit.com>");
  assert.equal(display.ok, true);
  assert.equal(display.address, "noreply@mail.mshpit.com");
  assert.equal(display.domain, "mail.mshpit.com");
});

test("parseMailFrom normalizes surrounding whitespace and domain casing", () => {
  const parsed = parseMailFrom("  Pit  <NoReply@Mail.MSHPIT.com>  ");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.domain, "mail.mshpit.com");
});

test("parseMailFrom rejects the values Resend would answer with an opaque 403", () => {
  // A bare display name with no address is the mistake that looks configured.
  for (const bad of ["", "   ", "Pit", "Pit <>", "noreply", "noreply@", "@mail.mshpit.com", "noreply@localhost", "a b@mail.mshpit.com", "Pit <noreply@mail.mshpit.com"]) {
    assert.equal(parseMailFrom(bad).ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  assert.equal(parseMailFrom("").reason, "missing");
  assert.equal(parseMailFrom("Pit").reason, "invalid");
});

test("mailConfigured requires a key and a parseable sender, not just presence", () => {
  withEnv("re_test_key", "Pit <noreply@mail.mshpit.com>", () => assert.equal(mailConfigured(), true));
  withEnv(undefined, "Pit <noreply@mail.mshpit.com>", () => assert.equal(mailConfigured(), false));
  withEnv("re_test_key", undefined, () => assert.equal(mailConfigured(), false));
  // Present but unusable must not count as configured.
  withEnv("re_test_key", "Pit", () => assert.equal(mailConfigured(), false));
});

test("mailDiagnostics names which half of the setup is missing", () => {
  withEnv(undefined, undefined, () => {
    const d = mailDiagnostics();
    assert.equal(d.configured, false);
    assert.equal(d.reason, "missing-api-key-and-from");
  });
  withEnv("re_test_key", undefined, () => assert.equal(mailDiagnostics().reason, "missing-from"));
  withEnv(undefined, "Pit <noreply@mail.mshpit.com>", () => assert.equal(mailDiagnostics().reason, "missing-api-key"));
  withEnv("re_test_key", "Pit", () => {
    const d = mailDiagnostics();
    assert.equal(d.reason, "invalid-from");
    assert.equal(d.fromPresent, true, "the value is set, it just cannot be parsed");
    assert.equal(d.fromValid, false);
  });
  withEnv("re_test_key", "Pit <noreply@mail.mshpit.com>", () => {
    const d = mailDiagnostics();
    assert.equal(d.configured, true);
    assert.equal(d.reason, null);
    assert.equal(d.fromDomain, "mail.mshpit.com");
  });
});

test("mailDiagnostics never echoes the API key or the raw sender value", () => {
  withEnv("re_super_secret_key", "Mshpit <noreply@mail.mshpit.com>", () => {
    process.env.MAIL_REPLY_TO = "Mshpit Support <private-inbox@mshpit.com>";
    const serialized = JSON.stringify(mailDiagnostics());
    assert.ok(!serialized.includes("re_super_secret_key"));
    assert.ok(!serialized.includes("noreply@"));
    assert.ok(!serialized.includes("private-inbox@"));
    assert.equal(mailDiagnostics().replyToDomain, "mshpit.com");
  });
});

test("sendEmail routes replies only to a validated Workspace mailbox", async () => {
  const previous = {
    key: process.env.RESEND_API_KEY,
    from: process.env.MAIL_FROM,
    replyTo: process.env.MAIL_REPLY_TO,
    fetch: globalThis.fetch,
  };
  let payload = null;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "Mshpit <noreply@mail.mshpit.com>";
  process.env.MAIL_REPLY_TO = "Mshpit Support <support@mshpit.com>";
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };
  try {
    const sent = await sendEmail({ to: "member@example.com", subject: "Test", html: "<p>Test</p>", text: "Test" });
    assert.equal(sent.sent, true);
    assert.equal(payload.reply_to, "Mshpit Support <support@mshpit.com>");

    process.env.MAIL_REPLY_TO = "not an address";
    await sendEmail({ to: "member@example.com", subject: "Test", html: "<p>Test</p>", text: "Test" });
    assert.equal(Object.hasOwn(payload, "reply_to"), false, "an invalid optional inbox must never reach Resend");
    assert.equal(mailDiagnostics().warning, "invalid-reply-to");
  } finally {
    if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = previous.from;
    if (previous.replyTo === undefined) delete process.env.MAIL_REPLY_TO; else process.env.MAIL_REPLY_TO = previous.replyTo;
    globalThis.fetch = previous.fetch;
  }
});

test("mail failure labels cannot copy provider messages, addresses, or tokens into logs", () => {
  const secret = "recipient@example.test reset=highly-sensitive-token";
  const label = mailFailureLabel({
    name: "FetchError",
    code: "ETIMEDOUT",
    message: secret,
  });
  assert.equal(label, "FetchError/ETIMEDOUT");
  assert.doesNotMatch(label, /recipient|sensitive|@/i);
  assert.equal(mailFailureLabel({ name: "bad name\nforged", code: "E BAD" }), "badnameforged/EBAD");
});
