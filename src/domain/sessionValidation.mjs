export const SESSION_VALIDATION_FRESHNESS_MS = 60_000;
export const SESSION_RESUME_MIN_BACKGROUND_MS = 15_000;

const accountIdOf = (value) => {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

export function sessionValidationOutcome({ confirmed, accountId, user, error } = {}) {
  const departingAccountId = accountIdOf(accountId);
  if (error) {
    return error?.status === 401
      ? { kind: "authoritative-guest", departingAccountId }
      : { kind: "transient-failure", preserveConfirmedUi: !!confirmed };
  }
  if (!user) return {
    kind: confirmed ? "authoritative-guest" : "initial-guest",
    departingAccountId,
  };

  const arrivingAccountId = accountIdOf(user.id);
  if (!arrivingAccountId) {
    return { kind: "invalid-response", preserveConfirmedUi: !!confirmed };
  }
  if (!confirmed) return { kind: "initial-account", arrivingAccountId };
  if (departingAccountId && departingAccountId === arrivingAccountId) {
    return { kind: "same-account", arrivingAccountId };
  }
  return { kind: "account-changed", departingAccountId, arrivingAccountId };
}

// One coordinator owns every foreground/visibility request. AppState and browser
// visibility events often arrive together, so exposing one shared promise keeps
// both paths on a single /api/me request. A strict cross-tab signal supersedes
// any older-cookie request, locks immediately, then queues one fresh strict read.
export function createSessionValidationCoordinator({
  run,
  now = Date.now,
  freshnessMs = SESSION_VALIDATION_FRESHNESS_MS,
  minimumBackgroundMs = SESSION_RESUME_MIN_BACKGROUND_MS,
  onStrictRequest = () => {},
} = {}) {
  if (typeof run !== "function") throw new TypeError("run must be a function");

  let backgroundedAt = null;
  let lastAuthoritativeAt = null;
  let inFlight = null;
  let flightContext = null;
  let strictRevision = 0;

  const startFlight = ({ strict, reason }) => {
    const revisionAtStart = strictRevision;
    const context = {
      reason,
      strictRequested: !!strict,
      strictRevision: revisionAtStart,
      isStrict: () => !!strict || strictRevision > revisionAtStart,
      isSuperseded: () => strictRevision > revisionAtStart,
    };
    flightContext = context;

    const request = Promise.resolve()
      // A newer auth epoch can arrive before the queued microtask even starts.
      // Skip that stale request entirely and move straight to the fresh strict one.
      .then(() => context.isSuperseded()
        ? { authoritative: false, superseded: true }
        : run(context))
      .then((result) => {
        if (context.isSuperseded()) {
          return startFlight({ strict: true, reason: "auth-epoch-followup" });
        }
        if (result?.authoritative) lastAuthoritativeAt = now();
        return { kind: "completed", result };
      })
      .finally(() => {
        if (inFlight === request) {
          inFlight = null;
          flightContext = null;
        }
      });
    inFlight = request;
    return request;
  };

  const validate = ({ force = false, strict = false, reason = "manual" } = {}) => {
    if (strict) {
      strictRevision += 1;
      onStrictRequest({ reason });
    }
    if (inFlight) return inFlight;

    const checkedAt = now();
    if (!force && lastAuthoritativeAt != null
      && checkedAt - lastAuthoritativeAt < freshnessMs) {
      return Promise.resolve({ kind: "skipped", reason: "fresh" });
    }
    return startFlight({ strict, reason });
  };

  const background = (at = now()) => {
    if (backgroundedAt == null) backgroundedAt = at;
  };

  const resume = (at = now()) => {
    if (backgroundedAt == null) {
      return Promise.resolve({ kind: "skipped", reason: "not-backgrounded" });
    }
    const hiddenForMs = Math.max(0, at - backgroundedAt);
    backgroundedAt = null;
    if (hiddenForMs < minimumBackgroundMs) {
      return Promise.resolve({ kind: "skipped", reason: "brief-background", hiddenForMs });
    }
    return validate({ reason: "resume" });
  };

  return {
    background,
    resume,
    validate,
    markAuthoritative(at = now()) { lastAuthoritativeAt = at; },
    snapshot() {
      return {
        backgroundedAt,
        lastAuthoritativeAt,
        inFlight: !!inFlight,
        strict: !!flightContext?.isStrict(),
      };
    },
  };
}
