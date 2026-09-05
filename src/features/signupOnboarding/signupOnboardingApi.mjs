export async function requestSignupOnboardingCompletion(
  { accountId, version },
  { apiCall } = {},
) {
  if (typeof apiCall !== "function") throw new TypeError("Signup onboarding transport is unavailable");
  if (typeof accountId !== "string" || !accountId.trim()) throw new TypeError("Signup onboarding requires an authenticated account");
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError("Signup onboarding version is invalid");

  const result = await apiCall("/api/me/onboarding/complete", {
    method: "POST",
    body: { version },
    context: "Finishing account setup",
    expectedAccountId: accountId,
  });
  if (result?.ok !== true
    || result?.user?.id !== accountId
    || !Number.isSafeInteger(result?.onboardingVersion)
    || result.onboardingVersion < version) {
    throw new TypeError("The signup onboarding response was invalid");
  }
  return result;
}
