// Keep diagnostic metadata outside the original error and never retain SQL,
// parameters, identities, messages or stacks in the emitted diagnostic.
const failures = new WeakMap();
const OPERATIONS = Object.freeze([
  "readSettings", "setEnabled", "recordScan", "eligibleArtistsAfter",
  "eligibleArtistCount", "catalogArtistCount", "eligibleArtistProgress",
  "catalogArtistForSignal", "findCandidateByKey", "findCandidateByMbid",
  "saveConfirmedCandidate", "listCandidates", "candidateCounts",
  "reconcilePublishedMemorials", "review", "markMemorialized", "transaction",
]);

export function withArtistDeathWatchDiagnostics(repository) {
  const observed = { ...repository };
  for (const operation of OPERATIONS) {
    const work = repository[operation];
    if (typeof work !== "function") continue;
    observed[operation] = (...args) => {
      try { return work.apply(repository, args); }
      catch (error) {
        if (error?.code === "ERR_SQLITE_ERROR" && !failures.has(error)) {
          failures.set(error, operation);
        }
        throw error;
      }
    };
  }
  return Object.freeze(observed);
}

export function formatArtistDeathWatchScanFailure(error) {
  const code = String(error?.code || "provider_error").replace(/[^a-z0-9_]/giu, "").slice(0, 60);
  const status = Number(error?.status) || 0;
  const base = `[memorial-watch] bounded scan failed safely: code=${code} status=${status}`;
  if (error?.code !== "ERR_SQLITE_ERROR") return base;
  const operation = failures.get(error) || "unknown";
  const sqliteCode = error.errcode;
  const detail = Number.isInteger(sqliteCode) && sqliteCode >= 0 && sqliteCode <= 65535
    ? ` sqliteCode=${sqliteCode} sqlitePrimary=${sqliteCode & 255}` : " sqliteCode=unknown";
  return `${base} operation=${operation}${detail}`;
}
