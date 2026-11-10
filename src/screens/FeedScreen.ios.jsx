import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Icon from "../components/Icon";
import { colors } from "../theme";
import { unreadBadgeCount, unreadBadgeText } from "../domain/unreadBadge.mjs";
import { FeedContent, FeedNavigation, useFeedSelection } from "./FeedScreen.jsx";
import NativeFeedFilterPager from "../components/NativeFeedFilterPager.ios";
import useAppActive from "../lib/useAppActive";

// One persisted selection, outside every preview. Never mount a second selector.
export default function FeedScreen(props) {
  return <FeedOwner key={`${props.accountId || "guest"}:${props.feedReturn?.key || "feed"}`} {...props} />;
}
function FeedOwner(props) {
  const { filter, select } = useFeedSelection(props.accountId, props.loggedIn);
  const [tapRevision, setTapRevision] = useState(0);
  const active = useAppActive();
  const currentRef = useRef(null);
  currentRef.current = props;
  const scope = useMemo(() => ({ route: props.swipeScope, visible: props.visible, active }), [props.swipeScope, props.visible, active]);
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
    return value.visible && value.swipeEnabled !== false && (!value.isCurrentSwipeRoute || value.isCurrentSwipeRoute())
      && (!value.feedPresentation || value.feedPresentation.current());
  }, [admission, owner]);
  const choose = value => {
    if (!active || selected.current !== selection || !current()) return;
    // Even a tap on the selected filter invalidates queued intent/release.
    setTapRevision(revision => revision + 1);
    if (value !== filter) select(value);
  };
  const commit = value => { if (selected.current !== selection || !current()) return false; select(value); return true; };
  const enabled = !!props.loggedIn && !!props.visible && active && props.swipeEnabled !== false;
  return <View style={{ flex: 1, minHeight: 0 }}>
    <View testID="feed-fixed-navigation" style={{ paddingHorizontal: 12, paddingTop: 4 }}>
      <View style={styles.heading}>
        <Text style={styles.title} accessibilityRole="header">Feed</Text>
        {props.loggedIn && <View style={styles.actions}>
          <FeedUnreadAction icon="bell" label="Notifications" count={props.notifUnread} onPress={() => { if (current()) props.onOpenNotifications?.(); }} />
          <FeedUnreadAction icon="mail" label="Messages" count={props.unread} onPress={() => { if (current()) props.onOpenInbox?.(); }} />
        </View>}
      </View>
      <FeedNavigation filter={filter} loggedIn={props.loggedIn} onSelect={choose} hideTitle />
    </View>
    <NativeFeedFilterPager active={filter} onChange={commit} swipeScope={scope} tapRevision={tapRevision}
      swipeEnabled={enabled} isCurrentSwipeRoute={current}
      renderPage={(page, preview, mayRead) => <FeedPane {...props} filter={page} preview={preview}
        readEnabled={mayRead && active && current()} onSelectFilter={choose} />} />
  </View>;
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
  return <FeedContent {...props} localNavigation visible={permitted.current} feedReturn={lease} />;
}


export function FeedUnreadAction({ icon, label, count, onPress }) {
  const unread = unreadBadgeCount(count);
  return <Pressable style={styles.action} onPress={onPress} accessibilityRole="button"
    accessibilityLabel={unread ? `${label}, ${unread} unread` : label}>
    <Icon name={icon} size={22} color={colors.text} />
    {unread > 0 && <View style={styles.badge} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.badgeText} maxFontSizeMultiplier={1.4}>{unreadBadgeText(unread)}</Text>
    </View>}
  </Pressable>;
}
const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { flexShrink: 1, color: colors.text, fontSize: 28, fontWeight: "800" },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  action: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 0, right: 0, minWidth: 19, minHeight: 18, paddingHorizontal: 4, borderRadius: 5, backgroundColor: "#BD1734", borderWidth: 1.5, borderColor: colors.bg, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#FFFFFF", fontSize: 10, lineHeight: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
