import { useLayoutEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { createVisibleDirectMessageRead } from "../domain/visibleDirectMessageRead.mjs";

const bounds = (x, y, width, height) => ({ x, y, width, height });

export default function useVisibleDirectMessageRead({ accountId, authEpoch, otherId, blocked, messages, scrollRef, markThreadRead, isCurrentRoute }) {
  const ownerRef = useRef(null);
  // These are geometry hints only. Each owner must earn its own cursor from
  // fresh native bounds, including when the native view keeps the same size.
  const layoutCache = useRef({ viewport: null, rows: new Map() });
  const latest = useRef(null);
  const [, redraw] = useState(0);
  latest.current = { markThreadRead, isCurrentRoute };
  const key = JSON.stringify([accountId || null, authEpoch, otherId || null, !!blocked]);
  const webDocument = Platform.OS === "web" && typeof document !== "undefined" ? document : null;
  const foreground = () => Platform.OS === "web"
    ? webDocument?.visibilityState === "visible"
    : AppState?.currentState === "active";
  if (!ownerRef.current || ownerRef.current.key !== key) {
    ownerRef.current = { key, mounted: false, retired: false, hidden: false, token: {}, rows: new Map(), refs: new Map(), timer: null };
  }
  const owner = ownerRef.current;
  const makeController = () => {
    const controller = createVisibleDirectMessageRead({
      accountId, otherId,
      isCurrent: () => ownerRef.current === owner && owner.controller === controller && owner.mounted
        && !blocked && !owner.hidden && foreground() && (!latest.current.isCurrentRoute || latest.current.isCurrentRoute()),
      send: (messageId, signal) => latest.current.markThreadRead(otherId, { messageId, signal, isCurrent: controller.isEligible }),
    });
    controller.setMessages(messages);
    if (layoutCache.current.viewport) controller.viewportLayout(layoutCache.current.viewport);
    for (const [id, event] of layoutCache.current.rows) controller.rowLayout(id, event);
    return controller;
  };
  if (!owner.controller) owner.controller = makeController();
  const controller = owner.controller, token = owner.token;
  const owned = () => ownerRef.current === owner && owner.controller === controller && owner.token === token && owner.mounted;
  const current = () => owned() && controller.isEligible();
  const measure = () => {
    const plan = controller.measurementPlan();
    const host = scrollRef.current?.getNativeScrollRef?.() || scrollRef.current;
    const anchor = plan && owner.rows.get(plan.anchorId);
    if (!plan || !host?.measureInWindow || !anchor?.measureInWindow) return;
    host.measureInWindow((...viewportValues) => {
      if (!controller.valid(plan.token)) return;
      const viewport = bounds(...viewportValues);
      anchor.measureInWindow((...anchorValues) => {
        if (!controller.valid(plan.token)) return;
        const anchorBounds = bounds(...anchorValues);
        const ids = controller.candidatesFromAnchor(plan.token, viewport, anchorBounds, plan.anchorId);
        const observed = [{ id: plan.anchorId, bounds: anchorBounds }];
        const remaining = ids.filter(id => id !== plan.anchorId && owner.rows.get(id)?.measureInWindow);
        let waiting = remaining.length;
        const finish = () => controller.observeMeasured(plan.token, viewport, observed);
        if (!waiting) { finish(); return; }
        for (const id of remaining) {
          owner.rows.get(id).measureInWindow((...values) => {
            if (!controller.valid(plan.token)) return;
            observed.push({ id, bounds: bounds(...values) });
            waiting -= 1;
            if (!waiting) finish();
          });
        }
      });
    });
  };
  const cancelMeasurement = () => {
    if (owner.timer !== null) { clearTimeout(owner.timer.id); owner.timer = null; }
  };
  const scheduleMeasurement = () => {
    if (owner.timer !== null || !controller.isEligible()) return;
    const scheduled = { token: owner.token, id: null };
    owner.timer = scheduled;
    scheduled.id = setTimeout(() => {
      if (owner.timer !== scheduled) return;
      owner.timer = null;
      if (ownerRef.current === owner && owner.token === scheduled.token && owner.controller === controller) measure();
    }, 0);
  };
  useLayoutEffect(() => {
    // A StrictMode/Suspense reconnect retires captured callbacks permanently.
    if (owner.retired) {
      owner.token = {};
      owner.retired = false;
      redraw(value => value + 1);
    }
    owner.mounted = true;
    const active = owner.controller;
    active.setMessages(messages);
    if (foreground()) active.activate();
    let alive = true;
    const changeVisibility = (visible) => {
      if (!alive || ownerRef.current !== owner) return;
      owner.token = {};
      owner.hidden = !visible;
      active.suspend();
      cancelMeasurement();
      if (visible && foreground()) active.activate();
      redraw(value => value + 1);
    };
    const subscription = Platform.OS !== "web" ? AppState?.addEventListener?.("change", state => changeVisibility(state === "active")) : null;
    const visibility = () => changeVisibility(webDocument?.visibilityState === "visible");
    const hide = () => changeVisibility(false);
    const show = () => changeVisibility(webDocument?.visibilityState === "visible");
    webDocument?.addEventListener("visibilitychange", visibility);
    const webWindow = Platform.OS === "web" && typeof window !== "undefined" ? window : null;
    webWindow?.addEventListener("pagehide", hide);
    webWindow?.addEventListener("pageshow", show);
    return () => {
      alive = false;
      owner.mounted = false; owner.retired = true; owner.token = {};
      active.suspend();
      cancelMeasurement();
      subscription?.remove();
      webDocument?.removeEventListener("visibilitychange", visibility);
      webWindow?.removeEventListener("pagehide", hide);
      webWindow?.removeEventListener("pageshow", show);
    };
  }, [owner]);
  useLayoutEffect(() => {
    const admitted = owner.mounted && !blocked && !owner.hidden && foreground()
      && (!latest.current.isCurrentRoute || latest.current.isCurrentRoute());
    if (owner.admitted !== admitted) {
      owner.admitted = admitted; owner.token = {};
      cancelMeasurement();
      controller.suspend();
      if (admitted) controller.activate();
      redraw(value => value + 1);
    }
    controller.setMessages(messages);
    const ids = new Set(messages.map(message => message.id));
    for (const id of layoutCache.current.rows.keys()) if (!ids.has(id)) layoutCache.current.rows.delete(id);
    scheduleMeasurement();
  });
  return {
    rowRef(id) {
      if (!owner.refs.has(id)) owner.refs.set(id, node => {
        if (ownerRef.current !== owner) return;
        if (node) owner.rows.set(id, node); else { owner.rows.delete(id); owner.refs.delete(id); }
      });
      return owner.refs.get(id);
    },
    rowLayout(id, event) { if (owned()) {
      layoutCache.current.rows.set(id, { nativeEvent: { layout: { ...event.nativeEvent.layout } } });
      controller.rowLayout(id, event); scheduleMeasurement();
    } },
    onLayout(event) { if (owned()) {
      layoutCache.current.viewport = { nativeEvent: { layout: { ...event.nativeEvent.layout } } };
      controller.viewportLayout(event); scheduleMeasurement();
    } },
    onScroll(event) { if (current()) { controller.scrolled(event); scheduleMeasurement(); } },
    onContentSizeChange() { if (current()) { controller.contentChanged(); scheduleMeasurement(); } },
    recover() { if (ownerRef.current === owner && owner.controller === controller) { controller.recover({ explicit: true }); scheduleMeasurement(); } },
  };
}
