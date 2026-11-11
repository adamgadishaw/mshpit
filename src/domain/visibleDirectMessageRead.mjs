import { latestDirectMessageReadCursor, normalizeDirectMessageReadCursor } from "./directMessageRead.mjs";

const newer = (left, right) => !!left && (!right || left.createdAt > right.createdAt
  || (left.createdAt === right.createdAt && left.id > right.id));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const rect = (value) => value && [value.x, value.y, value.width, value.height].every(finite)
  && value.width > 0 && value.height > 0 ? value : null;

// An account-private read marker is earned by seeing an incoming row's bottom.
// Layout/scroll coordinates only narrow native measurement candidates; they
// never earn a receipt themselves (nor does an issued scrollToEnd).
export function createVisibleDirectMessageRead({ accountId, otherId, send, isCurrent = () => true, enqueue = queueMicrotask }) {
  let active = false, disposed = false, generation = 0, geometry = 0;
  let messages = new Map(), frames = new Map(), viewport = null, scroll = null, anchorId = null;
  let earned = null, acknowledged = null, flight = null, queued = false, failed = false, attempts = 0;
  const MAX_ATTEMPTS = 3; // Initial attempt + two recovery-triggered attempts per earned target.
  const eligible = () => active && !disposed && !!accountId && !!otherId && isCurrent();
  const revoke = () => {
    generation += 1;
    active = false;
    queued = false;
    if (flight) { flight.controller.abort(); flight = null; }
    if (newer(earned, acknowledged)) failed = true;
  };
  const claim = () => ({ generation, geometry });
  const valid = (token) => eligible() && token?.generation === generation && token?.geometry === geometry;
  const invalidate = () => { geometry += 1; };
  const needsWrite = () => newer(earned, acknowledged);
  const queue = () => {
    if (!eligible() || queued || flight || failed || !needsWrite() || attempts >= MAX_ATTEMPTS) return;
    queued = true;
    const owner = generation;
    enqueue(async () => {
      if (owner !== generation) return;
      queued = false;
      if (!eligible()) { revoke(); return; }
      if (flight || failed || !needsWrite() || attempts >= MAX_ATTEMPTS) return;
      const target = earned, controller = new AbortController();
      const request = { target, controller, generation };
      flight = request;
      attempts += 1;
      let result;
      try { result = await send(target.id, controller.signal); } catch { result = null; }
      if (flight !== request || controller.signal.aborted || request.generation !== generation) return;
      flight = null;
      if (!eligible()) { revoke(); return; }
      if (result?.ok) {
        acknowledged = latestDirectMessageReadCursor(acknowledged,
          latestDirectMessageReadCursor(target, normalizeDirectMessageReadCursor(result.readCursor)));
        failed = false;
        if (newer(earned, target)) attempts = 0;
        queue();
      } else failed = true;
    });
  };
  return {
    activate() {
      if (active || disposed || !isCurrent()) return;
      generation += 1; active = true;
      // Previously earned visibility survives a foreground interruption; new
      // rows still require fresh measured evidence under this generation.
      if (needsWrite() && attempts < MAX_ATTEMPTS) { failed = false; queue(); }
    },
    suspend: revoke,
    dispose() { revoke(); disposed = true; earned = null; messages.clear(); frames.clear(); },
    isEligible: eligible,
    claim,
    valid,
    setMessages(rows) {
      const next = new Map();
      for (const row of rows || []) {
        const cursor = normalizeDirectMessageReadCursor({ id: row?.id, createdAt: row?.at ?? row?.createdAt });
        if (cursor && row.from === otherId && row.from !== accountId && !row.pending && !row.failed) next.set(cursor.id, cursor);
      }
      const changed = messages.size !== next.size || [...next].some(([id, cursor]) => messages.get(id)?.createdAt !== cursor.createdAt);
      if (changed) { invalidate(); scroll = null; }
      messages = next;
      for (const id of frames.keys()) if (!messages.has(id)) frames.delete(id);
      if (!messages.has(anchorId)) anchorId = [...frames.keys()].at(-1) || null;
      if (earned && !messages.has(earned.id)) { earned = null; failed = false; attempts = 0; }
      return changed;
    },
    rowLayout(id, event) {
      const layout = rect(event?.nativeEvent?.layout);
      if (disposed || !messages.has(id) || !layout) return;
      frames.set(id, layout); anchorId = id; invalidate();
    },
    viewportLayout(event) {
      const layout = rect(event?.nativeEvent?.layout);
      if (disposed || !layout) return;
      viewport = layout; scroll = null; invalidate();
    },
    scrolled(event) {
      if (!eligible()) return;
      const native = event?.nativeEvent;
      const height = native?.layoutMeasurement?.height, offset = native?.contentOffset?.y;
      scroll = finite(height) && height > 0 && finite(offset) ? { height, offset } : null;
      invalidate();
    },
    contentChanged() { scroll = null; invalidate(); },
    measurementPlan() {
      if (!eligible() || !viewport || !anchorId) return null;
      // Prefer one likely visible anchor. Unknown offset still needs only one
      // row measurement to derive a candidate offset, never hundreds of reads.
      const candidates = scroll ? [...frames].filter(([, frame]) => frame.y + frame.height > scroll.offset
        && frame.y + frame.height <= scroll.offset + scroll.height + 0.5) : [];
      return { token: claim(), anchorId: candidates.at(-1)?.[0] || anchorId };
    },
    candidatesFromAnchor(token, measuredViewport, measuredAnchor, id) {
      if (!valid(token) || !rect(measuredViewport) || !rect(measuredAnchor)) return [];
      const frame = frames.get(id);
      if (!frame || Math.abs(frame.height - measuredAnchor.height) > 1) return [id];
      const offset = frame.y - (measuredAnchor.y - measuredViewport.y);
      return [...new Set([id, ...[...frames].filter(([, row]) => row.y + row.height > offset
        && row.y + row.height <= offset + measuredViewport.height + 0.5).map(([rowId]) => rowId)])];
    },
    observeMeasured(token, measuredViewport, rows) {
      if (!valid(token) || !rect(measuredViewport)) return;
      let target = null;
      for (const { id, bounds } of rows || []) {
        if (!rect(bounds) || !messages.has(id)) continue;
        const bottom = bounds.y + bounds.height;
        const horizontal = bounds.x < measuredViewport.x + measuredViewport.width && bounds.x + bounds.width > measuredViewport.x;
        if (horizontal && bottom > measuredViewport.y && bottom <= measuredViewport.y + measuredViewport.height + 0.5) {
          target = latestDirectMessageReadCursor(target, messages.get(id));
        }
      }
      if (newer(target, earned)) { earned = target; failed = false; attempts = 0; }
      queue();
    },
    recover({ explicit = false } = {}) {
      if (!eligible() || !failed) return;
      // A successful user-requested refresh is a new recovery episode. It may
      // retry once even after an earlier episode exhausted automatic retries.
      if (explicit) attempts = 0;
      if (attempts >= MAX_ATTEMPTS) return;
      failed = false; queue();
    },
    // Exposed for focused deterministic tests; this contains IDs/cursors only.
    snapshot: () => ({ active, earned, acknowledged, failed, attempts, pending: !!flight }),
  };
}
