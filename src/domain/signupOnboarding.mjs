export const SIGNUP_ONBOARDING_VERSION = 1;

// Only accounts explicitly created with an incomplete onboarding version enter
// this flow. A missing value belongs to an older account and is treated as
// complete, so shipping a new walkthrough never ambushes every existing member.
export function needsSignupOnboarding(session, currentVersion = SIGNUP_ONBOARDING_VERSION) {
  if (!session?.id || session.emailVerified !== true) return false;
  const version = session.onboardingVersion;
  return Number.isSafeInteger(version) && version >= 0 && version < currentVersion;
}
