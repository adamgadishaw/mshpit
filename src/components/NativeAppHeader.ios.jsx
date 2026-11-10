import { useContext, useLayoutEffect } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { ReduceMotion, cancelAnimation, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import BrandMark from "./BrandMark";
import Icon from "./Icon";
import NativeTabRail from "./NativeTabRail";
import { NativeScrollChromeContext } from "./NativeScrollChrome.ios";
import useReducedMotion from "../hooks/useReducedMotion";
import { unreadBadgeCount, unreadBadgeText } from "../domain/unreadBadge.mjs";
import { iosFeedFilterChoices } from "../domain/iosMenuSections.mjs";
import { colors, font } from "../theme";

export function NativeActivityIcons({ unread, notifications, onOpenInbox, onOpenNotifications, enabled = true }) {
  const { fontScale } = useWindowDimensions();
  const items = [
    ...(onOpenInbox ? [{ label: "Messages", icon: "mail", count: unreadBadgeCount(unread), press: onOpenInbox }] : []),
    ...(onOpenNotifications ? [{ label: "Notifications", icon: "bell", count: unreadBadgeCount(notifications), press: onOpenNotifications }] : []),
  ];
  return <View style={styles.activity} testID="native-activity-icons">{items.map(item => <Pressable key={item.label}
    onPress={item.press} disabled={!enabled} style={styles.control} accessibilityRole="button"
    accessibilityLabel={`${item.label}${item.count ? `, ${item.count} unread` : ""}`} accessibilityState={{ disabled: !enabled }}>
    <Icon name={item.icon} size={22} color={colors.text} strokeWidth={1.8} />
    {item.count > 0 ? <View style={[styles.badge, fontScale > 1.5 && styles.badgeDot]} accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {fontScale <= 1.5 ? <Text style={styles.badgeText}>{unreadBadgeText(item.count)}</Text> : null}
    </View> : null}
  </Pressable>)}</View>;
}

export default function NativeAppHeader({ onHome, onAccount, loggedIn, onMenu, menuRef, onPost, active, onChange, swipeScope, swipeEnabled, isCurrentSwipeRoute, unread, notifications, onOpenInbox, onOpenNotifications, feedSelection }) {
  const chrome = useContext(NativeScrollChromeContext);
  const reduced = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const progress = useSharedValue(0);
  useLayoutEffect(() => () => cancelAnimation(progress), [progress, chrome?.owner]);
  useAnimatedReaction(() => chrome ? chrome.shown.get() : true, shown => {
    if (chrome && chrome.epoch.get() !== chrome.revision) return;
    progress.set(withTiming(shown ? 0 : 1, { duration: reduced ? 0 : 190, reduceMotion: ReduceMotion.System }));
  }, [chrome?.owner, reduced]);
  const motion = useAnimatedStyle(() => ({ transform: [{ translateY: -progress.get() * (chrome?.height || 48) }] }));
  const exposure = useAnimatedProps(() => ({
    pointerEvents: chrome && !chrome.shown.get() ? "none" : "auto",
    accessibilityElementsHidden: !!chrome && !chrome.shown.get(),
  }));
  const guard = callback => (...args) => {
    if (swipeEnabled !== false && isCurrentSwipeRoute?.() !== false && (!chrome || chrome.current())) callback?.(...args);
  };
  return <View pointerEvents="box-none" style={chrome ? [styles.overlay, { height: chrome.height }] : undefined}>
    <Animated.View style={motion} animatedProps={exposure}>
      <NativeTabRail active={active} onChange={guard(onChange)} swipeScope={swipeScope} swipeEnabled={swipeEnabled} isCurrentSwipeRoute={isCurrentSwipeRoute}>
        <View onLayout={chrome?.measure} testID="native-activity-bar">
        <View style={styles.header}>
          <Pressable ref={menuRef} onPress={guard(onMenu)} style={styles.control} accessibilityRole="button" accessibilityLabel="Open side menu" accessibilityHint="Shows your account, music community and settings">
            <Icon name="menu" size={23} color={colors.text} strokeWidth={1.8} />
          </Pressable>
          <Pressable onPress={guard(onHome)} style={styles.brand} accessibilityRole="button" accessibilityLabel="Mshpit Discover">
            <BrandMark size={22} color={colors.amber} />{fontScale <= 1.5 ? <Text style={styles.wordmark}>MSHPIT</Text> : null}
          </Pressable>
          {loggedIn ? <NativeActivityIcons unread={unread} notifications={notifications} onOpenInbox={onOpenInbox && guard(onOpenInbox)}
            onOpenNotifications={onOpenNotifications && guard(onOpenNotifications)} enabled={swipeEnabled !== false} /> : null}
          <Pressable onPress={guard(loggedIn ? onPost : onAccount)} style={styles.control} accessibilityRole="button" accessibilityLabel={loggedIn ? "Make a post" : "Sign in"}>
            <Icon name={loggedIn ? "plus" : "you"} size={24} color={colors.amber} strokeWidth={1.9} />
          </Pressable>
        </View>
        {active === "feed" && loggedIn && feedSelection ? <View style={[styles.feedTabs, fontScale > 1.25 && styles.wrappedTabs]}
          accessibilityRole="tablist" accessibilityLabel="Feed filters" testID="native-feed-tabs">
          {iosFeedFilterChoices(feedSelection.filter).map(tab => <Pressable key={tab.key}
            onPress={guard(() => { if (!tab.selected) feedSelection.select(tab.key); })}
            disabled={swipeEnabled === false} accessibilityRole="tab" accessibilityLabel={tab.title}
            accessibilityHint={tab.detail} accessibilityState={{ selected: tab.selected, disabled: swipeEnabled === false }}
            style={({ pressed }) => [styles.feedTab, fontScale > 1.25 && styles.wrappedTab, tab.selected && styles.selectedTab, pressed && styles.pressed]}>
            <Text style={[styles.feedTabLabel, tab.selected && styles.selectedLabel]}>{tab.title}</Text>
          </Pressable>)}
        </View> : null}
        </View>
      </NativeTabRail>
    </Animated.View>
  </View>;
}
const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20, overflow: "hidden" },
  header: { minHeight: 48, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", backgroundColor: colors.bg },
  feedTabs: { flexDirection: "row", paddingHorizontal: 8, backgroundColor: colors.bg },
  feedTab: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 6, paddingVertical: 10, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  wrappedTabs: { flexWrap: "wrap" },
  wrappedTab: { flexBasis: "45%" },
  feedTabLabel: { flexShrink: 1, textAlign: "center", fontFamily: font, fontSize: 14, fontWeight: "600", color: colors.textDim },
  selectedTab: { borderBottomColor: colors.amber },
  selectedLabel: { color: colors.amber },
  pressed: { opacity: 0.65 },
  control: { flexShrink: 0, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  brand: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5 },
  wordmark: { flexShrink: 1, fontFamily: font, fontSize: 14, fontWeight: "800", letterSpacing: 1, color: colors.text },
  activity: { flexDirection: "row", flexShrink: 0 },
  badge: { position: "absolute", top: 0, right: 0, minWidth: 18, minHeight: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: "#BD1734", alignItems: "center", justifyContent: "center" },
  badgeDot: { top: 5, right: 5, minWidth: 9, minHeight: 9, width: 9, height: 9, paddingHorizontal: 0 },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#FFFFFF", fontVariant: ["tabular-nums"] },
});
