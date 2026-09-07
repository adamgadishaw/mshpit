import { api, AppError } from "../../../lib/api";
import { cleanHandle, isHandle } from "../../../domain/validation.mjs";

export async function readSignupHandleAvailability(value, { signal } = {}) {
  const handle = cleanHandle(value);
  if (!isHandle(handle)) throw new AppError("Use 3 to 20 letters, numbers, or underscores.", { code: "PIT-REQ-001", context: "Checking username" });
  return api(`/api/signup/handle-availability?handle=${encodeURIComponent(handle)}`, {
    signal, silent: true, cache: "no-store", context: "Checking username",
  });
}
