import { SIGNUP_ONBOARDING_VERSION } from "../../../src/domain/signupOnboarding.mjs";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const COMPLETIONS_PER_WINDOW = 20;

export function accountOnboardingRoutes({
  ApiError,
  database,
  getUser,
  projectSelf,
  rateLimit,
  requireUser,
}) {
  if (typeof ApiError !== "function" || !database?.prepare
    || typeof getUser !== "function" || typeof projectSelf !== "function"
    || typeof rateLimit !== "function" || typeof requireUser !== "function") {
    throw new TypeError("Account onboarding routes require complete boundary dependencies");
  }
  const completeOnboarding = database.prepare(`UPDATE users SET onboarding_version=?
    WHERE id=? AND onboarding_version IS NOT NULL AND onboarding_version < ?`);

  return Object.freeze({
    // Completion is trusted workflow state, not user-authored profile metadata.
    // Keeping it out of PATCH /api/me prevents a general extras write from
    // spoofing progress. The conditional update also makes retries write-free.
    "POST /api/me/onboarding/complete": (ctx) => {
      const user = requireUser(ctx);
      rateLimit(ctx, "onboarding-complete", COMPLETIONS_PER_WINDOW, TEN_MINUTES_MS);
      ctx.setHeader?.("Cache-Control", "no-store");
      if (!user.email_verified_at) {
        throw new ApiError(403, "Confirm your email before finishing account setup.", "EMAIL_VERIFICATION_REQUIRED");
      }

      const version = ctx.body?.version;
      if (!Number.isSafeInteger(version) || version < 1 || version > SIGNUP_ONBOARDING_VERSION) {
        throw new ApiError(
          400,
          `Complete onboarding version ${SIGNUP_ONBOARDING_VERSION}.`,
          "VALIDATION_FAILED",
        );
      }

      completeOnboarding.run(version, user.id, version);
      const updated = getUser(user.id);
      return {
        ok: true,
        onboardingVersion: updated.onboarding_version == null ? null : Number(updated.onboarding_version),
        user: projectSelf(updated),
      };
    },
  });
}
