import { api } from "../../lib/api";
import { requestSignupOnboardingCompletion } from "./signupOnboardingApi.mjs";

export const completeSignupOnboardingForAccount = (accountId, version, { signal } = {}) =>
  requestSignupOnboardingCompletion({ accountId, version, signal }, { apiCall: api });
