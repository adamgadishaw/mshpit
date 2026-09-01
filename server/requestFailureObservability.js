// Strict readiness is a release gate, not a user request. When an external
// monitor polls it while optional video infrastructure is degraded, the 503 is
// useful to that monitor but must not masquerade as a new app crash on every
// poll. Actual upload/finalize failures remain fully observable.
export function shouldRecordGeneralRequestFailure({
  method = "",
  route = "",
  status = 0,
  code = "",
} = {}) {
  return !(
    String(method).toUpperCase() === "GET"
    && route === "/api/readiness"
    && Number(status) === 503
    && code === "MEDIA_STORAGE_UNAVAILABLE"
  );
}
