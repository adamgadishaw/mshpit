import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font } from "../../theme";
import Icon from "../Icon";
import useReducedMotion from "../../hooks/useReducedMotion";

const GROUPS = [
  ["Review", ["overview", "reports", "members", "artist_alerts", "requests"]],
  ["Publishing", ["content", "catalog", "newsroom", "cities", "memorials"]],
  ["Operations", ["analytics", "email", "badges", "suggestions"]],
];
const badgeMeaning = key => key === "members" ? "banned" : key === "requests" || key === "artist_alerts" ? "pending" : "open";

// Only navigation lives here. The existing screen remains the owner of the
// filtered destinations, server reads, confirmations, and moderation commands.
// Its account/role key retires this entire presentation on any scope change.
export default function IosModerationNavigation({ session, tabs = [], activeTab, onChange, onClose }) {
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const openerRef = useRef(null), closeRef = useRef(null), headingRef = useRef(null);
  const mounted = useRef(false), liveInterval = useRef(null);
  const allowed = session?.role === "admin" || session?.role === "moderator";
  const available = allowed ? tabs.filter(tab => session.role === "admin" || !tab.admin) : [];
  const current = available.find(tab => tab.key === activeTab);
  const latest = useRef(null);
  latest.current = { available, onChange, onClose, allowed };
  const interval = useMemo(() => ({ visible, reason: null, dismissal: null }), [visible]);
  useLayoutEffect(() => {
    if (!interval.visible && liveInterval.current !== interval) interval.dismissal = liveInterval.current;
    liveInterval.current = interval;
  }, [interval]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const focus = ref => { const node = findNodeHandle(ref.current); if (node) AccessibilityInfo.setAccessibilityFocus(node); };
  const ownsOpen = () => mounted.current && latest.current.allowed && liveInterval.current === interval && interval.visible && !interval.reason;
  const open = () => {
    if (!mounted.current || !latest.current.allowed || interval.visible || liveInterval.current !== interval) return;
    Keyboard.dismiss();
    setVisible(true);
  };
  const close = () => {
    if (!ownsOpen()) return;
    interval.reason = "cancel";
    setVisible(false);
  };
  const choose = key => {
    if (!ownsOpen() || !latest.current.available.some(tab => tab.key === key)) return;
    interval.reason = "destination";
    setVisible(false);
    latest.current.onChange(key);
  };
  const dismiss = () => {
    const owner = interval.visible ? interval : interval.dismissal;
    const live = liveInterval.current;
    if (!mounted.current || !latest.current.allowed || !owner || !live || (live !== owner && live.dismissal !== owner)) return;
    const reason = owner.reason;
    if (reason !== "cancel" && reason !== "destination") return;
    owner.reason = "dismissed";
    focus(reason === "cancel" ? openerRef : headingRef);
  };
  if (!allowed) return null;

  return <>
    <View style={[styles.header, { paddingLeft: Math.max(12, insets.left), paddingRight: Math.max(12, insets.right) }]} testID="ios-moderation-header">
      <Pressable onPress={() => { if (mounted.current && latest.current.allowed && !liveInterval.current?.visible) latest.current.onClose(); }} style={styles.control} accessibilityRole="button" accessibilityLabel="Back from moderation">
        <Icon name="chevron-left" size={22} color={colors.text} />
      </Pressable>
      <View style={styles.headingCopy}>
        <Text style={styles.eyebrow}>MODERATION</Text>
        <Text ref={headingRef} accessible accessibilityRole="header" style={styles.title}>{current?.label || "Moderation"}</Text>
      </View>
      <Pressable ref={openerRef} onPress={open} style={styles.control} accessibilityRole="button" accessibilityLabel="Open moderation menu" accessibilityHint="Opens moderation sections from the right side" accessibilityState={{ expanded: visible }}>
        <Icon name="menu" size={24} color={colors.amber} />
      </Pressable>
    </View>
    <Modal visible={visible} transparent animationType={reduced ? "none" : "fade"} presentationStyle="overFullScreen" onRequestClose={close} onShow={() => { if (ownsOpen()) focus(closeRef); }} onDismiss={dismiss}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
        <View style={[styles.panel, { width: Math.min(fontScale > 1.3 ? 480 : 390, Math.max(0, width - insets.left - insets.right - 24)), marginRight: insets.right, paddingTop: insets.top + 8, paddingBottom: insets.bottom }]} accessibilityViewIsModal onAccessibilityEscape={close} testID="ios-moderation-drawer">
          <View style={styles.drawerHeader}>
            <View style={styles.headingCopy}><Text style={styles.drawerTitle} accessibilityRole="header">Moderation menu</Text><Text style={styles.role}>{session.role === "admin" ? "Administrator" : "Moderator"}</Text></View>
            <Pressable ref={closeRef} onPress={close} style={styles.control} accessibilityRole="button" accessibilityLabel="Close moderation menu"><Icon name="x" size={22} color={colors.text} /></Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
            {GROUPS.map(([label, keys]) => {
              const items = available.filter(tab => keys.includes(tab.key));
              return items.length ? <View key={label} style={styles.group}>
                <Text accessibilityRole="header" style={styles.groupLabel}>{label}</Text>
                {items.map(tab => <Pressable key={tab.key} accessibilityRole="button" accessibilityLabel={`${tab.label}${tab.badge ? `, ${tab.badge} ${badgeMeaning(tab.key)}` : ""}`} accessibilityState={{ selected: tab.key === activeTab }} onPress={() => choose(tab.key)} style={({ pressed }) => [styles.row, tab.key === activeTab && styles.selected, pressed && styles.pressed]}>
                  <Icon name={tab.icon} size={20} color={colors.amber} />
                  <View style={styles.rowCopy}><Text style={styles.rowTitle}>{tab.label}</Text>{!!tab.badge && <Text style={styles.count}>{tab.badge} {badgeMeaning(tab.key)}</Text>}</View>
                  {tab.key === activeTab && <Icon name="check" size={18} color={colors.amber} />}
                </Pressable>)}
              </View> : null;
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft },
  control: { flexShrink: 0, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { color: colors.textDim, fontFamily: font, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  title: { color: colors.text, fontFamily: font, fontSize: 19, fontWeight: "700" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.48)", alignItems: "flex-end" },
  panel: { flex: 1, minHeight: 0, backgroundColor: colors.bgElev, borderTopLeftRadius: 20, borderBottomLeftRadius: 20, overflow: "hidden" },
  drawerHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingLeft: 20, paddingRight: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft },
  drawerTitle: { color: colors.text, fontFamily: font, fontSize: 20, fontWeight: "700" },
  role: { color: colors.textDim, fontSize: 13 },
  scroll: { flex: 1, minHeight: 0 },
  content: { padding: 16, paddingBottom: 24, gap: 24 },
  group: { gap: 6 },
  groupLabel: { color: colors.textDim, fontSize: 13, fontWeight: "700", paddingHorizontal: 12, marginBottom: 4 },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10 },
  selected: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.7 },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { color: colors.text, fontFamily: font, fontSize: 16, fontWeight: "600" },
  count: { color: colors.amber, fontSize: 12 },
});
