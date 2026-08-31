import { normalizeClientCrashReport } from "../../../src/domain/clientCrashReport.mjs";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const CAUSES = Object.freeze({
  render: Object.freeze({
    web: "RenderError.Web",
    ios: "RenderError.Ios",
    android: "RenderError.Android",
    unknown: "RenderError.Unknown",
  }),
  runtime: Object.freeze({
    web: "RuntimeError.Web",
    ios: "RuntimeError.Ios",
    android: "RuntimeError.Android",
    unknown: "RuntimeError.Unknown",
  }),
  promise: Object.freeze({
    web: "PromiseError.Web",
    ios: "PromiseError.Ios",
    android: "PromiseError.Android",
    unknown: "PromiseError.Unknown",
  }),
});

export function clientErrorRoutes({
  ApiError,
  onRecorded = () => {},
  rateLimit,
  recordError,
}) {
  if (typeof ApiError !== "function" || typeof rateLimit !== "function" || typeof recordError !== "function") {
    throw new TypeError("Client error routes require complete boundary dependencies");
  }

  return Object.freeze({
    "POST /api/client-errors": (ctx) => {
      rateLimit(ctx, "client-errors-minute", 12, MINUTE_MS);
      rateLimit(ctx, "client-errors-daily", 60, DAY_MS);
      ctx.setHeader?.("Cache-Control", "no-store");

      const report = normalizeClientCrashReport(ctx.body);
      if (!report) {
        throw new ApiError(400, "That error report is invalid.", "VALIDATION_FAILED");
      }

      const fingerprint = recordError({
        level: report.kind === "promise" ? "error" : "fatal",
        code: report.code,
        status: 0,
        method: "POST",
        route: "/client/" + report.surface,
        cause: CAUSES[report.kind][report.platform],
        requestId: ctx.requestId,
      });
      if (fingerprint) {
        try { onRecorded(); } catch {} // architecture: allow-empty-catch -- alert scheduling is best effort and must never turn crash reporting into another crash
      }
      return { ok: true };
    },
  });
}
