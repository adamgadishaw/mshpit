const PIT_ERROR_CODE = /^PIT-[A-Z]+-\d{3}$/;

// Domain code deliberately checks the public AppError contract instead of
// importing the client adapter that constructs it. This keeps the shared
// result algebra platform-neutral while preventing raw Error/string failures
// from becoming a second command-result dialect.
export function isAppErrorLike(error) {
  return error instanceof Error
    && error.name === "AppError"
    && PIT_ERROR_CODE.test(error.code || "")
    && typeof error.retryable === "boolean";
}

export function commandSuccess(value) {
  return { ok: true, value };
}

export function commandFailure(error) {
  if (!isAppErrorLike(error)) {
    throw new TypeError("Command failures require an AppError");
  }
  return { ok: false, error };
}
