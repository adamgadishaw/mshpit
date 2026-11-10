import { useLayoutEffect } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions } from "react-native";
import Animated, { scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { ScrollView } from "../NativeTabScroll";
import { DISCOVER_PROGRAMME_SECTIONS } from "../../domain/discoverProgramme.mjs";
import { discoverTabFrame, discoverTabPosition, discoverTabScroll } from "../../domain/iosDiscoverTabGeometry.mjs";
import useReducedMotion from "../../hooks/useReducedMotion";
import { colors } from "../../theme";

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);
const sections = DISCOVER_PROGRAMME_SECTIONS;

export default function DiscoverSectionTabs(props) {
  const { width, fontScale } = useWindowDimensions();
  // A new measurement generation cannot mix old and new Dynamic Type widths.
  // Only the strip remounts; the source and preview pages keep their ownership.
  return <MeasuredTabs key={`${width}:${fontScale}`} {...props} />;
}
function MeasuredTabs({ selected, onSelect, onInteraction, enabled, x, width, origin }) {
  const reduced = useReducedMotion();
  const scroll = useAnimatedRef();
  const frames = useSharedValue([]), viewport = useSharedValue(0), contentWidth = useSharedValue(0);
  const manual = useSharedValue(false);
  useLayoutEffect(() => { if (!enabled) manual.set(false); }, [enabled, manual]);
  const index = Math.max(0, sections.findIndex(section => section.key === selected));
  const indicator = useAnimatedStyle(() => {
    const position = reduced || !enabled ? index : discoverTabPosition(x.get(), width.get(), origin.get(), sections.length);
    const frame = discoverTabFrame(frames.get(), position);
    return { opacity: frame ? 1 : 0, width: frame?.width || 0, transform: [{ translateX: frame?.x || 0 }] };
  });
  useAnimatedReaction(() => {
    const position = reduced || !enabled ? index : discoverTabPosition(x.get(), width.get(), origin.get(), sections.length);
    const frame = discoverTabFrame(frames.get(), position);
    return { enabled, position, frame, viewport: viewport.get(), contentWidth: contentWidth.get() };
  }, (next, previous) => {
    if (!next.enabled || manual.get() || !next.frame) return;
    if (previous && next.enabled === previous.enabled && next.position === previous.position && next.frame.x === previous.frame?.x
      && next.frame.width === previous.frame?.width && next.viewport === previous.viewport && next.contentWidth === previous.contentWidth) return;
    // UI-thread scroll is synchronous with the moving selection, never a second
    // competing timing animation. Manual browsing does not change dependencies.
    scrollTo(scroll, discoverTabScroll(next.frame, next.viewport, next.contentWidth), 0, false);
  });
  const manualScroll = useAnimatedScrollHandler({
    onBeginDrag: () => { manual.set(true); if (onInteraction) scheduleOnRN(onInteraction); },
    onEndDrag: () => manual.set(false), onMomentumEnd: () => manual.set(false),
  });
  return <AnimatedScrollView ref={scroll} horizontal directionalLockEnabled bounces={false}
    scrollEnabled={enabled} showsHorizontalScrollIndicator={false} contentInsetAdjustmentBehavior="never"
    keyboardShouldPersistTaps="handled" accessibilityRole="tablist" accessibilityLabel="Discover sections"
    testID="discover-section-tabs" style={styles.segment} contentContainerStyle={styles.content}
    onLayout={event => viewport.set(event.nativeEvent.layout.width)} onContentSizeChange={value => contentWidth.set(value)}
    onScroll={manualScroll} scrollEventThrottle={16}>
    <Animated.View testID="discover-section-indicator" pointerEvents="none" accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.indicator, indicator]} />
    {sections.map((section, tabIndex) => <Pressable key={section.key} nativeID={`discover-tab-${section.key}`}
      disabled={!enabled} accessibilityRole="tab" accessibilityLabel={section.label}
      accessibilityState={{ selected: selected === section.key, disabled: !enabled }}
      onLayout={event => {
        const { x: left, width: size } = event.nativeEvent.layout;
        const next = [...frames.get()]; next[tabIndex] = { x: left, width: size }; frames.set(next);
      }} onPress={() => onSelect(section.key)} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <Text style={[styles.label, selected === section.key && styles.selectedLabel]}>{section.label}</Text>
    </Pressable>)}
  </AnimatedScrollView>;
}
const styles = StyleSheet.create({
  // Feed's native segment colors, 13/10-point corners and 44-point targets.
  segment: { direction: "ltr", flexGrow: 0, marginHorizontal: 12, marginTop: 8, marginBottom: 12, borderRadius: 13, backgroundColor: colors.surfaceAlt },
  // The page rail uses physical left/right coordinates. Keep that same order
  // under RTL instead of reversing only the labels and contradicting its pan.
  content: { flexDirection: "row", direction: "ltr", padding: 3 },
  tab: { minWidth: 76, minHeight: 44, paddingVertical: 8, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  indicator: { position: "absolute", left: 0, top: 3, bottom: 3, borderRadius: 10, backgroundColor: colors.bgElev },
  label: { color: colors.textDim, fontSize: 13, fontWeight: "600", textAlign: "center" },
  selectedLabel: { color: colors.text }, pressed: { opacity: .66 },
});
