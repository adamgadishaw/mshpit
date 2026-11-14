import { Children, cloneElement, useCallback, useEffect, useRef } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { colors } from "../theme";
import { usePageReturn } from "./PageReturnContext";
import { assignScrollRef, scrollPageToTop } from "../domain/pageReturn.mjs";

// Use the platform pull indicator. A second absolute status badge obscured
// list headers and could be clipped by their scroll bounds.
export default function VinylRefreshBoundary({ children, refreshing = false, onRefresh, enabled = true, accessibilityLabel = "Refresh this screen", progressViewOffset = 0, style, testID }) {
  const child = Children.only(children);
  const page = usePageReturn();
  const scrollRef = useRef(null);
  const originalRef = child.props.ref;
  const composedRef = useCallback((value) => {
    scrollRef.current = value;
    assignScrollRef(originalRef, value);
  }, [originalRef]);
  const pending = useRef(false);
  const canRefresh = enabled && typeof onRefresh === "function";
  const requestRefresh = () => {
    if (!canRefresh || refreshing || pending.current) return;
    const request = {};
    pending.current = request;
    const settle = () => { if (pending.current === request) pending.current = false; };
    try {
      Promise.resolve(onRefresh()).then(settle, settle);
    } catch { settle(); }
  };
  const requestRef = useRef(requestRefresh);
  requestRef.current = requestRefresh;
  useEffect(() => () => { pending.current = false; }, [page]);
  useEffect(() => {
    const unregister = page?.register(() => {
      // Stop momentum immediately, even when the refresh is already pending.
      scrollPageToTop(scrollRef.current);
      requestRef.current();
    }, canRefresh);
    return unregister;
  }, [page, canRefresh]);
  // RefreshControl.enabled is Android-only. Remove the iOS control when no
  // refresh is available, while keeping title/tab gestures able to scroll.
  const refreshControl = canRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={requestRefresh} enabled={canRefresh} progressViewOffset={progressViewOffset} tintColor={colors.amber} colors={[colors.amber]} progressBackgroundColor={colors.bgElev} accessibilityLabel={accessibilityLabel} accessibilityHint="At the top, pull down past the indicator and release to refresh." title={refreshing ? "Refreshing…" : "Pull down and release to refresh"} /> : undefined;
  const scrollChild = cloneElement(child, { ref: composedRef, refreshControl });
  return <View style={[styles.boundary, style]} testID={testID}>{scrollChild}</View>;
}
const styles = StyleSheet.create({ boundary: { flex: 1, minHeight: 0 } });
