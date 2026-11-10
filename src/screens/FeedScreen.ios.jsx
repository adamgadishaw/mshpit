import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import NativeFeedFilterPager from "../components/NativeFeedFilterPager.ios";
import NativeLargeTitle, { NativeLargeTitleProvider } from "../components/NativeLargeTitle.ios";
import { colors } from "../theme";
import { FeedContent } from "./FeedScreen.jsx";
import useIOSFeedSelection from "../hooks/useIOSFeedSelection";
import { IOS_FEED_FILTERS } from "../domain/iosMenuSections.mjs";
import useAppActive from "../lib/useAppActive";
import useFeedPresentation from "../hooks/useFeedPresentation";
import useNativeTabPreview from "../hooks/useNativeTabPreview";
import { NativeTabPreviewContext } from "../components/nativeTabPreviewContext.mjs";

// One persisted selection, outside every preview. Never mount a second selector.
export default function FeedScreen(props) {
  const Owner = props.feedSelection ? FeedOwner : StandaloneFeedOwner;
  return <Owner key={`${props.accountId || "guest"}:${props.feedReturn?.key || "feed"}`} {...props} />;
}
function StandaloneFeedOwner(props) {
  const feedSelection = useIOSFeedSelection(props.accountId);
  return <FeedOwner {...props} feedSelection={feedSelection} />;
}
function FeedOwner(props) {
  const { filter, select, revision: tapRevision = 0 } = props.feedSelection;
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
    select(value);
  };
  const commit = value => {
    if (selected.current !== selection || !current()) return false;
    return select(value) !== false;
  };
  const enabled = !inheritedPreview && !!props.loggedIn && !!props.visible && active && props.swipeEnabled !== false;
  return <NativeTabPreviewContext.Provider value={inheritedPreview || !props.visible || !active}>
    <NativeLargeTitleProvider><View style={{ flex: 1, minHeight: 0 }} testID="feed-filter-pages">
      <NativeFeedFilterPager retainVisited active={filter} onChange={commit} swipeScope={scope} tapRevision={tapRevision}
        swipeEnabled={enabled} isCurrentSwipeRoute={current}
        renderPage={(page, preview, mayRead) => <FeedPane {...props} filter={page} preview={preview}
          readEnabled={mayRead && active && current()} onSelectFilter={choose} />} />
    </View></NativeLargeTitleProvider>
  </NativeTabPreviewContext.Provider>;
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
  const label = IOS_FEED_FILTERS.find(item => item.key === props.filter)?.title || "For You";
  return <FeedContent {...guarded} localNavigation visible={permitted.current} feedReturn={lease}
    feedContext={<View style={styles.context}>
      <NativeLargeTitle style={styles.largeTitleBox}><Text style={styles.largeTitle} accessibilityRole="header">Feed</Text></NativeLargeTitle>
      <Text style={styles.filterLabel} accessibilityLabel={`Current feed: ${label}`}>{label}</Text>
    </View>} />;
}

const styles = StyleSheet.create({
  context: { paddingBottom: 14 },
  largeTitleBox: { minHeight: 50, justifyContent: "center" },
  largeTitle: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: -1 },
  filterLabel: { color: colors.textDim, fontSize: 15, lineHeight: 21 },
});
