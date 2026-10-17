import { useRef } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, focusRing, font, radius, space } from "../../theme";
import Icon from "../Icon";
import { DISCOVER_PROGRAMME_SECTIONS, discoverProgrammeKeyboardTarget } from "../../domain/discoverProgramme.mjs";

export default function DiscoverProgrammeNav({ selected, onSelect, compact = false }) {
  const tabs = useRef({});
  const scrollRef = useRef(null);
  const tabOffsets = useRef({});
  const { width, fontScale } = useWindowDimensions();
  // Preserve larger text and whole words instead of squeezing six equal cells.
  const scrollable = Platform.OS !== "web" && compact && (width < 390 || fontScale > 1);
  const content = (
    <View style={[styles.shell, scrollable && styles.scrollShell]} accessibilityRole="tablist" accessibilityLabel="Discover sections">
      {DISCOVER_PROGRAMME_SECTIONS.map((section) => {
        const active = selected === section.key;
        return (
          <Pressable
            key={section.key}
            ref={(node) => { tabs.current[section.key] = node; }}
            nativeID={`discover-tab-${section.key}`}
            accessibilityRole="tab"
            accessibilityLabel={section.label}
            accessibilityState={{ selected: active }}
            {...(Platform.OS === "web" ? {
              tabIndex: active ? 0 : -1,
              "aria-selected": active,
              "aria-controls": `discover-panel-${section.key}`,
              onKeyDown: (event) => {
                const next = discoverProgrammeKeyboardTarget(section.key, event.key);
                if (!next) return;
                event.preventDefault();
                onSelect(next);
                tabs.current[next]?.focus?.();
              },
            } : {})}
            onLayout={scrollable ? (event) => {
              const x = event.nativeEvent.layout.x;
              tabOffsets.current[section.key] = x;
              if (active) scrollRef.current?.scrollTo?.({ x: Math.max(0, x - 8), animated: false });
            } : undefined}
            onPress={() => {
              onSelect(section.key);
              if (scrollable) scrollRef.current?.scrollTo?.({ x: Math.max(0, (tabOffsets.current[section.key] || 0) - 8), animated: true });
            }}
            style={({ pressed, focused }) => [styles.tab, compact && styles.tabCompact, scrollable && styles.tabScrollable, scrollable && { minWidth: Math.ceil(70 * fontScale) }, active && styles.tabActive, pressed && styles.pressed, focused && focusRing]}
          >
            <Icon name={section.icon} size={compact ? 17 : 18} color={active ? colors.amber : colors.textDim} />
            <Text numberOfLines={scrollable ? 1 : undefined} style={[styles.label, compact && styles.labelCompact, active && styles.labelActive]}>{section.label}</Text>
            {active ? <View pointerEvents="none" style={styles.marker} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
  return scrollable ? <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scrollContent} style={styles.scrollViewport}>{content}</ScrollView> : content;
}

const styles = StyleSheet.create({
  shell: { flexDirection: "row", width: "100%", minWidth: 0, padding: space(1), gap: space(1), borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  tab: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2), paddingHorizontal: space(2), paddingVertical: space(3), borderRadius: radius.sm, borderCurve: "continuous" },
  tabCompact: { minHeight: 58, flexDirection: "column", gap: space(1), paddingHorizontal: space(1), paddingVertical: space(2) },
  scrollViewport: { width: "100%", flexGrow: 0 },
  scrollContent: { minWidth: "100%" },
  scrollShell: { width: "auto", minWidth: "100%" },
  tabScrollable: { flex: 0, flexShrink: 0 },
  tabActive: { backgroundColor: colors.surfaceAlt },
  label: { color: colors.textDim, fontFamily: font, fontSize: 13, fontWeight: "800" },
  labelCompact: { fontSize: 11 },
  labelActive: { color: colors.text },
  marker: { position: "absolute", bottom: 0, height: 2, width: 20, borderRadius: radius.pill, backgroundColor: colors.amber },
  pressed: { opacity: 0.72 },
});
