import { setImmediate as yieldTurn } from "node:timers/promises";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { CLIP_INDEX_VERSION, CLIP_PHOTOS_MAX_BYTES, clipIndexState, refreshClipIndexPost } from "./clipIndex.js";

export const CLIP_PREPARATION_BATCH_SIZE = 64;
export const CLIP_PREPARATION_BATCH_BYTES = 1024 * 1024;
export const CLIP_PREPARATION_MAX_ELEMENTS = 4096;
export function clipPreparationBatchSql(resumed) {
  return `SELECT id,length(CAST(photos AS BLOB)) bytes FROM posts
    WHERE ${resumed ? "id>? AND " : ""}id<=? ORDER BY id LIMIT ?`;
}

export function prepareClipIndexBatch(database, { batchSize = CLIP_PREPARATION_BATCH_SIZE } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > CLIP_PREPARATION_BATCH_SIZE) {
    throw new RangeError("Invalid clips preparation batch size");
  }
  return withImmediateWrite(database, () => {
    const state = clipIndexState(database);
    if (!state || state.version !== CLIP_INDEX_VERSION) throw new Error("Clips index schema version mismatch");
    if (state.ready) return { ready: true, processed: 0 };
    const args = state.last_post_id === null ? [] : [state.last_post_id];
    args.push(state.upper_post_id, batchSize);
    const rows = database.prepare(clipPreparationBatchSql(state.last_post_id !== null)).all(...args);
    const oversized = rows.filter((row) => row.bytes > CLIP_PHOTOS_MAX_BYTES);
    if (oversized.length) {
      const error = new Error(`Clips preparation blocked: ${oversized.length} oversized photos payload(s); maximum ${Math.max(...oversized.map((row) => row.bytes))} bytes.`);
      error.code = "CLIP_INDEX_PHOTOS_OVERSIZED";
      throw error;
    }
    let bytes = 0;
    const batch = [];
    for (const row of rows) {
      if (batch.length && bytes + row.bytes > CLIP_PREPARATION_BATCH_BYTES) break;
      bytes += row.bytes;
      batch.push(row);
    }
    // Parse only size-preflighted rows, and never silently truncate accepted
    // historical data. A pathological array requires reviewed reconciliation.
    let oversizedArrays = 0, maximumElements = 0, elements = 0;
    const boundedBatch = [];
    for (const row of batch) {
      const stored = database.prepare("SELECT photos,json_valid(photos) supported FROM posts WHERE id=?").get(row.id);
      const raw = stored?.photos;
      let value;
      try { value = JSON.parse(raw); } catch { value = null; }
      if (Array.isArray(value) && !stored.supported) {
        const error = new Error("Clips preparation blocked: photos array exceeds native JSON parser support.");
        error.code = "CLIP_INDEX_PHOTOS_OVERSIZED";
        throw error;
      }
      if (Array.isArray(value) && value.length > CLIP_PREPARATION_MAX_ELEMENTS) {
        oversizedArrays++;
        maximumElements = Math.max(maximumElements, value.length);
      }
      const count = Array.isArray(value) ? value.length : 0;
      if (!oversizedArrays && boundedBatch.length && elements + count > CLIP_PREPARATION_MAX_ELEMENTS) break;
      elements += count;
      boundedBatch.push(row);
    }
    if (oversizedArrays) {
      const error = new Error(`Clips preparation blocked: ${oversizedArrays} oversized photos array(s); maximum ${maximumElements} elements.`);
      error.code = "CLIP_INDEX_PHOTOS_OVERSIZED";
      throw error;
    }
    for (const row of boundedBatch) refreshClipIndexPost(database, row.id);
    const ready = boundedBatch.length === rows.length && rows.length < batchSize;
    database.prepare("UPDATE clip_index_preparation SET last_post_id=COALESCE(?,last_post_id),ready=? WHERE singleton=1")
      .run(boundedBatch.at(-1)?.id ?? null, Number(ready));
    return { ready, processed: boundedBatch.length };
  });
}

export async function prepareClipIndex(database, { onBatch = () => {}, signal, ...options } = {}) {
  let processed = 0;
  while (true) {
    signal?.throwIfAborted();
    const batch = prepareClipIndexBatch(database, options);
    processed += batch.processed;
    onBatch({ ...batch, processed });
    if (batch.ready) return { ready: true, processed };
    await yieldTurn();
  }
}
