import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import NativeLargeTitle, { NativeLargeTitleProvider } from "../components/NativeLargeTitle.ios";
import Icon from "../components/Icon";
import { colors, font } from "../theme";
import { unreadBadgeCount, unreadBadgeText } from "../domain/unreadBadge.mjs";
import { FeedContent, FeedNavigation, useFeedSelection } from "./FeedScreen.jsx";
import NativeFeedFilterPager from "../components/NativeFeedFilterPager.ios";
import useAppActive from "../lib/useAppActive";
import useFeedPresentation from "../hooks/useFeedPresentation";
import useNativeTabPreview from "../hooks/useNativeTabPreview";
import { NativeTabPreviewContext } from "../components/nativeTabPreviewContext.mjs";

// One persisted selection, outside every preview. Never mount a second selector.
export default function FeedScreen(props) {
  return <FeedOwner key={`${props.accountId || "guest"}:${props.feedReturn?.key || "feed"}`} {...props} />;
}
function FeedOwner(props) {
  const { filter, select } = useFeedSelection(props.accountId, props.loggedIn);
  const [tapRevision, setTapRevision] = useState(0);
  const active = useAppActive();
  const inheritedPreview = useNativeTabPreview();
  const currentRef = useRef(null);
  currentRef.current = props;
  const scope = useMemo(() => ({ route: props.swipeScope, visible: props.visible, active, inheritedPreview }), [props.swipeScope, props.visible, active, inheritedPreview]);
  const owner = scope;
  const selection = useMemo(() => ({ filter }), [filter]);
  const selected = useRef(selection);
  selected.current = selection;
  const live = useRef(null);
  const [admission, setAdmission] = useState(null);
  useLayoutEffect(() => {
    const lifetime = { owner };
    live.current = lifetime;
    setAdmission(lifetime);
    return () => { if (live.current === lifetime) live.current = null; };
  }, [owner]);
  const current = useCallback(() => {
    if (!admission || live.current !== admission || admission.owner !== owner) return false;
    const value = currentRef.current;
    return !inheritedPreview && active && value.visible && value.swipeEnabled !== false && (!value.isCurrentSwipeRoute || value.isCurrentSwipeRoute())
      && (!value.feedPresentation || value.feedPresentation.current());
  }, [admission, owner, active, inheritedPreview]);
  const choose = value => {
    if (!active || selected.current !== selection || !current()) return;
    // Even a tap on the selected filter invalidates queued intent/release.
    setTapRevision(revision => revision + 1);
    if (value !== filter) select(value);
  };
  const commit = value => { if (selected.current !== selection || !current()) return false; select(value); return true; };
  const enabled = !inheritedPreview && !!props.loggedIn && !!props.visible && active && props.swipeEnabled !== false;
  return <NativeTabPreviewContext.Provider value={inheritedPreview || !props.visible || !active}>
  <NativeLargeTitleProvider><View style={{ flex: 1, minHeight: 0 }}>
    <View testID="feed-fixed-navigation" style={{ paddingHorizontal: 12, paddingTop: 4 }}>
      <NativeLargeTitle style={styles.largeTitleBox}><Text style={styles.largeTitle} accessibilityRole="header">Feed</Text></NativeLargeTitle>
      <FeedNavigation hideTitle filter={filter} loggedIn={props.loggedIn} onSelect={choose} />
      {props.loggedIn && <FeedActivityControls unread={props.unread} notifications={props.notifUnread}
        enabled={!inheritedPreview && current()} onOpenInbox={() => { if (!inheritedPreview && current()) props.onOpenInbox?.(); }}
        onOpenNotifications={() => { if (!inheritedPreview && current()) props.onOpenNotifications?.(); }}
        hasInbox={typeof props.onOpenInbox === "function"} hasNotifications={typeof props.onOpenNotifications === "function"} />}
    </View>
    <NativeFeedFilterPager retainVisited active={filter} onChange={commit} swipeScope={scope} tapRevision={tapRevision}
      swipeEnabled={enabled} isCurrentSwipeRoute={current}
      renderPage={(page, preview, mayRead) => <FeedPane {...props} filter={page} preview={preview}
        readEnabled={mayRead && active && current()} onSelectFilter={choose} />} />
  </View></NativeLargeTitleProvider></NativeTabPreviewContext.Provider>;
}
function FeedPane({ preview, feedReturn, visible, ...props }) {
  const permitted = useRef(false);
  permitted.current = !preview && visible && props.readEnabled
    && (!props.feedPresentation || props.feedPresentation.current());
  // Keep lease identity stable across promotion but never allow hidden panes to
  // clear/save the root's one current Feed return snapshot, including render paths.
  const lease = useMemo(() => feedReturn && ({
    key: feedReturn.key,
    read: filter => feedReturn.read(filter),
    current: () => permitted.current && feedReturn.current(),
    save: value => { if (permitted.current) feedReturn.save(value); },
    clear: () => { if (permitted.current) feedReturn.clear(); },
  }), [feedReturn]);
  const { current: actionCurrent } = useFeedPresentation({ active: permitted.current,
    presentation: props.feedPresentation, scope: props.accountId });
  // A previously queued native button event cannot act on the covering detail,
  // or revive after Back admits a new Feed presentation.
  const guarded = {};
  for (const [key, value] of Object.entries(props)) {
    guarded[key] = key === "onDwell" && typeof value === "function"
      ? (...args) => { if (!feedReturn || feedReturn.current()) value(...args); }
      : key.startsWith("on") && typeof value === "function"
      ? (...args) => {
        if (!actionCurrent()) return;
        return value(...args);
      } : value;
  }
  return <FeedContent {...guarded} localNavigation visible={permitted.current} feedReturn={lease} />;
}

