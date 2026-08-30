import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import useReducedMotion from "../hooks/useReducedMotion";
import {
  beginWebPullGesture,
  canReleaseWebRefreshLatch,
  isTouchPhoneRefreshCapable,
  moveWebPullGesture,
  shouldRefreshWebPullGesture,
  WEB_PULL_REFRESH_CONFIG,
} from "../domain/webPullRefresh.mjs";
import { colors, mono, radius, shadow, themeIsDark } from "../theme";

const SPIN_DURATION_MS = 900;
const vinylInk = themeIsDark ? colors.bg : colors.text;

function readTouchPhoneCapability() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const matchMedia = typeof window.matchMedia === "function"
    ? window.matchMedia.bind(window)
    : null;
  return isTouchPhoneRefreshCapable({
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    coarsePointer: matchMedia?.("(pointer: coarse)").matches === true,
    noHover: matchMedia?.("(hover: none)").matches === true,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
  });
}

function subscribeMediaQuery(query, listener) {
  if (!query) return () => {};
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }
  query.addListener?.(listener);
  return () => query.removeListener?.(listener);
}

function indicatorNodes({ indicatorRef, recordRef, statusTextRef }) {
  return {
    indicator: indicatorRef.current,
    record: recordRef.current,
    statusText: statusTextRef.current,
  };
}

function writeStatus(statusText, value) {
  if (statusText && statusText.textContent !== value) statusText.textContent = value;
}

function removeProgressValue(indicator) {
  indicator.removeAttribute("aria-valuemin");
  indicator.removeAttribute("aria-valuemax");
  indicator.removeAttribute("aria-valuenow");
}

function hideWebRefreshIndicator(refs, accessibilityLabel) {
  const { indicator, record, statusText } = indicatorNodes(refs);
  if (!indicator?.style) return;
  indicator.style.opacity = "0";
  indicator.style.visibility = "hidden";
  indicator.style.transform = "none";
  indicator.setAttribute("aria-hidden", "true");
  indicator.setAttribute("aria-label", accessibilityLabel);
  indicator.removeAttribute("aria-valuetext");
  removeProgressValue(indicator);
  if (record?.style) record.style.transform = "rotate(0deg)";
  writeStatus(statusText, "PULL TO REFRESH");
}

function showWebPullIndicator(refs, {
  pullDistance,
  armed,
  reduceMotion,
  accessibilityLabel,
}) {
  const { indicator, record, statusText } = indicatorNodes(refs);
  if (!indicator?.style) return;
  const status = armed ? "RELEASE TO REFRESH" : "PULL TO REFRESH";
  const spokenStatus = armed ? "Release to refresh" : "Pull to refresh";
  const progress = Math.min(1, pullDistance / WEB_PULL_REFRESH_CONFIG.armPullPx);
  const translateY = Math.max(-44, pullDistance - 44);

  indicator.style.opacity = String(Math.min(1, pullDistance / 24));
  indicator.style.visibility = "visible";
  indicator.style.transform = reduceMotion ? "none" : `translateY(${translateY}px)`;
  indicator.setAttribute("aria-hidden", "false");
  indicator.setAttribute("aria-label", accessibilityLabel);
  indicator.setAttribute("aria-valuemin", "0");
  indicator.setAttribute("aria-valuemax", "100");
  indicator.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  indicator.setAttribute("aria-valuetext", spokenStatus);
  if (record?.style) {
    record.style.transform = reduceMotion
      ? "rotate(0deg)"
      : `rotate(${Math.min(280, pullDistance * 3.5)}deg)`;
  }
  writeStatus(statusText, status);
}

function showWebRefreshingIndicator(refs, accessibilityLabel) {
  const { indicator, record, statusText } = indicatorNodes(refs);
  if (!indicator?.style) return;
  indicator.style.opacity = "1";
  indicator.style.visibility = "visible";
  indicator.style.transform = "none";
  indicator.setAttribute("aria-hidden", "false");
  indicator.setAttribute("aria-label", `${accessibilityLabel} in progress`);
  indicator.setAttribute("aria-valuetext", "Refreshing");
  // Refresh duration is unknown, so this is intentionally indeterminate.
  removeProgressValue(indicator);
  if (record?.style) record.style.transform = "rotate(0deg)";
  writeStatus(statusText, "REFRESHING");
}

