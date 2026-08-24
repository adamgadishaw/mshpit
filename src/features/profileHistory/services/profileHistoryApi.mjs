import { api, AppError } from "../../../lib/api";
import { profileHistoryFromResponse, profileHistoryRequest } from "../profileHistoryRequest.mjs";

const CONTEXT = "Loading profile history";
const SOURCE = "profile-history";

export async function profileHistoryPageRequest({ accountId = null, targetId, before = null, signal } = {}) {
  let request;
  try {
    request = profileHistoryRequest({ accountId, targetId, before });
  } catch (error) {
    throw new AppError(undefined, { code: "PIT-REQ-001", context: CONTEXT, source: SOURCE, cause: error });
  }
  const payload = await api(request.path, {
    signal,
    silent: true,
    expectedAccountId: request.expectedAccountId,
    context: before ? "Loading earlier profile posts" : "Loading profile history",
  });
  try {
    return profileHistoryFromResponse(payload);
  } catch (error) {
    throw new AppError(undefined, { code: "PIT-API-001", context: CONTEXT, source: SOURCE, cause: error });
  }
}
