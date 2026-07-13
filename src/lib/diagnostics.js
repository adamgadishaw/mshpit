import { load, save, setPersistErrorHandler } from "./persist";
import { catalogEntry, catalogueCode, safeRouteTemplate } from "./errorCatalog.mjs";

const HISTORY_KEY = "pit.diagnostics.v1";
const HISTORY_LIMIT = 75;
const listeners = new Set();
const feedbackListeners = new Set();
const recentFeedback = new Map();

const initial = load(HISTORY_KEY, []);
let history = Array.isArray(initial)
  ? initial.filter((item) => item && typeof item === "object" && /^PIT-[A-Z]+-\d{3}$/.test(item.code || "")).slice(0, HISTORY_LIMIT)
  : [];

const cleanText = (value, max = 120) => String(value || "")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

const newId = () => `pit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function safeMeta(meta = {}) {
  const output = {};
  if (meta.method) output.method = cleanText(meta.method, 8).toUpperCase();
  if (meta.route || meta.path) output.route = safeRouteTemplate(meta.route || meta.path);
  if (Number.isFinite(Number(meta.status))) output.status = Number(meta.status);
  if (meta.requestId) output.requestId = cleanText(meta.requestId, 80);
  if (meta.serverCode) output.serverCode = cleanText(meta.serverCode, 60);
  return output;
}

export class AppError extends Error {
  constructor(message, {
    code,
    serverCode,
    status = 0,
    requestId,
    retryable,
    category,
    severity,
    context,
    source,
    kind,
    cause,
  } = {}) {
    const stableCode = catalogueCode({ code, serverCode, status, kind });
    const catalog = catalogEntry(stableCode);
    super(cleanText(message, 240) || catalog.message, cause ? { cause } : undefined);
    this.name = "AppError";
    this.code = stableCode;
    this.serverCode = serverCode ? cleanText(serverCode, 60) : undefined;
    this.status = Number(status) || 0;
    this.requestId = requestId ? cleanText(requestId, 80) : newId();
    this.retryable = typeof retryable === "boolean" ? retryable : catalog.retryable;
    this.category = category || catalog.category;
    this.severity = severity || catalog.severity;
    this.userTitle = catalog.title;
    this.userMessage = catalog.message;
    this.failurePoint = catalog.failurePoint;
    this.guidance = catalog.guidance;
    this.context = cleanText(context, 100) || undefined;
    this.source = cleanText(source, 60) || "client";
  }
}

export function toAppError(error, options = {}) {
  if (error instanceof AppError) {
    if (options.context && !error.context) error.context = cleanText(options.context, 100);
    if (options.source && (!error.source || error.source === "client")) error.source = cleanText(options.source, 60);
    return error;
  }
  const kind = options.kind || (error?.name === "AbortError" ? "abort" : undefined);
  return new AppError(options.message || error?.message, {
    ...options,
    kind,
    cause: error,
  });
}

function notifyHistory() {
  const snapshot = getDiagnostics();
  listeners.forEach((listener) => {
    try { listener(snapshot); } catch {}
  });
}

function notifyFeedback(entry) {
  const key = `${entry.code}:${entry.meta?.route || entry.source}`;
  const now = Date.now();
  if (now - (recentFeedback.get(key) || 0) < 8000) return;
  recentFeedback.set(key, now);
  feedbackListeners.forEach((listener) => {
    try { listener(entry); } catch {}
  });
}

// Shared entry point for API, media, storage, and render failures. `context` and
// metadata must describe the operation, never user content, credentials, URLs
// containing query values, request bodies, or raw stacks.
export function captureAppError(error, {
  code,
  serverCode,
  status,
  requestId,
  retryable,
  category,
  severity,
  context,
  source = "client",
  kind,
  meta,
  toast = false,
  force = false,
} = {}) {
  const appError = toAppError(error, {
    code, serverCode, status, requestId, retryable, category, severity, context, source, kind,
  });
  if (appError.diagnosticId && !force) return appError;

  const catalog = catalogEntry(appError.code);
  const entry = Object.freeze({
    id: newId(),
    occurredAt: new Date().toISOString(),
    code: appError.code,
    category: appError.category || catalog.category,
    severity: appError.severity || catalog.severity,
    title: appError.userTitle || catalog.title,
    message: appError.userMessage || catalog.message,
    failurePoint: appError.failurePoint || catalog.failurePoint,
    guidance: appError.guidance || catalog.guidance,
    retryable: appError.retryable,
    context: cleanText(context || appError.context, 100) || undefined,
    source: cleanText(source || appError.source, 60) || "client",
    meta: safeMeta({
      ...meta,
      status: meta?.status ?? appError.status,
      requestId: meta?.requestId || appError.requestId,
      serverCode: meta?.serverCode || appError.serverCode,
    }),
  });

  appError.diagnosticId = entry.id;
  history = [entry, ...history].slice(0, HISTORY_LIMIT);
  save(HISTORY_KEY, history);
  notifyHistory();
  if (toast) notifyFeedback(entry);
  return appError;
}

export function getDiagnostics() {
  return history.slice();
}

export function clearDiagnostics() {
  history = [];
  save(HISTORY_KEY, history);
  notifyHistory();
}

export function subscribeDiagnostics(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeFeedback(listener) {
  feedbackListeners.add(listener);
  return () => feedbackListeners.delete(listener);
}

setPersistErrorHandler((error, { operation, key } = {}) => {
  // If diagnostics itself cannot be stored, do not recursively try to diagnose
  // that same write. In-memory history remains available for the current run.
  if (key === HISTORY_KEY) return;
  captureAppError(error, {
    code: "PIT-STORE-001",
    context: operation === "read" ? "Restoring saved device state" : "Saving device state",
    source: "device-storage",
    severity: "warning",
    toast: operation !== "read",
  });
});
