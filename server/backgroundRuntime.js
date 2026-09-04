function reportFailure(report, error) {
  if (typeof report !== "function") return;
  try {
    const pending = report(error);
    if (pending && typeof pending.then === "function") {
      // A diagnostic sink is never allowed to become a second unhandled
      // rejection while the original optional-runtime failure is contained.
      void Promise.resolve(pending).catch(() => {
        /* architecture: allow-empty-catch -- the optional-runtime boundary deliberately contains diagnostic sink rejection */
      });
    }
  } catch {
    // Reporting is best-effort at this boundary. The caller receives the
    // contained runtime result regardless of whether diagnostics are healthy.
  }
}

/**
 * Own the one-time HTTP listen boundary so bind failures reject the startup
 * promise instead of becoming an unhandled EventEmitter error. Runtime server
 * errors after the listening event retain Node's normal fail-fast behavior.
 */
export function listenForServer(server, ...listenArgs) {
  return new Promise((resolve, reject) => {
    if (
      !server
      || typeof server.listen !== "function"
      || typeof server.once !== "function"
      || typeof server.off !== "function"
    ) {
      reject(new TypeError("HTTP server requires listen, once, and off methods"));
      return;
    }

    let settled = false;
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onError = (error) => settle(reject, error);
    const onListening = () => settle(resolve, server);

    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(...listenArgs);
    } catch (error) {
      settle(reject, error);
    }
  });
}

/**
 * Start one optional background runtime without letting its initialization
 * take down request serving. Synchronous starters keep their synchronous return
 * value; asynchronous starters return a promise that resolves to the runtime or
 * null. Either failure shape is reported once and contained.
 */
export function startOptionalBackgroundRuntime({
  start,
  report = () => {},
} = {}) {
  if (typeof start !== "function") {
    reportFailure(report, new TypeError("Optional background runtime requires a starter"));
    return null;
  }

  try {
    const runtime = start();
    if (runtime && typeof runtime.then === "function") {
      return Promise.resolve(runtime).catch((error) => {
        reportFailure(report, error);
        return null;
      });
    }
    return runtime ?? null;
  } catch (error) {
    reportFailure(report, error);
    return null;
  }
}
