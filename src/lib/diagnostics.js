import { load, remove, save, setPersistErrorHandler } from "./persist";
import { catalogEntry, catalogueCode, safeRouteTemplate } from "./errorCatalog.mjs";
import { diagnosticsStorageKey, LEGACY_DIAGNOSTICS_STORAGE_KEY } from "../domain/accountLocalPrivacy.mjs";
import { shouldToastDeviceStorageFailure } from "../domain/deviceStoragePolicy.mjs";

const HISTORY_LIMIT = 75;
const listeners = new Set();
const feedbackListeners = new Set();
const recentFeedback = new Map();

const ROUTE_ID_PARENTS = new Set([
  "artist-requests", "artists", "assets", "badges", "campaigns", "comments",
  "content", "dms", "fanclubs", "going", "lounges", "playlists", "posts",
  "preferences", "reports", "templates", "users", "variants", "venues",
]);
// Fixed endpoint actions are not artist identifiers. Preserve the useful action
// name in staff diagnostics while still redacting every actual child identifier.
const ROUTE_LITERAL_CHILDREN = new Set(["artists/enrich"]);
const UUID_SEGMENT = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PREFIXED_ID_SEGMENT = /^[a-z][a-z0-9]{0,10}_[a-z0-9_-]+$/i;
const HIGH_ENTROPY_SEGMENT = /^(?=[a-z0-9_-]{12,}$)(?=.*[a-z])(?=.*\d)[a-z0-9_-]+$/i;

const accountIdFor = (value) => value == null || value === "" ? null : String(value);
const validHistory = (value) => Array.isArray(value)
  ? value.filter((item) => item && typeof item === "object" && /^PIT-[A-Z]+-\d{3}$/.test(item.code || "")).slice(0, HISTORY_LIMIT)
  : [];

export function purgeLegacyDiagnosticsStorage() {
  remove(LEGACY_DIAGNOSTICS_STORAGE_KEY);
}

// v1 was one device-global list. Ownership cannot be reconstructed safely, so
// never migrate it into a guest or member account.
purgeLegacyDiagnosticsStorage();

let activeAccountId = null;
let activeHistoryKey = diagnosticsStorageKey(null);
let history = validHistory(load(activeHistoryKey, []));
const cleanText = (value, max = 120) => String(value || "")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

const newId = () => `pit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function diagnosticRouteTemplate(path = "") {
  const parts = safeRouteTemplate(path).split("/").filter(Boolean);
  const projected = parts.map((part, index) => {
    if (part === ":id") return part;
    const previous = parts[index - 1];
    if (ROUTE_ID_PARENTS.has(previous) && !ROUTE_LITERAL_CHILDREN.has(`${previous}/${part}`)) return ":id";
    if (UUID_SEGMENT.test(part) || PREFIXED_ID_SEGMENT.test(part) || HIGH_ENTROPY_SEGMENT.test(part)) return ":id";
    return part;
  });
  return `/${projected.join("/")}`;
}

export function supportReferenceFor(entry) {
  const value = entry?.meta?.requestId || entry?.id;
  const reference = cleanText(value, 80).replace(/[^a-zA-Z0-9._:-]/g, "");
  return reference || null;
}

function safeMeta(meta = {}) {
  const output = {};
  if (meta.method) output.method = cleanText(meta.method, 8).toUpperCase();
  if (meta.route || meta.path) output.route = diagnosticRouteTemplate(meta.route || meta.path);
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
  save(activeHistoryKey, history);
  notifyHistory();
  if (toast) notifyFeedback(entry);
  return appError;
}

export function getDiagnostics() {
  return history.slice();
}


export function configureDiagnosticsIdentity(accountId) {
  const nextAccountId = accountIdFor(accountId);
  const nextKey = diagnosticsStorageKey(nextAccountId);
  if (nextKey === activeHistoryKey) return getDiagnostics();
  activeAccountId = nextAccountId;
  activeHistoryKey = nextKey;
  history = validHistory(load(activeHistoryKey, []));
  notifyHistory();
  return getDiagnostics();
}

export function diagnosticsIdentity() {
  return activeAccountId;
}
export function clearDiagnostics() {
  history = [];
  remove(activeHistoryKey);
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
  if (key === LEGACY_DIAGNOSTICS_STORAGE_KEY || String(key || "").startsWith("pit.diagnostics.v2.")) return;
  captureAppError(error, {
    code: "PIT-STORE-001",
    context: operation === "read" ? "Restoring saved device state" : "Saving device state",
    source: "device-storage",
    severity: "warning",
    // Recoverable server caches should never interrupt a member. Surface this
    // warning only when genuinely device-authored recovery state did not save.
    toast: shouldToastDeviceStorageFailure({ operation, key }),
  });
});
