import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Dimensions, Platform } from "react-native";
import { posterBoundsAreViewable } from "../domain/posterVisibility.mjs";

const NATIVE_VISIBILITY_POLL_MS = 450;

// Virtualized surfaces pass an explicit viewability boolean. Plain ScrollViews
// use IntersectionObserver on web and a bounded measureInWindow poll on native,
// which is intentionally far cheaper than starting a video decoder offscreen.
export default function usePosterViewability(explicitViewable = null) {
  const targetRef = useRef(null);
  const mountedRef = useRef(false);
  const measurementEpochRef = useRef(0);
  const explicitRef = useRef(false);
  const [autoViewable, setAutoViewable] = useState(false);
  const hasExplicitViewability = explicitViewable === true || explicitViewable === false;
  // An explicit answer already owns the visibility decision. Fence any delayed
  // measurement for both true and false so a stale native callback cannot
  // overwrite it after a virtualized surface advances to another item.
  explicitRef.current = hasExplicitViewability;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      measurementEpochRef.current += 1;
    };
  }, []);

  const measureNative = useCallback(() => {
    if (!mountedRef.current || explicitRef.current || Platform.OS === "web") return;
    const measurementEpoch = ++measurementEpochRef.current;
    const target = targetRef.current;
    if (!target?.measureInWindow) {
      if (mountedRef.current && measurementEpoch === measurementEpochRef.current) setAutoViewable(false);
      return;
    }
    target.measureInWindow((x, y, width, height) => {
      if (!mountedRef.current || explicitRef.current || measurementEpoch !== measurementEpochRef.current) return;
      const viewport = Dimensions.get("window");
      setAutoViewable(posterBoundsAreViewable({
        x,
        y,
        width,
        height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      }));
    });
  }, [hasExplicitViewability]);

  useEffect(() => {
    if (hasExplicitViewability) {
      measurementEpochRef.current += 1;
      setAutoViewable(false);
      return undefined;
    }

    if (Platform.OS === "web" && typeof IntersectionObserver === "function") {
      const target = targetRef.current;
      if (!target) return undefined;
      const observerEpoch = ++measurementEpochRef.current;
      const observer = new IntersectionObserver((entries) => {
        if (!mountedRef.current || explicitRef.current || observerEpoch !== measurementEpochRef.current) return;
        const entry = entries[0];
        setAutoViewable(!!(entry?.isIntersecting && entry.intersectionRatio > 0));
      }, { threshold: [0, 0.01] });
      observer.observe(target);
      return () => {
        measurementEpochRef.current += 1;
        observer.disconnect();
      };
    }

    if (Platform.OS === "web") {
      // Very old webviews without IntersectionObserver get a deterministic
      // branded cover; they never earn permission to decode a video offscreen.
      setAutoViewable(false);
      return undefined;
    }

    let active = true;
    let timer = null;
    const inspect = () => {
      if (!active) return;
      if (AppState.currentState === "active") measureNative();
      else {
        measurementEpochRef.current += 1;
        if (mountedRef.current) setAutoViewable(false);
      }
      timer = setTimeout(inspect, NATIVE_VISIBILITY_POLL_MS);
    };
    inspect();
    const subscription = AppState.addEventListener?.("change", (state) => {
      if (state !== "active") {
        measurementEpochRef.current += 1;
        if (mountedRef.current) setAutoViewable(false);
      }
      else measureNative();
    });
    return () => {
      active = false;
      measurementEpochRef.current += 1;
      if (timer) clearTimeout(timer);
      subscription?.remove?.();
    };
  }, [hasExplicitViewability, measureNative]);

  return {
    targetRef,
    // Callers with authoritative viewability never need a 450 ms measurement
    // loop just to rediscover the answer they already supplied.
    autoViewable: explicitViewable === true ? true : autoViewable,
    onLayout: hasExplicitViewability || Platform.OS === "web" ? undefined : measureNative,
  };
}
