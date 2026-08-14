import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmEmailWithReconciliation,
  matchingEmailVerifiedSessionUser,
  shouldReconcileEmailVerificationFailure,
  verificationResendState,
} from "./emailVerification.mjs";

const verifiedUser = (id = "u_owner") => ({ id, email: `${id}@example.com`, emailVerified: true, verified: false });

test("private verification users match only the exact active email-confirmed account", () => {
  assert.equal(matchingEmailVerifiedSessionUser(verifiedUser(), "u_owner")?.id, "u_owner");
  assert.equal(matchingEmailVerifiedSessionUser(verifiedUser("u_other"), "u_owner"), null);
  assert.equal(matchingEmailVerifiedSessionUser({ id: "u_owner", emailVerified: false }, "u_owner"), null);
  assert.equal(matchingEmailVerifiedSessionUser(verifiedUser(), null), null);
});

test("a normal confirmation adopts only the matching response user", async () => {
  let current = "u_owner";
  const result = await confirmEmailWithReconciliation({
    token: "token",
    accountIdAtStart: current,
    getCurrentAccountId: () => current,
    requestConfirmation: async () => ({ verified: true, user: verifiedUser() }),
    readCurrentSession: async () => { throw new Error("should not read"); },
  });
  assert.equal(result.verified, true);
  assert.equal(result.user.id, "u_owner");
  assert.equal(result.reconciled, false);

  current = "u_other";
  const mismatched = await confirmEmailWithReconciliation({
    token: "token",
    accountIdAtStart: current,
    getCurrentAccountId: () => current,
    requestConfirmation: async () => ({ verified: true, user: verifiedUser("u_owner") }),
    readCurrentSession: async () => { throw new Error("should not read"); },
  });
  assert.equal(mismatched.verified, true);
  assert.equal(mismatched.user, null);

  const contradictory = await confirmEmailWithReconciliation({
    token: "token",
    accountIdAtStart: current,
    getCurrentAccountId: () => current,
    requestConfirmation: async () => ({ verified: false, user: verifiedUser("u_other") }),
    readCurrentSession: async () => { throw new Error("should not read"); },
  });
  assert.equal(contradictory.verified, false);
  assert.equal(contradictory.user, null);
});

test("an ambiguous confirmation reconciles only a still-matching verified session", async () => {
  const ambiguous = Object.assign(new Error("response lost"), { status: 0 });
  let reads = 0;
  const result = await confirmEmailWithReconciliation({
    token: "token",
    accountIdAtStart: "u_owner",
    emailVerifiedAtStart: false,
    getCurrentAccountId: () => "u_owner",
    requestConfirmation: async () => { throw ambiguous; },
    readCurrentSession: async (expected) => {
      reads += 1;
      assert.equal(expected, "u_owner");
      return { user: verifiedUser() };
    },
  });
  assert.equal(result.verified, true);
  assert.equal(result.reconciled, true);
  assert.equal(result.user.id, "u_owner");
  assert.equal(reads, 1);

  await assert.rejects(
    confirmEmailWithReconciliation({
      token: "token",
      accountIdAtStart: "u_owner",
      emailVerifiedAtStart: false,
      getCurrentAccountId: () => "u_other",
      requestConfirmation: async () => { throw ambiguous; },
      readCurrentSession: async () => ({ user: verifiedUser("u_other") }),
    }),
    (error) => error === ambiguous,
  );
});

test("guest starts and already-confirmed starts cannot use an unrelated /api/me as commit proof", async () => {
  const ambiguous = Object.assign(new Error("response lost"), { status: 0 });
  let reads = 0;
  await assert.rejects(
    confirmEmailWithReconciliation({
      token: "guest-token",
      accountIdAtStart: null,
      emailVerifiedAtStart: undefined,
      getCurrentAccountId: () => "u_newly_active",
      requestConfirmation: async () => { throw ambiguous; },
      readCurrentSession: async () => {
        reads += 1;
        return { user: verifiedUser("u_newly_active") };
      },
    }),
    (error) => error === ambiguous,
  );
  assert.equal(reads, 0, "a guest-start request must rely on token replay, not a later signed-in account");

  await assert.rejects(
    confirmEmailWithReconciliation({
      token: "different-token",
      accountIdAtStart: "u_owner",
      emailVerifiedAtStart: true,
      getCurrentAccountId: () => "u_owner",
      requestConfirmation: async () => { throw ambiguous; },
      readCurrentSession: async () => {
        reads += 1;
        return { user: verifiedUser("u_owner") };
      },
    }),
    (error) => error === ambiguous,
  );
  assert.equal(reads, 0, "an account already confirmed before the POST is not evidence about that token");
});

test("explicit failures, identity changes, and cancellation are never reconciled", async () => {
  assert.equal(shouldReconcileEmailVerificationFailure({ status: 400 }), false);
  assert.equal(shouldReconcileEmailVerificationFailure({ status: 409 }), false);
  assert.equal(shouldReconcileEmailVerificationFailure({ status: 503 }), true);
  assert.equal(shouldReconcileEmailVerificationFailure({ status: 200, code: "PIT-API-001" }), true);
  assert.equal(shouldReconcileEmailVerificationFailure({ status: 200, code: "PIT-NET-001" }), true);
  assert.equal(shouldReconcileEmailVerificationFailure({ status: 0 }, { aborted: true }), false);

  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  const aborted = Object.assign(new Error("aborted"), { status: 0 });
  await assert.rejects(
    confirmEmailWithReconciliation({
      token: "token",
      accountIdAtStart: "u_owner",
      signal: controller.signal,
      requestConfirmation: async () => { throw aborted; },
      readCurrentSession: async () => { reads += 1; },
    }),
    (error) => error === aborted,
  );
  assert.equal(reads, 0);
});

test("resend UI distinguishes delivery, stale-session healing, and failures", () => {
  assert.equal(verificationResendState({ verified: true, sent: false, reason: "already-verified" }), "confirmed");
  assert.equal(verificationResendState({ sent: true }), "sent");
  assert.equal(verificationResendState({ sent: false, reason: "recently-sent" }), "recent");
  assert.equal(verificationResendState({ sent: false, reason: "verification-disabled" }), "unavailable");
});