function VinylRecord({ active, reduceMotion, elementRef }) {
  const ownRef = useRef(null);
  const recordRef = elementRef || ownRef;

  useEffect(() => {
    if (!active || reduceMotion || typeof recordRef.current?.animate !== "function") return undefined;
    const animation = recordRef.current.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: SPIN_DURATION_MS, iterations: Number.POSITIVE_INFINITY, easing: "linear" },
    );
    return () => animation.cancel();
  }, [active, recordRef, reduceMotion]);

  return (
    <View
      ref={recordRef}
      style={styles.record}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.grooveOuter} />
      <View style={styles.grooveInner} />
      <View style={styles.recordLabel}>
        <View style={styles.spindle} />
      </View>
      <View style={styles.recordGlint} />
    </View>
  );
}

export function VinylRefreshIndicator({
  refreshing = false,
  accessibilityLabel = "Refresh this screen",
  indicatorOffset = 12,
  testID,
  indicatorRef: providedIndicatorRef,
  recordRef: providedRecordRef,
  statusTextRef: providedStatusTextRef,
  onReducedMotionChange,
}) {
  const ownIndicatorRef = useRef(null);
  const ownRecordRef = useRef(null);
  const ownStatusTextRef = useRef(null);
  const indicatorRef = providedIndicatorRef || ownIndicatorRef;
  const recordRef = providedRecordRef || ownRecordRef;
  const statusTextRef = providedStatusTextRef || ownStatusTextRef;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    onReducedMotionChange?.(reduceMotion);
  }, [onReducedMotionChange, reduceMotion]);

  return (
    <View
      ref={indicatorRef}
      pointerEvents="none"
      style={[
        styles.statusPosition,
        { top: indicatorOffset },
        refreshing ? styles.statusVisible : styles.statusHidden,
      ]}
      accessible
      aria-hidden={!refreshing}
      accessibilityElementsHidden={!refreshing}
      accessibilityRole="progressbar"
      accessibilityLabel={refreshing ? `${accessibilityLabel} in progress` : accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityValue={refreshing ? { text: "Refreshing" } : undefined}
      testID={testID ? `${testID}-status` : undefined}
    >
      <View style={styles.statusPill}>
        <VinylRecord active={refreshing} reduceMotion={reduceMotion} elementRef={recordRef} />
        <Text ref={statusTextRef} style={styles.statusText}>
          {refreshing ? "REFRESHING" : "PULL TO REFRESH"}
        </Text>
      </View>
    </View>
  );
}

/**
 * Adds a custom pull gesture only to coarse, no-hover phone browsers. Native
 * platforms continue to use RefreshControl in VinylRefreshBoundary.jsx.
 */
