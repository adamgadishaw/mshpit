import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
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
    return active && value.visible && value.swipeEnabled !== false && (!value.isCurrentSwipeRoute || value.isCurrentSwipeRoute())
      && (!value.feedPresentation || value.feedPresentation.current());
  }, [admission, owner, active]);
  const choose = value => {
    if (!active || selected.current !== selection || !current()) return;
    // Even a tap on the selected filter invalidates queued intent/release.
    setTapRevision(revision => revision + 1);
    if (value !== filter) select(value);
  };
  const commit = value => { if (selected.current !== selection || !current()) return false; select(value); return true; };
  const enabled = !!props.loggedIn && !!props.visible && active && props.swipeEnabled !== false;
  return <NativeTabPreviewContext.Provider value={inheritedPreview || !props.visible || !active}>
  <View style={{ flex: 1, minHeight: 0 }}>
    <View testID="feed-fixed-navigation" style={{ paddingHorizontal: 12, paddingTop: 4 }}>
      <FeedNavigation filter={filter} loggedIn={props.loggedIn} onSelect={choose} />
    </View>
    <NativeFeedFilterPager active={filter} onChange={commit} swipeScope={scope} tapRevision={tapRevision}
      swipeEnabled={enabled} isCurrentSwipeRoute={current}
      renderPage={(page, preview, mayRead) => <FeedPane {...props} filter={page} preview={preview}
        readEnabled={mayRead && active && current()} onSelectFilter={choose} />} />
  </View></NativeTabPreviewContext.Provider>;
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
