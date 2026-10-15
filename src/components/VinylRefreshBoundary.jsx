import { Children, cloneElement, useRef } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { colors } from "../theme";

// Use the platform pull indicator. A second absolute status badge obscured
// list headers and could be clipped by their scroll bounds.
export default function VinylRefreshBoundary({ children, refreshing = false, onRefresh, enabled = true, accessibilityLabel = "Refresh this screen", progressViewOffset = 0, style, testID }) {
  const child = Children.only(children);
  const pending = useRef(false);
  const canRefresh = enabled && typeof onRefresh === "function";
  const requestRefresh = () => {
    if (!canRefresh || refreshing || pending.current) return;
    pending.current = true;
    try {
      Promise.resolve(onRefresh()).then(() => { pending.current = false; }, () => { pending.current = false; });
    } catch { pending.current = false; }
  };
  const refreshControl = <RefreshControl refreshing={!!refreshing} onRefresh={requestRefresh} enabled={canRefresh} progressViewOffset={progressViewOffset} tintColor={colors.amber} colors={[colors.amber]} progressBackgroundColor={colors.bgElev} accessibilityLabel={accessibilityLabel} />;
  const scrollChild = cloneElement(child, { refreshControl });
  return <View style={[styles.boundary, style]} testID={testID}>{scrollChild}</View>;
}
const styles = StyleSheet.create({ boundary: { flex: 1, minHeight: 0 } });