export default function VinylRefreshBoundary({
  children,
  refreshing = false,
  onRefresh,
  enabled = true,
  accessibilityLabel = "Refresh this screen",
  indicatorOffset = 12,
  style,
  testID,
}) {
  const child = Children.only(children);
  const boundaryRef = useRef(null);
  const indicatorRef = useRef(null);
  const recordRef = useRef(null);
  const statusTextRef = useRef(null);
  const gestureRef = useRef(null);
  const mountedRef = useRef(true);
  const reduceMotionRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const enabledRef = useRef(enabled);
  const refreshingRef = useRef(!!refreshing);
  const refreshLatchRef = useRef({ active: false, promiseSettled: true });
  const [touchPhoneCapable, setTouchPhoneCapable] = useState(readTouchPhoneCapability);
  const [refreshLatched, setRefreshLatched] = useState(false);
  const indicatorRefs = { indicatorRef, recordRef, statusTextRef };

  onRefreshRef.current = onRefresh;
  enabledRef.current = enabled;
  refreshingRef.current = !!refreshing;

  const hideIndicator = useCallback(() => {
    hideWebRefreshIndicator(indicatorRefs, accessibilityLabel);
  // The ref objects are stable for the component lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibilityLabel]);

  const showPullIndicator = useCallback((gesture) => {
    showWebPullIndicator(indicatorRefs, {
      pullDistance: gesture.pullDistance,
      armed: gesture.armed,
      reduceMotion: reduceMotionRef.current,
      accessibilityLabel,
    });
  // The ref objects are stable for the component lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibilityLabel]);

  const showRefreshingIndicator = useCallback(() => {
    showWebRefreshingIndicator(indicatorRefs, accessibilityLabel);
  // The ref objects are stable for the component lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibilityLabel]);

  const cancelGesture = useCallback(() => {
    gestureRef.current = null;
    if (refreshLatchRef.current.active || refreshingRef.current) showRefreshingIndicator();
    else hideIndicator();
  }, [hideIndicator, showRefreshingIndicator]);

  const releaseRefreshLatch = useCallback(() => {
    const latch = refreshLatchRef.current;
    if (!latch.active || !canReleaseWebRefreshLatch({
      promiseSettled: latch.promiseSettled,
      refreshing: refreshingRef.current,
    })) return false;
    latch.active = false;
    hideIndicator();
    if (mountedRef.current) setRefreshLatched(false);
    return true;
  }, [hideIndicator]);

  const requestRefresh = useCallback(() => {
    const refresh = onRefreshRef.current;
    const latch = refreshLatchRef.current;
    if (latch.active || refreshingRef.current || !enabledRef.current || typeof refresh !== "function") {
      return false;
    }

    // Claim the latch before invoking app code so two releases in the same
    // event turn cannot start concurrent refreshes.
    latch.active = true;
    latch.promiseSettled = false;
    showRefreshingIndicator();
    if (mountedRef.current) setRefreshLatched(true);

    let refreshResult;
    try {
      refreshResult = refresh();
    } catch {
      // Native DOM event errors bypass React error boundaries. Treat a
      // synchronous callback failure exactly like a rejected refresh promise.
      latch.promiseSettled = true;
      releaseRefreshLatch();
      return true;
    }

    Promise.resolve(refreshResult).then(
      () => {
        latch.promiseSettled = true;
        releaseRefreshLatch();
      },
      () => {
        latch.promiseSettled = true;
        releaseRefreshLatch();
      },
    );
    return true;
  }, [releaseRefreshLatch, showRefreshingIndicator]);

  const handleReducedMotionChange = useCallback((reduceMotion) => {
    reduceMotionRef.current = reduceMotion;
    if (gestureRef.current?.status === "claimed") showPullIndicator(gestureRef.current);
    else if (refreshLatchRef.current.active || refreshingRef.current) showRefreshingIndicator();
  }, [showPullIndicator, showRefreshingIndicator]);

  useEffect(() => {
    // React development Strict Mode replays setup/cleanup once. Restore the
    // guard during setup so the real mount still receives discrete updates.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      gestureRef.current = null;
      refreshLatchRef.current.active = false;
    };
  }, []);

  useEffect(() => {
    if (refreshing) showRefreshingIndicator();
    else if (!releaseRefreshLatch() && !refreshLatchRef.current.active) hideIndicator();
  }, [hideIndicator, refreshing, releaseRefreshLatch, showRefreshingIndicator]);

  useEffect(() => {
    const initialCapability = readTouchPhoneCapability();
    setTouchPhoneCapable(initialCapability);
    if (!initialCapability) return undefined;

    const coarseQuery = window.matchMedia?.("(pointer: coarse)");
    const hoverQuery = window.matchMedia?.("(hover: none)");
    const updateCapability = () => {
      const next = readTouchPhoneCapability();
      setTouchPhoneCapable(next);
      if (!next) cancelGesture();
    };
    const unsubscribeCoarse = subscribeMediaQuery(coarseQuery, updateCapability);
    const unsubscribeHover = subscribeMediaQuery(hoverQuery, updateCapability);
    window.addEventListener("resize", updateCapability);
    window.addEventListener("orientationchange", updateCapability);

    return () => {
      unsubscribeCoarse();
      unsubscribeHover();
      window.removeEventListener("resize", updateCapability);
      window.removeEventListener("orientationchange", updateCapability);
      cancelGesture();
    };
  }, [cancelGesture]);

  const canRefresh = enabled && typeof onRefresh === "function";

  useEffect(() => {
    if (!touchPhoneCapable || !canRefresh) return undefined;
    const owner = boundaryRef.current?.firstElementChild;
    if (owner?.getAttribute?.("data-pit-refresh-scroll-owner") !== "true") return undefined;

    const passiveCaptureOptions = { capture: true, passive: true };
    const activeMoveOptions = { capture: true, passive: false };
    const ownerScrollTop = () => Number.isFinite(owner.scrollTop) ? owner.scrollTop : 0;

    const handleTouchStart = (event) => {
      if (refreshLatchRef.current.active || refreshingRef.current || !enabledRef.current) {
        cancelGesture();
        return;
      }
      const touch = event.touches?.[0];
      gestureRef.current = beginWebPullGesture({
        touchCount: event.touches?.length ?? 0,
        x: touch?.clientX,
        y: touch?.clientY,
        scrollTop: ownerScrollTop(),
      });
    };

    const handleTouchMove = (event) => {
      const current = gestureRef.current;
      if (!current) return;
      const touch = event.touches?.[0];
      const next = moveWebPullGesture(current, {
        touchCount: event.touches?.length ?? 0,
        x: touch?.clientX,
        y: touch?.clientY,
        scrollTop: ownerScrollTop(),
      });

      if (next.status === "cancelled") {
        gestureRef.current = next;
        hideIndicator();
        return;
      }
      if (next.status !== "claimed") {
        gestureRef.current = next;
        return;
      }

      const wasClaimed = current.status === "claimed";
      if (!event.cancelable && !wasClaimed) {
        // Safari already owns this sequence; never advertise a claim we cannot
        // enforce. Once claimed, the pure state retains ownership until end.
        cancelGesture();
        return;
      }
      gestureRef.current = next;
      if (event.cancelable && !event.defaultPrevented) event.preventDefault();
      showPullIndicator(next);
    };

    const handleTouchEnd = (event) => {
      const completed = gestureRef.current;
      const allTouchesReleased = (event.touches?.length ?? 0) === 0;
      cancelGesture();
      if (allTouchesReleased && shouldRefreshWebPullGesture(completed)) requestRefresh();
    };

    owner.addEventListener("touchstart", handleTouchStart, passiveCaptureOptions);
    owner.addEventListener("touchmove", handleTouchMove, activeMoveOptions);
    owner.addEventListener("touchend", handleTouchEnd, passiveCaptureOptions);
    owner.addEventListener("touchcancel", cancelGesture, passiveCaptureOptions);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelGesture();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange, true);
    window.addEventListener("pagehide", cancelGesture, true);
    window.addEventListener("blur", cancelGesture, true);

    return () => {
      owner.removeEventListener("touchstart", handleTouchStart, passiveCaptureOptions);
      owner.removeEventListener("touchmove", handleTouchMove, activeMoveOptions);
      owner.removeEventListener("touchend", handleTouchEnd, passiveCaptureOptions);
      owner.removeEventListener("touchcancel", cancelGesture, passiveCaptureOptions);
      document.removeEventListener("visibilitychange", handleVisibilityChange, true);
      window.removeEventListener("pagehide", cancelGesture, true);
      window.removeEventListener("blur", cancelGesture, true);
      cancelGesture();
    };
  }, [canRefresh, cancelGesture, hideIndicator, requestRefresh, showPullIndicator, touchPhoneCapable]);

  // Desktop, touch laptops, and tablets receive the caller's exact element.
  // That means no wrapper, marker, style merge, listener, or indicator exists.
  if (!touchPhoneCapable) return child;

  const scrollChild = cloneElement(child, {
    dataSet: { ...child.props.dataSet, pitRefreshScrollOwner: "true" },
    style: [child.props.style, styles.scrollOwner],
  });
  const refreshActive = !!refreshing || refreshLatched;

  return (
    <View ref={boundaryRef} style={[styles.boundary, style]} testID={testID}>
      {scrollChild}
      {canRefresh || refreshActive ? (
        <VinylRefreshIndicator
          refreshing={refreshActive}
          accessibilityLabel={accessibilityLabel}
          indicatorOffset={indicatorOffset}
          testID={testID}
          indicatorRef={indicatorRef}
          recordRef={recordRef}
          statusTextRef={statusTextRef}
          onReducedMotionChange={handleReducedMotionChange}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  boundary: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  scrollOwner: {
    overscrollBehaviorY: "contain",
  },
  statusPosition: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 20,
    alignItems: "center",
  },
  statusHidden: {
    opacity: 0,
    visibility: "hidden",
    transform: [{ translateY: 0 }],
  },
  statusVisible: {
    opacity: 1,
    visibility: "visible",
    transform: [{ translateY: 0 }],
  },
  statusPill: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgElev,
    ...shadow.control,
  },
  statusText: {
    color: colors.textDim,
    fontFamily: mono,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  record: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.textFaint,
    backgroundColor: vinylInk,
    overflow: "hidden",
    transform: [{ rotateZ: "0deg" }],
  },
  grooveOuter: {
    position: "absolute",
    width: "76%",
    height: "76%",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  grooveInner: {
    position: "absolute",
    width: "48%",
    height: "48%",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.textFaint,
  },
  recordLabel: {
    width: "34%",
    height: "34%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.amberStrong,
  },
  spindle: {
    width: 3,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  recordGlint: {
    position: "absolute",
    top: "14%",
    left: "20%",
    width: "30%",
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.textDim,
    opacity: 0.5,
    transform: [{ rotateZ: "-28deg" }],
  },
});
