import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font } from "../theme";
import { iosFeedFilterChoices, iosMenuSections } from "../domain/iosMenuSections.mjs";
import Avatar from "./Avatar";
import BrandMark from "./BrandMark";
import Icon from "./Icon";
import useReducedMotion from "../hooks/useReducedMotion";

// Modal isolates accessibility and leaves the originating list mounted at its
// exact scroll position. All destinations remain permission-filtered by model.
export default function IosMenuDrawer({ visible, onClose, openerRef, session, unread, activity, actions, onProfile, onLogin, onLogout, feedFilter = "everyone", onSelectFeedFilter }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const closeRef = useRef(null);
  const liveInterval = useRef(null), mounted = useRef(false);
  const interval = useMemo(() => ({ visible, reason: null, dismissal: null }), [visible, session?.id]);
  const renderInterval = useRef(interval);
  renderInterval.current = interval;
  const scope = session?.id || "guest";
  const [disclosure, setDisclosure] = useState({ scope, expanded: false });
  const expanded = disclosure.scope === scope && disclosure.expanded;
  const choices = iosFeedFilterChoices(feedFilter);
  const selectedFeed = choices.find(item => item.selected)?.title || "For You";
  const admitted = () => mounted.current && renderInterval.current === interval && liveInterval.current === interval && interval.visible && !interval.reason;
  useLayoutEffect(() => {
    // Carry the closing presentation into its hidden render, but never into a
    // later opening. Native dismissal can arrive after navigation or reopening.
    if (!interval.visible && liveInterval.current !== interval) interval.dismissal = liveInterval.current;
    liveInterval.current = interval;
  }, [interval]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const menuActions = { ...actions, signOut: session ? onLogout : undefined };
  const sections = iosMenuSections({ session, inboxUnread: unread, notifications: activity, actions: menuActions });
  const focus = ref => { const node = findNodeHandle(ref?.current); if (node) AccessibilityInfo.setAccessibilityFocus(node); };
  const close = () => {
    if (!admitted()) return;
    interval.reason = "cancel";
    onClose();
  };
  const choose = action => {
    if (!admitted()) return;
    interval.reason = "destination";
    onClose();
    action?.();
  };
  const dismiss = () => {
    const owner = interval.visible ? interval : interval.dismissal;
    const live = liveInterval.current;
    if (!mounted.current || !owner || !live || (live !== owner && live.dismissal !== owner) || owner.reason !== "cancel") return;
    owner.reason = "dismissed";
    focus(openerRef);
  };
  const group = (title, items) => <View style={styles.group} key={title}>
    <Text style={styles.section} accessibilityRole="header">{title}</Text>
    <View style={styles.rows}>{items.map((item, index, list) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`${item.title}${item.badge ? `, ${item.badge} unread` : ""}`} accessibilityHint={item.detail} onPress={() => choose(menuActions[item.key])} style={({ pressed }) => [styles.row, index < list.length - 1 && styles.divider, pressed && styles.pressed]}>
      <Icon name={item.icon} size={20} color={item.key === "signOut" ? colors.danger : colors.amber} strokeWidth={1.8} />
      <Text style={[styles.rowTitle, item.key === "signOut" && styles.signOutText]}>{item.title}</Text>
      {!!item.badge && <Text style={styles.badge}>{item.badge > 99 ? "99+" : item.badge}</Text>}
      <Icon name="chevron-right" size={15} color={colors.textFaint} />
    </Pressable>)}</View>
  </View>;
  return <Modal visible={visible} transparent animationType={reduced ? "none" : "fade"} presentationStyle="overFullScreen" onRequestClose={close} onShow={() => { if (mounted.current && liveInterval.current === interval && interval.visible && !interval.reason) focus(closeRef); }} onDismiss={dismiss}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close side menu" />
      <View style={[styles.panel, { width: Math.min(390, width - 40), paddingTop: insets.top + 8, paddingBottom: insets.bottom }]} accessibilityViewIsModal onAccessibilityEscape={close}>
        <View style={styles.heading}><View style={styles.brand}><BrandMark size={23} color={colors.amber} /><Text style={styles.wordmark}>MSHPIT</Text></View><Pressable ref={closeRef} onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close side menu"><Icon name="x" size={22} color={colors.textDim} /></Pressable></View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => choose(session ? onProfile : onLogin)} style={styles.identity} accessibilityRole="button" accessibilityLabel={session ? `View ${session.name}'s profile` : "Sign in to Mshpit"}>
            {session ? <Avatar user={session} size={52} /> : <View style={styles.guest}><Icon name="you" size={26} color={colors.amber} /></View>}
            <View style={styles.identityCopy}><Text style={styles.name} numberOfLines={2}>{session?.name || "Your music. Your people."}</Text><Text style={styles.handle}>{session ? `@${session.handle}` : "Sign in to join in"}</Text></View>
            <Icon name="chevron-right" size={18} color={colors.textFaint} />
          </Pressable>
          {(session ? typeof onSelectFeedFilter === "function" : typeof onLogin === "function") && <View style={styles.group}>
            <View style={styles.rows}>
              <Pressable onPress={() => { if (admitted()) setDisclosure({ scope, expanded: !expanded }); }} style={({ pressed }) => [styles.row, expanded && styles.divider, pressed && styles.pressed]}
                accessibilityRole="button" accessibilityLabel="Feed filters" accessibilityHint={session ? `Current feed: ${selectedFeed}. Choose which posts to read.` : "Sign in to personalize your feed"}
                accessibilityState={{ expanded }}>
                <Icon name="feed" size={20} color={colors.amber} />
                <View style={styles.feedTitle}><Text style={styles.rowTitle}>Feed</Text><Text style={styles.feedSelected}>{session ? selectedFeed : "Sign in to personalize"}</Text></View>
                <Icon name={expanded ? "chevron-down" : "chevron-right"} size={16} color={colors.textDim} />
              </Pressable>
              {expanded && (session ? <View accessibilityRole="radiogroup" accessibilityLabel="Choose your feed">
                {choices.map((item, index) => <Pressable key={item.key} onPress={() => choose(() => onSelectFeedFilter(item.key))}
                  style={({ pressed }) => [styles.row, styles.feedOption, index < choices.length - 1 && styles.divider, pressed && styles.pressed]}
                  accessibilityRole="radio" accessibilityLabel={item.title} accessibilityHint={item.detail} accessibilityState={{ checked: item.selected }}>
                  <Icon name={item.icon} size={19} color={item.selected ? colors.amber : colors.textDim} />
                  <Text style={[styles.rowTitle, item.selected && styles.feedChecked]}>{item.title}</Text>
                  {item.selected && <Icon name="check" size={18} color={colors.amber} />}
                </Pressable>)}
              </View> : <View style={styles.feedGuest}>
                <Text style={styles.feedSelected}>Sign in to see posts from people you follow, your city, and artists you love.</Text>
                <Pressable onPress={() => choose(onLogin)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Sign in for your feed">
                  <Text style={styles.feedChecked}>Sign in</Text><Icon name="chevron-right" size={16} color={colors.amber} />
                </Pressable>
              </View>)}
            </View>
          </View>}
          {sections.map(section => group(section.title, section.items))}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.48)" }, panel: { flex: 1, backgroundColor: colors.bgElev, borderTopRightRadius: 24, borderBottomRightRadius: 24, overflow: "hidden" },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 }, brand: { flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }, wordmark: { flexShrink: 1, color: colors.text, fontFamily: font, fontSize: 17, fontWeight: "800", letterSpacing: 1.8 }, close: { flexShrink: 0, width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  content: { padding: 20, paddingTop: 10, paddingBottom: 30 }, identity: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 18 }, identityCopy: { flex: 1, minWidth: 0 }, guest: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" }, name: { fontFamily: font, color: colors.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 }, handle: { flexShrink: 1, color: colors.textDim, fontSize: 14, marginTop: 5 },
  feedTitle: { flex: 1, minWidth: 0 }, feedSelected: { color: colors.textDim, fontSize: 13, lineHeight: 19 }, feedOption: { paddingLeft: 24 }, feedChecked: { color: colors.amber, fontWeight: "600" }, feedGuest: { paddingHorizontal: 12, paddingTop: 12 },
  group: { marginTop: 20 }, section: { color: colors.textDim, fontSize: 13, fontWeight: "600", marginBottom: 8, paddingLeft: 12 }, rows: { backgroundColor: colors.surface, borderRadius: 16, overflow: "hidden" }, row: { minHeight: 52, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", gap: 12, alignItems: "center" }, divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft }, rowTitle: { flex: 1, color: colors.text, fontFamily: font, fontSize: 16, lineHeight: 21 }, badge: { color: colors.amber, fontSize: 13, fontWeight: "700" }, pressed: { backgroundColor: colors.surfaceAlt }, signOutText: { color: colors.danger, fontSize: 16 },
});
