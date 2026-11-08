import { useRef } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font } from "../theme";
import { journeyMenuModel } from "../domain/menuJourney.mjs";
import Avatar from "./Avatar";
import BrandMark from "./BrandMark";
import Icon from "./Icon";
import useReducedMotion from "../hooks/useReducedMotion";

// Modal isolates accessibility and leaves the originating list mounted at its
// exact scroll position. All destinations remain permission-filtered by model.
export default function IosMenuDrawer({ visible, onClose, openerRef, session, unread, activity, actions, onProfile, onLogin, onLogout }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const closeRef = useRef(null);
  const model = journeyMenuModel({ session, inboxUnread: unread, notifications: activity, includeCrew: !!actions.crew });
  const focus = ref => { const node = findNodeHandle(ref?.current); if (node) AccessibilityInfo.setAccessibilityFocus(node); };
  const choose = action => { onClose(); action?.(); };
  const group = (title, items) => <View style={styles.group} key={title}>
    <Text style={styles.section} accessibilityRole="header">{title}</Text>
    <View style={styles.rows}>{items.filter(item => actions[item.key]).map((item, index, list) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`${item.title}${item.badge ? `, ${item.badge} unread` : ""}`} onPress={() => choose(actions[item.key])} style={({ pressed }) => [styles.row, index < list.length - 1 && styles.divider, pressed && styles.pressed]}>
      <Icon name={item.icon} size={20} color={colors.amber} strokeWidth={1.8} />
      <Text style={styles.rowTitle}>{item.title}</Text>
      {!!item.badge && <Text style={styles.badge}>{item.badge > 99 ? "99+" : item.badge}</Text>}
      <Icon name="chevron-right" size={15} color={colors.textFaint} />
    </Pressable>)}</View>
  </View>;
  return <Modal visible={visible} transparent animationType={reduced ? "none" : "fade"} presentationStyle="overFullScreen" onRequestClose={onClose} onShow={() => focus(closeRef)} onDismiss={() => focus(openerRef)}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close side menu" />
      <View style={[styles.panel, { width: Math.min(390, width - 40), paddingTop: insets.top + 8, paddingBottom: insets.bottom }]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={styles.heading}><View style={styles.brand}><BrandMark size={23} color={colors.amber} /><Text style={styles.wordmark}>MSHPIT</Text></View><Pressable ref={closeRef} onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close side menu"><Icon name="x" size={22} color={colors.textDim} /></Pressable></View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => choose(session ? onProfile : onLogin)} style={styles.identity} accessibilityRole="button" accessibilityLabel={session ? `View ${session.name}'s profile` : "Sign in to Mshpit"}>
            {session ? <Avatar user={session} size={52} /> : <View style={styles.guest}><Icon name="you" size={26} color={colors.amber} /></View>}
            <View style={styles.identityCopy}><Text style={styles.name} numberOfLines={2}>{session?.name || "Your music. Your people."}</Text><Text style={styles.handle}>{session ? `@${session.handle}` : "Sign in to join in"}</Text></View>
            <Icon name="chevron-right" size={18} color={colors.textFaint} />
          </Pressable>
          {group("Explore", model.discover)}
          {group("Community", [...model.connection, ...(actions.calendar && session ? [{ key: "calendar", title: "Your calendar", icon: "calendar" }] : []), ...(actions.clips ? [{ key: "clips", title: "Clips", icon: "play" }] : [])])}
          {model.account.length > 0 && group("Account", model.account)}
          {actions.howItWorks && group("Help", [{ key: "howItWorks", title: "How Mshpit works", icon: "discover" }])}
          {!!session && <Pressable onPress={() => choose(onLogout)} style={styles.signOut} accessibilityRole="button"><Text style={styles.signOutText}>Sign out</Text></Pressable>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.48)" }, panel: { flex: 1, backgroundColor: colors.bgElev, borderTopRightRadius: 24, borderBottomRightRadius: 24, overflow: "hidden" },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 }, brand: { flexDirection: "row", alignItems: "center", gap: 8 }, wordmark: { color: colors.text, fontFamily: font, fontSize: 17, fontWeight: "800", letterSpacing: 1.8 }, close: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  content: { padding: 20, paddingTop: 10, paddingBottom: 30 }, identity: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 18 }, identityCopy: { flex: 1, minWidth: 0 }, guest: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" }, name: { fontFamily: font, color: colors.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 }, handle: { color: colors.textDim, fontSize: 14, marginTop: 5 },
  group: { marginTop: 20 }, section: { color: colors.textDim, fontSize: 13, fontWeight: "600", marginBottom: 8, paddingLeft: 12 }, rows: { backgroundColor: colors.surface, borderRadius: 16, overflow: "hidden" }, row: { minHeight: 52, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", gap: 12, alignItems: "center" }, divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft }, rowTitle: { flex: 1, color: colors.text, fontFamily: font, fontSize: 16, lineHeight: 21 }, badge: { color: colors.amber, fontSize: 13, fontWeight: "700" }, pressed: { backgroundColor: colors.surfaceAlt }, signOut: { minHeight: 48, justifyContent: "center", paddingHorizontal: 12, marginTop: 22 }, signOutText: { color: colors.danger, fontSize: 16 },
});
