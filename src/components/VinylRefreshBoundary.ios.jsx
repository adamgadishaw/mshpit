import useIOSDetailPresentation from "../hooks/useIOSDetailPresentation";
import { Children, cloneElement, useRef } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { colors } from "../theme";

// Use the platform pull indicator. A second absolute status badge obscured
// list headers and could be clipped by their scroll bounds.
export default function VinylRefreshBoundary({ children, refreshing = false, onRefresh, enabled = true, accessibilityLabel = "Refresh this screen", progressViewOffset = 0, style, testID }) {
  const { active, current, guard, token, canAct = current, commandToken = token } = useIOSDetailPresentation();
  const child = Children.only(children);
  const pending = useRef(null);
  const canRefresh = active && enabled && typeof onRefresh === "function";
  const requestRefresh = () => {
    if (!canAct() || !canRefresh || refreshing || pending.current?.token === commandToken) return;
    const request = { token: commandToken };
    pending.current = request;
    const settle = () => { if (pending.current === request) pending.current = null; };
    try {
      Promise.resolve(onRefresh()).then(settle, settle);
    } catch { settle(); }
  };
  const refreshControl = <RefreshControl refreshing={!!refreshing} onRefresh={guard(requestRefresh)} enabled={canRefresh} progressViewOffset={progressViewOffset} tintColor={colors.amber} colors={[colors.amber]} progressBackgroundColor={colors.bgElev} accessibilityLabel={accessibilityLabel} accessibilityHint="At the top, pull down past the indicator and release to refresh." title={refreshing ? "Refreshing…" : "Pull down and release to refresh"} />;
  const scrollChild = cloneElement(child, { refreshControl });
  return <View style={[styles.boundary, style]} testID={testID}>{scrollChild}</View>;
}
const styles = StyleSheet.create({ boundary: { flex: 1, minHeight: 0 } });
