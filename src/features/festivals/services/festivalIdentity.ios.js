import { captureApiIdentityCheck } from "../../../lib/api";

// Reuse the API identity owner without adding a request or changing its state.
export const captureFestivalIdentity = accountId => captureApiIdentityCheck(accountId);
