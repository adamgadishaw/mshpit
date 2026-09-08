export const SIGNUP_ONBOARDING_VERSION = 1;

// Offer optional setup only to explicitly unfinished accounts. This is not an
// access gate: browsing never requires completing the walkthrough. A missing
// version belongs to an older account and is treated as complete.
export function needsSignupOnboarding(session, currentVersion = SIGNUP_ONBOARDING_VERSION) {
  if (!session?.id) return false;
  const version = session.onboardingVersion;
  return Number.isSafeInteger(version) && version >= 0 && version < currentVersion;
}
