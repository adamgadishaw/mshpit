import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Icon from "./Icon";
import NativeTabRail from "./NativeTabRail";
import { colors, font } from "../theme";
const tabs = [{ key: "feed", label: "Feed", icon: "feed" }, { key: "search", label: "Search", icon: "search" }, { key: "discover", label: "Discover", icon: "discover" }, { key: "you", label: "You", icon: "you" }];
export default function IosTabBar({ active, onChange, swipeScope, swipeEnabled, isCurrentSwipeRoute }) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.6;
  return <NativeTabRail active={active} onChange={onChange} swipeScope={swipeScope} swipeEnabled={swipeEnabled} isCurrentSwipeRoute={isCurrentSwipeRoute}><View style={[styles.bar, largeText && styles.largeBar]} accessibilityRole="tablist" accessibilityLabel="Main navigation">
    {tabs.map(tab => <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={({ pressed }) => [styles.tab, largeText && styles.largeTab, pressed && styles.pressed]} accessibilityRole="tab" accessibilityState={{ selected: active === tab.key }} accessibilityLabel={tab.label}>
      <View style={[styles.icon, largeText && styles.largeIcon, active === tab.key && styles.selected]}><Icon name={tab.icon} size={23} color={active === tab.key ? colors.amber : colors.textDim} strokeWidth={active === tab.key ? 2.2 : 1.7} /></View>
      <Text style={[styles.label, active === tab.key && styles.active]}>{tab.label}</Text>
    </Pressable>)}
  </View></NativeTabRail>;
}
const styles = StyleSheet.create({
  bar: { flexDirection: "row", paddingTop: 5, paddingBottom: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.lineSoft, backgroundColor: colors.bg },
  tab: { flex: 1, minWidth: 0, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 2 },
  icon: { paddingHorizontal: 18, paddingVertical: 4, borderRadius: 18 }, selected: { backgroundColor: colors.surfaceAlt },
  largeBar: { flexWrap: "wrap" }, largeTab: { flexBasis: "45%", flexDirection: "row", paddingHorizontal: 10, gap: 6 }, largeIcon: { paddingHorizontal: 6 },
  label: { flexShrink: 1, textAlign: "center", fontFamily: font, fontSize: 11, fontWeight: "500", color: colors.textDim }, active: { color: colors.amber, fontWeight: "600" }, pressed: { opacity: 0.65 },
});
