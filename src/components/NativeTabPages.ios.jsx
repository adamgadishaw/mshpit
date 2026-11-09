import { memo, Suspense, useLayoutEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { NativeTabPreviewContext, NativeTabReadinessContext } from "./nativeTabPreviewContext.mjs";
import { pageTranslation } from "../domain/iosPageGeometry.mjs";
import { colors } from "../theme";

function Ready({ onReady, children }) {
  // This boundary only commits after the actual destination has resolved. A
  // loading fallback is never advertised as a ready page to the gesture.
  const laidOut = useRef(false);
  useLayoutEffect(() => { if (laidOut.current) onReady?.(); }, [onReady]);
  return <View style={styles.fill} onLayout={() => { laidOut.current = true; onReady?.(); }}>{children}</View>;
}
function NativeTabPage({ tab, active, position, origin, x, width, renderPage, loading, onReady, onContentReady }) {
  const preview = tab !== active;
  const motion = useAnimatedStyle(() => ({ transform: [{ translateX: pageTranslation(x.get(), width.get(), position - origin.get()) }] }));
  return <Animated.View testID={`main-tab-page-${tab}`} style={[styles.page, motion]}
    pointerEvents={preview ? "none" : "auto"}
    accessibilityElementsHidden={preview} importantForAccessibility={preview ? "no-hide-descendants" : "auto"}>
    <NativeTabPreviewContext.Provider value={preview}>
      <NativeTabReadinessContext.Provider value={preview ? onContentReady : null}><Suspense fallback={preview ? null : loading}><Ready onReady={preview ? onReady : null}>{renderPage(tab, preview)}</Ready></Suspense></NativeTabReadinessContext.Provider>
    </NativeTabPreviewContext.Provider>
  </Animated.View>;
}
export default memo(NativeTabPage);
const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0 }, page: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg, minHeight: 0 } });
