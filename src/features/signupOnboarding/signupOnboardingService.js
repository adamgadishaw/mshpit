import { api } from "../../lib/api";
import { requestSignupOnboardingCompletion } from "./signupOnboardingApi.mjs";

export const completeSignupOnboardingForAccount = (accountId, version) =>
  requestSignupOnboardingCompletion({ accountId, version }, { apiCall: api });
