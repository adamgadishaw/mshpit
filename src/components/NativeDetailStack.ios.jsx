import { cloneElement, isValidElement, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { createIOSDetailRetention, iosDetailCanRetain } from "../domain/iosDetailRetention.mjs";
import { getIOSDetailPrivacySnapshot, subscribeIOSDetailPrivacy } from "../lib/iosDetailPrivacy";
import usePresentationAdmission from "../hooks/useFeedPresentation";
import { IOSDetailPresentationContext } from "./iosDetailPresentationContext.mjs";
import { NativeTabPreviewContext } from "./nativeTabPreviewContext.mjs";
import { NativeFeedBackContext } from "./nativeFeedBackContext.mjs";
import { PostNavigationContext } from "./PostNavigationContext";
import { CityNavigationContext } from "./cities/CityNavigationContext";

function CommittedDetail({ entry, owner, presentation, privacyRevision, onReady, children }) {
  // This boundary is inside the route's Suspense wrapper. The outer keyed
  // occurrence can remain mounted while React disconnects its actual page.
  // A reconnect gets a new immutable admission; old native callbacks cannot
  // regain authority merely because the same view becomes visible again.
  useLayoutEffect(() => {
    entry.connected = true;
    owner.ready(entry, true);
    onReady();
    return () => {
      entry.connected = false;
      entry.layoutEpoch += 1;
      owner.ready(entry, false);
      onReady();
    };
  }, [entry, owner, onReady]);
  useLayoutEffect(() => {
    if (owner.ready(entry, true, { active: presentation.current(), privacyRevision })) onReady();
  }, [entry, owner, presentation.current, privacyRevision, onReady]);
  return children;
}
function DetailOccurrence({ entry, active, preview, frames, owner, live, privacyRevision, admitted, reveal, element, wrap, onReady }) {
  const inheritedPreview = useContext(NativeTabPreviewContext);
  const city = useContext(CityNavigationContext), post = useContext(PostNavigationContext);
  const layoutEpoch = entry.layoutEpoch, connected = entry.connected;
  const authority = useMemo(() => ({ current: () => active && admitted
    && connected && entry.connected && entry.layoutEpoch === layoutEpoch
    && AppState.currentState === "active"
    && owner.current(entry) && live.current.frames === frames
    && live.current.isCurrentRoute(entry.occurrence.frame, entry.occurrence.index) }),
  [active, admitted, owner, entry, frames, live, layoutEpoch, connected]);
  const { current } = usePresentationAdmission({ active: active && admitted, presentation: authority, scope: entry.occurrence });
  // Read/receipt admission remains stable across privacy-only changes so an
  // authoritative denial can clear its own old data. Commands have a separate
  // captured privacy fence, including native events queued before re-render.
  const token = useMemo(() => Object.freeze({}), [current]);
  const commandToken = useMemo(() => Object.freeze({}), [token, privacyRevision]);
  const privacyCurrent = useMemo(() => () => getIOSDetailPrivacySnapshot() === privacyRevision, [privacyRevision]);
  const canAct = useMemo(() => () => current() && privacyCurrent(), [current, privacyCurrent]);
  const presentation = useMemo(() => ({ managed: true, active: active && admitted && current(), preview,
    current, canAct, privacyCurrent, token, commandToken, privacyScope: privacyRevision, scope: entry.occurrence,
    guard: callback => typeof callback === "function" ? (...args) => { if (canAct()) return callback(...args); } : callback,
  }), [active, admitted, preview, current, canAct, privacyCurrent, token, commandToken, privacyRevision, entry.occurrence]);
  const props = {};
  if (isValidElement(element)) for (const [key, value] of Object.entries(element.props)) {
    if (typeof value !== "function" || !key.startsWith("on")) continue;
    props[key] = key === "onClose" ? event => { if (current()) return value(event, current); } : presentation.guard(value);
  }
  const detail = isValidElement(element) ? cloneElement(element, props) : element;
  return <View testID={`ios-detail-occurrence-${entry.occurrence.id}`}
    style={[styles.layer, !active && !preview && styles.hidden]}
    pointerEvents={presentation.active ? "auto" : "none"}
    accessibilityElementsHidden={!presentation.active}
    importantForAccessibility={presentation.active ? "auto" : "no-hide-descendants"}>
    <IOSDetailPresentationContext.Provider value={presentation}>
      <NativeTabPreviewContext.Provider value={inheritedPreview || !presentation.active}>
        <CityNavigationContext.Provider value={presentation.guard(city)}><PostNavigationContext.Provider value={presentation.guard(post)}>
          <NativeFeedBackContext.Provider value={active && reveal}>
            {wrap({ frame: entry.occurrence.frame, entry, active: presentation.active, current: canAct, gestureScope: commandToken,
              children: <CommittedDetail entry={entry} owner={owner} presentation={presentation} privacyRevision={privacyRevision} onReady={onReady}>{detail}</CommittedDetail> })}
          </NativeFeedBackContext.Provider>
        </PostNavigationContext.Provider></CityNavigationContext.Provider>
      </NativeTabPreviewContext.Provider>
    </IOSDetailPresentationContext.Provider>
  </View>;
}
export default function NativeDetailStack({ children, frames, scope, enabled = true, admitted = true, isCurrentRoute, element, wrap }) {
  const inheritedReveal = useContext(NativeFeedBackContext);
  const privacyRevision = useSyncExternalStore(subscribeIOSDetailPrivacy, getIOSDetailPrivacySnapshot, getIOSDetailPrivacySnapshot);
  const ownerRef = useRef(null);
  if (!ownerRef.current) ownerRef.current = createIOSDetailRetention();
  const owner = ownerRef.current;
  const live = useRef(null);
  live.current = { frames, isCurrentRoute };
  const [layoutRevision, setLayoutRevision] = useState(0);
  const onReady = useMemo(() => () => setLayoutRevision(value => value + 1), []);
  const plan = useMemo(() => owner.plan({ frames, scope, privacyRevision, element, enabled }), [owner, frames, scope, privacyRevision, element, enabled, layoutRevision]);
  useLayoutEffect(() => { owner.commit(plan); }, [owner, plan]);
  if (!iosDetailCanRetain(frames?.at(-1))) return children;
  // Sensitive account/auth flows clear retained payloads. Never remount the
  // covered top through the unmanaged fallback while the flow is active.
  if (!enabled) return <View style={styles.fill} />;
  return <View style={styles.fill}>{plan.entries.map(entry => {
    const active = entry.occurrence === plan.top;
    return <DetailOccurrence key={entry.occurrence.id} entry={entry} active={active} preview={!active && entry === plan.previous}
      frames={frames} owner={owner} live={live} privacyRevision={privacyRevision} admitted={admitted}
      reveal={!!plan.previous || inheritedReveal && entry.occurrence.index === 1}
      element={plan.elements.get(entry)} wrap={wrap} onReady={onReady} />;
  })}</View>;
}
const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0 }, layer: { ...StyleSheet.absoluteFill, minHeight: 0 }, hidden: { opacity: 0 } });
