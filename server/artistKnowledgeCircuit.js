import { randomUUID } from "node:crypto";

const MINUTE = 60_000;
export const ARTIST_KNOWLEDGE_CIRCUIT_KEY = "artist-knowledge:v1:provider-circuit";
const COOLDOWN_KEY = "artist-knowledge:v1:cooldown";
export function artistKnowledgeFailureCategory(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  return code === "knowledge_busy" || code === "legacy_provider_cooldown"
    || /^(?:wikidata|wikipedia)_(?:rate_limited|unavailable|maxlag|timeout|network|response|rejected|redirect)$/.test(code)
    ? code : "provider_error";
}

// A malformed/mismatched record is not proof that the whole provider is down.
export function artistKnowledgeProviderOutage(error) {
  return error?.code === "knowledge_busy" || /_(?:rate_limited|unavailable|maxlag|timeout|network)$/.test(String(error?.code || ""))
    || Number(error?.status) === 429 || Number(error?.status) >= 500;
}

// One tiny durable circuit per catalogue worker, not one entry per artist.
// A recovery probe owns one record for at most a minute, including restarts.
export function createArtistKnowledgeCircuit(database, { now = Date.now } = {}) {
  const get = database.prepare("SELECT value FROM app_meta WHERE key=?");
  const set = database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const save = (state) => {
    database.exec("SAVEPOINT artist_knowledge_circuit_save");
    try {
      set.run(ARTIST_KNOWLEDGE_CIRCUIT_KEY, JSON.stringify(state));
      set.run(COOLDOWN_KEY, String(Math.max(state.retryAt || 0, state.probeUntil || 0)));
      database.exec("RELEASE artist_knowledge_circuit_save");
      return state;
    } catch (error) {
      database.exec("ROLLBACK TO artist_knowledge_circuit_save; RELEASE artist_knowledge_circuit_save");
      throw error;
    }
  };
  const read = () => {
    const raw = get.get(ARTIST_KNOWLEDGE_CIRCUIT_KEY)?.value;
    if (raw) {
      const state = JSON.parse(raw);
      if (state?.version !== 1 || !Number.isSafeInteger(state.retryAt) || !Number.isSafeInteger(state.probeUntil)) {
        throw new TypeError("Invalid provider circuit evidence.");
      }
      return state;
    }
    const old = Number(get.get(COOLDOWN_KEY)?.value);
    if (!(old > now())) return null;
    // Historic cooldowns conflated bad records with outages. Retain the old
    // expiry as evidence, but allow one probe after at most fifteen minutes.
    return save({ version: 1, cause: "legacy_provider_cooldown", failures: 1, openedAt: now(),
      retryAt: Math.min(old, now() + 15 * MINUTE), previousRetryAt: old, probeUntil: 0, probeToken: null });
  };
  const begin = () => {
    database.exec("SAVEPOINT artist_knowledge_circuit");
    try {
      const state = read();
      let result;
      if (!state?.retryAt) result = { allowed: true, probeToken: null, state };
      else if (Math.max(state.retryAt, state.probeUntil) > now()) result = { allowed: false, state };
      else {
        const token = randomUUID();
        result = { allowed: true, probeToken: token, state: save({ ...state, probeToken: token, probeUntil: now() + MINUTE }) };
      }
      database.exec("RELEASE artist_knowledge_circuit");
      return result;
    } catch (error) {
      database.exec("ROLLBACK TO artist_knowledge_circuit; RELEASE artist_knowledge_circuit");
      throw error;
    }
  };
  const fail = (error) => {
    const previous = read();
    const failures = Math.min(10, (Number(previous?.failures) || 0) + 1);
    const at = now();
    // Local exponential pauses are short. An explicit provider Retry-After
    // remains authoritative (bounded to one day for corrupt remote headers).
    const retryAfter = Number.isSafeInteger(error?.retryAt) ? Math.min(error.retryAt, at + 24 * 60 * MINUTE) : 0;
    return save({ version: 1, cause: artistKnowledgeFailureCategory(error), failures,
      status: Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null,
      openedAt: previous?.openedAt || at, retryAt: Math.max(at + Math.min(15, 2 ** (failures - 1)) * MINUTE, retryAfter),
      probeUntil: 0, probeToken: null });
  };
  const finishProbe = (token, recovered) => {
    if (!token) return;
    const state = read();
    if (state?.probeToken !== token) return;
    save({ ...state, failures: recovered ? 0 : state.failures,
      retryAt: recovered ? 0 : now() + MINUTE, probeUntil: 0, probeToken: null,
      ...(recovered ? { recoveredAt: now() } : {}) });
  };
  return { begin, read, fail, finishProbe, permits(token) {
    const state = read();
    return !state?.retryAt || (token && state.probeToken === token && state.probeUntil > now());
  } };
}
