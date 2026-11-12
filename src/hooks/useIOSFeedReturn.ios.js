import { createContext, createElement, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { View } from "react-native";
import { FEED_RETURN_LIMIT } from "../domain/iosFeedReturn.mjs";

const Cells = createContext(null);
// Preserve VirtualizedList's own measurement/focus handlers and cell styling.
function ReturnCell({ children, style, onLayout, onFocusCapture, index, cellKey }) {
  const context = useContext(Cells);
  const owner = context?.owner, revision = context?.revision;
  return createElement(View, { style, onFocusCapture, onLayout: event => {
    onLayout?.(event);
    owner?.measure(revision, index, cellKey, event.nativeEvent.layout);
  } }, children);
}
export const FeedReturnProvider = Cells.Provider;

export default function useIOSFeedReturn({ lease, presentation, filter, count, rows, keyExtractor, width, fontScale, active }) {
  const list = useRef(null), live = useRef(null);
  const [, update] = useReducer(value => value + 1, 0);
  const supported = filter === "everyone" || filter === "local";
  const owner = useMemo(() => {
    const snapshot = supported ? lease?.read(filter) : null;
    const saved = snapshot?.width === width && snapshot?.fontScale === fontScale ? snapshot : null;
    const state = { revision: 0, count, presentation, mounted: false, everMounted: false, active, frames: new Map(), keys: [], signature: "", pending: saved?.anchor ? saved : null, phase: "waiting", timer: null, attempts: 0, failedAttempt: 0, highest: -1, lastSeekHighest: -1, capture: !snapshot?.anchor };
    const valid = revision => live.current === state && state.mounted && state.active && state.presentation?.current() && lease?.current() && state.revision === revision;
    const stop = () => { clearTimeout(state.timer); state.timer = null; state.pending = null; state.phase = "done"; };
    state.cancel = () => { stop(); state.capture = true; state.revision++; lease?.clear(); update(); };
    state.stop = stop;
    state.valid = valid;
    state.measure = (revision, index, key, frame) => {
      if (!valid(revision) || state.keys[index] !== key || index >= FEED_RETURN_LIMIT + 1) return;
      if (!Number.isFinite(frame?.y) || !Number.isFinite(frame?.height) || frame.height <= 0) return;
      state.frames.set(index, { key, y: frame.y, height: frame.height });
      const progressed = index > state.highest;
      state.highest = Math.max(index, state.highest);
      if (state.pending?.anchor === key && state.phase === "seeking") {
        const offset = frame.y + Math.min(state.pending.offset, frame.height - 1);
        stop();
        state.capture = true;
        list.current?.scrollToOffset({ offset, animated: false });
      } else if (state.pending && state.phase === "seeking" && progressed && state.highest - state.lastSeekHighest >= 3) {
        state.advance?.();
      }
    };
    return state;
  }, [lease, filter, width, fontScale, supported]);
  live.current = owner;
  if (owner.active !== active) { owner.active = active; owner.revision++; owner.stop(); }
  if (owner.presentation !== presentation) {
    owner.presentation = presentation; owner.revision++; owner.stop();
  }
  const keys = useMemo(() => rows.slice(0, FEED_RETURN_LIMIT + 1).map(keyExtractor), [rows, keyExtractor]);
  const signature = useMemo(() => JSON.stringify(keys), [keys]);
  if (owner.count !== count || (owner.signature && owner.signature !== signature)) {
    owner.revision++;
    owner.count = count;
    if (JSON.stringify(keys.slice(0, owner.keys.length)) !== owner.signature) owner.frames.clear();
  }
  if (owner.pending && owner.pending.order !== signature && rows.length) owner.stop();
  owner.keys = keys;
  owner.signature = signature;
  const revision = owner.revision;
  const provider = useMemo(() => ({ owner, revision }), [owner, revision]);
  const eligible = supported && lease && count <= FEED_RETURN_LIMIT;
  if (!eligible && supported) lease?.clear();
  const save = patch => {
    if (!eligible || !owner.valid(revision)) return;
    lease.save({ filter, count, width, fontScale, order: signature, anchor: null, offset: 0, ...patch });
  };
  useLayoutEffect(() => {
    owner.mounted = true;
    if (owner.everMounted) update();
    owner.everMounted = true;
    const previous = lease?.read(filter);
    if (eligible) save(previous?.width === width && previous?.fontScale === fontScale && previous?.order === signature ? { anchor: previous.anchor, offset: previous.offset } : {});
    return () => {
      owner.mounted = false; owner.revision++; clearTimeout(owner.timer); owner.timer = null;
      if (owner.pending) owner.phase = "waiting";
    };
  }, [owner]);
  useLayoutEffect(() => {
    if (eligible) {
      const previous = lease.read(filter);
      const sameOrder = previous?.order === signature || (previous?.count < count && JSON.stringify(keys.slice(0, JSON.parse(previous.order).length)) === previous.order);
      save(previous?.width === width && previous?.fontScale === fontScale && sameOrder && previous?.anchor && keys.includes(previous.anchor) ? { anchor: previous.anchor, offset: previous.offset } : {});
    }
  }, [owner, count, signature, revision]);
  useEffect(() => { if (!active) owner.stop(); }, [active, owner]);
  if (!lease || !supported) return { cancel: () => { if (owner.valid(revision)) owner.cancel(); }, props: {}, provider: null };
  const seek = () => {
    if (!owner.valid(revision) || !owner.pending) return;
    if (owner.attempts >= 6) { owner.stop(); return; }
    const index = keys.indexOf(owner.pending.anchor);
    if (index < 0) { owner.stop(); return; }
    owner.attempts++;
    owner.lastSeekHighest = owner.highest;
    list.current?.scrollToIndex({ index, animated: false });
  };
  owner.advance = seek;
  const begin = () => {
    if (!owner.valid(revision) || !owner.pending || owner.phase !== "waiting" || owner.pending.order !== signature) return;
    const index = keys.indexOf(owner.pending.anchor);
    if (index < 0) { owner.stop(); return; }
    owner.phase = "seeking";
    const measured = owner.frames.get(index);
    if (measured?.key === owner.pending.anchor) { owner.measure(revision, index, measured.key, measured); return; }
    owner.timer = setTimeout(() => {
      if (!owner.valid(revision) || !owner.pending) return;
      owner.stop();
    }, 1500);
    seek();
  };
  return {
    cancel: () => { if (owner.valid(revision)) owner.cancel(); },
    provider,
    props: {
      ref: list, CellRendererComponent: ReturnCell,
      onContentSizeChange: begin,
      onScrollBeginDrag: () => { if (owner.valid(revision)) owner.cancel(); },
      onScrollToIndexFailed: info => {
        if (!owner.valid(revision) || !owner.pending || owner.phase !== "seeking") return;
        if (owner.failedAttempt === owner.attempts) return;
        owner.failedAttempt = owner.attempts;
        const index = keys.indexOf(owner.pending.anchor);
        if (info.index !== index || !Number.isFinite(info.averageItemLength) || info.averageItemLength <= 0) { owner.stop(); return; }
        // Coarse seek uses CURRENT native measurements. At most six attempts,
        // each subsequent attempt requires fresh measured-index progress.
        owner.phase = "coarse";
        list.current?.scrollToOffset({ offset: Math.min(100000, info.averageItemLength * index), animated: false });
        owner.phase = "seeking";
      },
      scrollEventThrottle: 32,
      onScroll: event => {
        if (!owner.valid(revision) || owner.pending || !owner.capture) return;
        const y = event.nativeEvent?.contentOffset?.y;
        if (!Number.isFinite(y) || y < 0) return;
        const cell = [...owner.frames.values()].find(frame => frame.y <= y && y < frame.y + frame.height && frame.key !== "slot:ios-people-discovery");
        if (cell) save({ anchor: cell.key, offset: Math.min(100000, y - cell.y) });
        else if (y === 0) save({});
      },
    },
  };
}