// These controls belong to the fixed Feed owner, not an individual filter pane.
// They remain in place during swipes and never mark activity read themselves.
export function FeedActivityControls({ unread, notifications, enabled, onOpenInbox, onOpenNotifications, hasInbox, hasNotifications }) {
  const { fontScale } = useWindowDimensions();
  const items = [
    ...(hasInbox ? [{ title: "Messages", icon: "mail", count: unreadBadgeCount(unread), press: onOpenInbox }] : []),
    ...(hasNotifications ? [{ title: "Notifications", icon: "bell", count: unreadBadgeCount(notifications), press: onOpenNotifications }] : []),
  ];
  if (!items.length) return null;
  return <View style={styles.activity} testID="feed-activity-controls">
    {items.map(item => <Pressable key={item.title} onPress={item.press} disabled={!enabled}
      accessibilityRole="button" accessibilityLabel={`${item.title}${item.count ? `, ${item.count} unread` : ""}`}
      accessibilityState={{ disabled: !enabled }} style={({ pressed }) => [styles.activityButton, fontScale > 1.25 && styles.activityButtonLarge, pressed && styles.activityPressed]}>
      <Icon name={item.icon} size={19} color={colors.amber} />
      <Text style={styles.activityLabel}>{item.title}</Text>
      {item.count > 0 && <View style={styles.activityBadge} testID={`feed-activity-badge-${item.title.toLowerCase()}`}
        accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.activityBadgeText}>{unreadBadgeText(item.count)}</Text>
      </View>}
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  largeTitleBox: { minHeight: 50, justifyContent: "center" },
  largeTitle: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: -1 },
  activity: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 8, paddingBottom: 6 },
  activityButton: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.surface },
  activityButtonLarge: { flexBasis: "100%" },
  activityLabel: { flexShrink: 1, minWidth: 0, fontFamily: font, fontSize: 14, color: colors.text },
  activityBadge: { flexShrink: 0, minWidth: 21, minHeight: 20, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: "#BD1734", alignItems: "center", justifyContent: "center" },
  activityBadgeText: { fontSize: 12, fontWeight: "700", color: "#FFFFFF", fontVariant: ["tabular-nums"] },
  activityPressed: { backgroundColor: colors.surfaceAlt },
});
