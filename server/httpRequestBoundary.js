// Node's HTTP server does not observe a Promise returned by an async request
// listener. Own that Promise explicitly so a rejected route can never become an
// unhandled rejection that takes down the process. The application handler is
// responsible for ordinary HTTP error responses; this final boundary is only a
// last-resort containment path and therefore closes an unfinished response.
export function createOwnedRequestListener(handler, { onRejected = () => {} } = {}) {
  if (typeof handler !== "function" || typeof onRejected !== "function") {
    throw new TypeError("Owned request listener requires handler and onRejected functions.");
  }

  return function ownedRequestListener(req, res) {
    void Promise.resolve()
      .then(() => handler(req, res))
      .catch((error) => {
        try { onRejected(error, req, res); }
        catch { /* diagnostics must never own the final request boundary */ }
        try {
          if (!res?.destroyed && !res?.writableEnded) res?.destroy?.();
        } catch { /* a broken/closing socket is already contained */ }
      });
  };
}
