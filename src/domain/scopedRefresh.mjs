const normalizeScope = (value) => String(value ?? "").trim();

// One coordinator owns one visible pull-to-refresh boundary. Starting a new
// pull aborts the previous request; changing account/target scope aborts it and
// advances the generation so late work cannot clear the next screen's spinner.
export function createScopedRefreshCoordinator(initialScope = "") {
  let active = {
    scope: normalizeScope(initialScope),
    sequence: 0,
    controller: null,
  };

  const cancel = (nextScope = active.scope) => {
    active.controller?.abort();
    active = {
      scope: normalizeScope(nextScope),
      sequence: active.sequence + 1,
      controller: null,
    };
    return active.sequence;
  };

  const start = (scope) => {
    const normalizedScope = normalizeScope(scope);
    active.controller?.abort();
    const request = {
      scope: normalizedScope,
      sequence: active.sequence + 1,
      controller: new AbortController(),
    };
    active = request;
    return request;
  };

  const isCurrent = (request, scope = request?.scope) => !!request
    && active === request
    && active.scope === normalizeScope(scope)
    && !request.controller.signal.aborted;

  const settle = (request) => {
    if (!isCurrent(request)) return false;
    active = { scope: request.scope, sequence: request.sequence, controller: null };
    return true;
  };

  return Object.freeze({ cancel, isCurrent, settle, start });
}

export function refreshScope(accountId, surface, target = "") {
  const account = String(accountId || "guest").trim() || "guest";
  const name = String(surface || "surface").trim().toLowerCase() || "surface";
  const identity = String(target || "").trim().toLowerCase();
  return `${account}::refresh:${name}:${identity}`;
}
