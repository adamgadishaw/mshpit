import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, Platform, Pressable, useWindowDimensions } from "react-native";
import { colors, mono, radius, shadow } from "../theme";
import { load, save } from "../lib/persist";
import TicketStub from "../components/TicketStub";
import Icon from "../components/Icon";
import { filteredFeedNextAction } from "../domain/feedPagination.mjs";
import { feedFilterStorageKey, feedFooterState, normalizeFeedFilter } from "../domain/feedExperience.mjs";
import { nextVisibleMediaPostIds } from "../domain/posterVisibility.mjs";
import { JOURNEY_TAGLINE } from "../domain/menuJourney.mjs";
import { HOME_JOURNEY_LINE, homeGuideStorageKey } from "../domain/homeJourney.mjs";
import HomeShowCountdown from "../components/HomeShowCountdown";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";

const PAGE = 8; // load the feed in pages, like the big apps - never all at once

export default function FeedScreen({ feed, followingFeed, localFeed, loggedIn, accountId = null, homeCity, unread = 0, notifUnread = 0, newUser = false, hideHeaderActions = false, onRefresh, onLoadMore, hasMore = false, loadingMore = false, countdownPlan = null, showHomeCountdown = false, onOpenCountdown, onViewAllCountdown, onOpen, onImpression, onDwell, onNotInterested, onUndoNotInterested, onComment, onPreview, onOpenProfile, onOpenArtist, onOpenArtistArchive, onOpenVenue, onOpenNearby, onOpenInbox, onOpenNotifications, onOpenMenu, onOpenClips, onReport, onEdit, onOpenPhotos, onPlay, onRemoveMyPostTag, onLogShow, onOpenDiscover }) {
  const { width } = useWindowDimensions();
  const phone = width < 700;
  const filterScope = feedFilterStorageKey(accountId);
  const [filterState, setFilterState] = useState(() => ({
    scope: filterScope,
    value: normalizeFeedFilter(load(filterScope, "everyone"), { loggedIn }),
  }));
  // Account props change before passive effects run. Project the new account's
  // persisted choice during that transition so A's preference never flashes for B.
  const filter = filterState.scope === filterScope
    ? filterState.value
    : normalizeFeedFilter(load(filterScope, "everyone"), { loggedIn }); // following | local | everyone
  const [count, setCount] = useState(PAGE);
  const [undoItem, setUndoItem] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState(null);
  const [visibleMediaPostIds, setVisibleMediaPostIds] = useState(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const refreshControllerRef = useRef(null);
  const guideScope = homeGuideStorageKey(accountId);
  const [guideState, setGuideState] = useState(() => ({ scope: guideScope, dismissed: load(guideScope, false) }));
  const guideDismissed = guideState.scope === guideScope ? guideState.dismissed : load(guideScope, false);
  const visibleSince = useRef(new Map());
  const seenImpressions = useRef(new Set());
  const dismissGuide = () => {
    setGuideState({ scope: guideScope, dismissed: true });
    save(guideScope, true);
  };
  const full = filter === "following" ? followingFeed : filter === "local" ? localFeed : feed;
  const data = full.slice(0, count);
  const filteredPageLoading = loadingMore && count >= full.length;
  const surface = filter === "following" ? "following" : filter === "local" ? "local" : "everyone";
  const analyticsRef = useRef({ surface, onImpression, onDwell });
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 750 }).current;
  analyticsRef.current = { surface, onImpression, onDwell };

  useEffect(() => {
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    setRefreshing(false);
    setRefreshError(false);
    setFilterState((current) => current.scope === filterScope
      ? current
      : { scope: filterScope, value: normalizeFeedFilter(load(filterScope, "everyone"), { loggedIn }) });
    setCount(PAGE);
    setUndoItem(null);
    setUndoError(null);
    setVisibleMediaPostIds(new Set());
    setGuideState({ scope: guideScope, dismissed: load(guideScope, false) });
    return () => refreshControllerRef.current?.abort();
  }, [filterScope, guideScope, loggedIn]);

  const onViewableItemsChanged = useRef(({ changed }) => {
    const at = Date.now();
    setVisibleMediaPostIds((current) => nextVisibleMediaPostIds(current, changed));
    for (const token of changed || []) {
      const item = token?.item;
      if (!item?.id) continue;
      if (token.isViewable) {
        const viewedSurface = analyticsRef.current.surface;
        visibleSince.current.set(item.id, { item, startedAt: at, surface: viewedSurface });
        const impressionKey = `${viewedSurface}:${item.id}`;
        if (!seenImpressions.current.has(impressionKey)) {
          seenImpressions.current.add(impressionKey);
          analyticsRef.current.onImpression?.(item, Number.isSafeInteger(token.index) ? token.index : 0, viewedSurface);
        }
      } else {
        const visible = visibleSince.current.get(item.id);
        visibleSince.current.delete(item.id);
        if (visible) analyticsRef.current.onDwell?.(item, at - visible.startedAt, visible.surface);
      }
    }
  }).current;

  useEffect(() => () => {
    const at = Date.now();
    for (const { item, startedAt, surface: viewedSurface } of visibleSince.current.values()) {
      analyticsRef.current.onDwell?.(item, at - startedAt, viewedSurface);
    }
    visibleSince.current.clear();
  }, []);

  const pick = (f) => {
    if (f === filter) return;
    const at = Date.now();
    for (const { item, startedAt, surface: viewedSurface } of visibleSince.current.values()) {
      analyticsRef.current.onDwell?.(item, at - startedAt, viewedSurface);
    }
    visibleSince.current.clear();
    setVisibleMediaPostIds(new Set());
    setFilterState({ scope: filterScope, value: f });
    save(filterScope, f);
    setCount(PAGE);
  };
  const loadMore = async () => {
    if (count < full.length) setCount((c) => c + PAGE);
    // Following/Local are projections of the pages already loaded. Letting an
    // empty projection paginate the global feed can cascade through every page
    // without a user scroll, especially on a slow phone connection.
    else if (filter === "everyone" && hasMore && !loadingMore) {
      const loaded = await onLoadMore?.();
      if (loaded) setCount((c) => c + PAGE);
    }
  };
  const loadOlderFiltered = async () => {
    const action = filteredFeedNextAction({
      filter,
      visibleCount: count,
      loadedMatchCount: full.length,
      hasMore,
      loadingMore,
    });
    // Following and Local are projections of every global page already in
    // memory. Reveal those matches before spending another request (and before
    // showing a spinner on a slow phone). The old path always fetched first,
    // even when dozens of matching posts were sitting just beyond `count`.
    if (action === "reveal") {
      setCount((c) => c + PAGE);
      return;
    }
    if (action !== "fetch") return;
    const loaded = await onLoadMore?.();
    if (loaded) setCount((c) => c + PAGE);
  };
  const footer = feedFooterState({ visibleCount: count, loadedCount: full.length, hasMore, loading: filteredPageLoading });
  const advanceFeed = filter === "everyone" ? loadMore : loadOlderFiltered;
  const hideRecommendation = async (log) => {
    if (!log?.id || !onNotInterested) return;
    setUndoItem(log);
    setUndoError(null);
    try {
      await onNotInterested(log);
    } catch {
      setUndoItem((current) => (current?.id === log.id ? null : current));
    }
  };
  const undoRecommendation = async () => {
    if (!undoItem?.id || !onUndoNotInterested || undoBusy) return;
    const restoring = undoItem;
    setUndoBusy(true);
    setUndoError(null);
    try {
      await onUndoNotInterested(restoring);
      setUndoItem((current) => (current?.id === restoring.id ? null : current));
    } catch {
      setUndoError({ postId: restoring.id, message: "Couldn't restore this yet. Try again." });
    } finally {
      setUndoBusy(false);
    }
  };
  const refresh = async () => {
    if (refreshControllerRef.current || !onRefresh) return false;
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    setRefreshing(true);
    setRefreshError(false);
    try {
      const result = await onRefresh({ signal: controller.signal });
      if (controller.signal.aborted || refreshControllerRef.current !== controller) return false;
      const failed = result === false || result == null;
      setRefreshError(failed);
      return !failed;
    } catch {
      // architecture: allow-ambiguous-result -- this UI refresh keeps the current feed visible and reports its optional revalidation failure in place
      if (!controller.signal.aborted && refreshControllerRef.current === controller) setRefreshError(true);
      return false;
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
        setRefreshing(false);
      }
    }
  };

  // Concert cards are tall and media-heavy. Stage them gently on phones so
  // image decoding and comment-preview mounts do not all hit one frame.
  return (
    <VinylRefreshBoundary
      refreshing={refreshing}
      onRefresh={refresh}
      accessibilityLabel="Refresh your feed"
      testID="feed-refresh"
    >
    <FlatList
      data={data}
      extraData={visibleMediaPostIds}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews
      initialNumToRender={phone ? 3 : PAGE}
      maxToRenderPerBatch={phone ? 2 : PAGE}
      updateCellsBatchingPeriod={phone ? 75 : 50}
      windowSize={phone ? 3 : 7}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      ListHeaderComponent={
        <View style={styles.head}>
          <View style={styles.wordmarkRow}>
            <Text style={styles.wordmark}>MSHPIT</Text>
            {!hideHeaderActions && <View style={styles.headerBtns}>
              {onOpenClips && (
                <Pressable style={styles.clipsBtn} onPress={onOpenClips} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clips">
                  <Icon name="play" size={15} color={colors.amber} />
                  <Text style={styles.clipsTxt}>Clips</Text>
                </Pressable>
              )}
              <Pressable style={styles.inboxBtn} onPress={onOpenNotifications} hitSlop={8} accessibilityRole="button" accessibilityLabel={notifUnread > 0 ? `Activity, ${notifUnread} new` : "Activity"}>
                <Icon name="bell" size={22} color={colors.text} />
                {notifUnread > 0 && <View style={styles.inboxBadge}><Text style={styles.inboxBadgeTxt}>{notifUnread}</Text></View>}
              </Pressable>
              <Pressable style={styles.inboxBtn} onPress={onOpenInbox} hitSlop={8} accessibilityRole="button" accessibilityLabel={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}>
                <Icon name="mail" size={22} color={colors.text} />
                {unread > 0 && <View style={styles.inboxBadge}><Text style={styles.inboxBadgeTxt}>{unread}</Text></View>}
              </Pressable>
              <Pressable style={styles.inboxBtn} onPress={onOpenMenu} hitSlop={8} accessibilityRole="button" accessibilityLabel="Menu">
                <Icon name="menu" size={22} color={colors.text} />
              </Pressable>
            </View>}
          </View>
          <Text style={styles.tag}>{JOURNEY_TAGLINE}</Text>

          {refreshing || refreshError ? (
            <Text
              style={[styles.refreshStatus, refreshError && styles.refreshStatusError]}
              accessibilityLiveRegion={refreshError ? "assertive" : "polite"}
              accessibilityRole={refreshError ? "alert" : "text"}
            >
              {refreshing ? "Refreshing your feed…" : "The feed could not refresh. Pull down to try again."}
            </Text>
          ) : null}

          {loggedIn && showHomeCountdown && countdownPlan ? (
            <View style={styles.countdownTop}>
              <HomeShowCountdown plan={countdownPlan} onOpen={onOpenCountdown} onViewAll={onViewAllCountdown} />
            </View>
          ) : null}

          {loggedIn && (
            <Pressable style={styles.nearBtn} onPress={onOpenNearby}>
              <Icon name="pin" size={16} color={colors.amber} />
              <Text style={styles.nearTxt}>
                Near you{homeCity ? ` · ${homeCity}` : ""}
                <Text style={styles.nearSub}>  - local venues & upcoming shows</Text>
              </Text>
              <Icon name="chevron-right" size={16} color={colors.textDim} />
            </Pressable>
          )}

          {loggedIn && newUser && !guideDismissed && (
            <View style={styles.gs}>
              <View style={styles.gsHead}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.gsTitle}>Your first night on Mshpit</Text>
                  <Text style={styles.gsJourney}>{HOME_JOURNEY_LINE}</Text>
                </View>
                <Pressable onPress={dismissGuide} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss getting started guide"><Icon name="x" size={16} color={colors.textDim} /></Pressable>
              </View>
              <Text style={styles.gsSub}>Find a show, save the night, then come back to rate it, share the memory, and meet other fans.</Text>
              <View style={styles.gsActions}>
                <HomeAction icon="discover" label="Find a show" onPress={onOpenDiscover} />
                <HomeAction icon="plus" label="Log a show" onPress={onLogShow} primary />
              </View>
            </View>
          )}

          {loggedIn && (
            <View style={styles.segment}>
              <Seg label="Following" on={filter === "following"} onPress={() => pick("following")} />
              <Seg label="Local" on={filter === "local"} onPress={() => pick("local")} />
              <Seg label="For You" on={filter === "everyone"} onPress={() => pick("everyone")} />
            </View>
          )}

          {!!undoItem && (
            <View style={styles.undoBar} accessibilityRole="alert">
              <View style={{ flex: 1 }}>
                <Text style={styles.undoTitle}>Recommendation hidden</Text>
                <Text style={styles.undoSub} numberOfLines={1}>{undoError?.postId === undoItem.id ? undoError.message : undoItem.artist || undoItem.review || "That post"}</Text>
              </View>
              <Pressable
                style={[styles.undoBtn, undoBusy && styles.olderBtnOff]}
                onPress={undoRecommendation}
                disabled={undoBusy}
                accessibilityRole="button"
                accessibilityLabel={undoError?.postId === undoItem.id ? "Retry restoring hidden recommendation" : "Undo hidden recommendation"}
                accessibilityState={{ disabled: undoBusy, busy: undoBusy }}
              >
                <Text style={styles.undoBtnTxt}>{undoBusy ? "Restoring..." : undoError?.postId === undoItem.id ? "Try again" : "Undo"}</Text>
              </Pressable>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <View style={styles.emptyIcon}>
            <Icon name={filter === "following" ? "you" : filter === "local" ? "pin" : "feed"} size={26} color={colors.textFaint} />
          </View>
          <Text style={styles.emptyTitle}>
            {filter === "following"
              ? (hasMore ? "No followed posts in the newest batch" : "Your Following feed is quiet")
              : filter === "local"
              ? (hasMore ? `No recent posts from ${homeCity || "your city"}` : `Nothing in ${homeCity || "your city"} yet`)
              : "No shows logged yet"}
          </Text>
          <Text style={styles.emptySub}>
            {filter === "following"
              ? (hasMore ? "Load one older page at a time to keep looking without hammering your phone connection." : "Follow people whose taste matches yours, tap any reviewer's name to see their profile and follow.")
              : filter === "local"
              ? (hasMore ? "Load one older page at a time to look for nearby concert posts." : "Be the first to log a show in your city, tap the + to post one.")
              : "Log the first show, tap the + to rate the band and the room."}
          </Text>
          <View style={styles.emptyActions}>
            <HomeAction icon="discover" label="Find a show" onPress={onOpenDiscover} />
            <HomeAction icon="plus" label="Log a show" onPress={onLogShow} primary />
          </View>
        </View>
      }
      ListFooterComponent={(
        <View>
          {footer.kind === "reveal" || footer.kind === "fetch" || footer.kind === "loading" ? (
            <Pressable
              style={[styles.olderBtn, filteredPageLoading && styles.olderBtnOff]}
              onPress={advanceFeed}
              disabled={filteredPageLoading}
              accessibilityRole="button"
              accessibilityLabel={footer.label}
              accessibilityState={{ disabled: filteredPageLoading }}
            >
              <Text style={styles.olderTxt}>{footer.label}</Text>
            </Pressable>
          ) : footer.kind === "caught-up" ? (
            <View style={styles.caughtUp} accessibilityRole="summary">
              <Icon name="check" size={17} color={colors.good} />
              <View style={{ flex: 1 }}>
                <Text style={styles.caughtTitle}>You're caught up</Text>
                <Text style={styles.caughtSub}>Pit will keep your place. Come back when the community has something new.</Text>
              </View>
            </View>
          ) : null}
          {loggedIn && showHomeCountdown && !countdownPlan ? (
            <View style={styles.countdownBottom}>
              <HomeShowCountdown compact onFindShow={onOpenDiscover} />
            </View>
          ) : null}
        </View>
      )}
      renderItem={({ item, index: itemIndex }) => (
        <TicketStub log={item} mediaViewable={visibleMediaPostIds.has(String(item.id)) ? true : null} onOpen={(_unused) => onOpen?.(item, { surface, position: itemIndex })} onOpenShow={(show) => onOpen?.(show, { surface, position: itemIndex })} onNotInterested={surface === "everyone" && item.recommendation ? hideRecommendation : undefined} onComment={onComment} onPreview={onPreview} onOpenProfile={onOpenProfile} onOpenArtist={onOpenArtist} onOpenArtistArchive={onOpenArtistArchive} onOpenVenue={onOpenVenue} onReport={onReport} onEdit={onEdit} onOpenPhotos={onOpenPhotos} onPlay={onPlay} onRemoveMyPostTag={onRemoveMyPostTag} />
      )}
    />
    </VinylRefreshBoundary>
  );
}

function Seg({ label, on, onPress }) {
  return (
    <Pressable
      style={[styles.seg, on && styles.segOn]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={`${label} feed`}
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.segTxt, on && styles.segTxtOn]}>{label}</Text>
    </Pressable>
  );
}

function HomeAction({ icon, label, onPress, primary = false }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.homeAction, primary && styles.homeActionPrimary, pressed && styles.homeActionPressed]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !onPress }}
      accessibilityLabel={label}
    >
      <Icon name={icon} size={15} color={primary ? "#1A1206" : colors.amber} />
      <Text style={[styles.homeActionText, primary && styles.homeActionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, ...(Platform.OS === "web" ? { width: "100%", maxWidth: 900, alignSelf: "center" } : null) },
  gs: { backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.amber, padding: 13, marginBottom: 14, gap: 8 },
  gsHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  gsTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  gsJourney: { color: colors.amber, fontFamily: mono, fontSize: 9.5, lineHeight: 14, fontWeight: "900", letterSpacing: 0.65, marginTop: 2 },
  gsSub: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  gsActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  emptyBox: { alignItems: "center", paddingTop: 40, paddingHorizontal: 30, gap: 6 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  emptySub: { color: colors.textDim, fontSize: 14, lineHeight: 20, textAlign: "center" },
  emptyActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 9, marginTop: 12 },
  homeAction: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  homeActionPrimary: { borderColor: colors.amberStrong, backgroundColor: colors.amberStrong },
  homeActionPressed: { opacity: 0.78 },
  homeActionText: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  homeActionTextPrimary: { color: "#1A1206" },
  olderBtn: { alignSelf: "center", marginTop: 18, paddingHorizontal: 18, paddingVertical: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  olderBtnOff: { opacity: 0.55 },
  olderTxt: { color: colors.text, fontSize: 14, fontWeight: "800" },
  caughtUp: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  caughtTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  caughtSub: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 2 },
  head: { marginBottom: 18, marginTop: 4 },
  wordmarkRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtns: { flexDirection: "row", gap: 8, alignItems: "center" },
  clipsBtn: { flexDirection: "row", alignItems: "center", gap: 5, height: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  clipsTxt: { color: colors.amber, fontSize: 13, fontWeight: "800" },
  wordmark: { color: colors.text, fontSize: 30, fontWeight: "900", letterSpacing: 4, fontFamily: mono },
  inboxBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  inboxBadge: { position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.magenta, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, borderWidth: 2, borderColor: colors.bg },
  inboxBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800", fontFamily: mono },
  tag: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  refreshStatus: { color: colors.textDim, fontSize: 11.5, lineHeight: 17, marginTop: 8 },
  refreshStatusError: { color: colors.danger },
  countdownTop: { marginTop: 14 },
  countdownBottom: { marginTop: 20 },
  nearBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.bgElev, borderRadius: 14, borderWidth: 1, borderColor: colors.amber, paddingHorizontal: 14, paddingVertical: 13, marginTop: 16 },
  nearTxt: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700" },
  nearSub: { color: colors.textDim, fontWeight: "400" },
  // A proper segmented control: one rounded track, the active segment lifts on a
  // filled pill with a shadow (like iOS / real apps) instead of three bordered pills.
  segment: { flexDirection: "row", marginTop: 14, backgroundColor: colors.bgElev, borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.lineSoft },
  seg: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: radius.pill },
  segOn: { backgroundColor: colors.surfaceAlt, ...shadow.card },
  segTxt: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  segTxtOn: { color: colors.text, fontWeight: "800" },
  undoBar: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.good, backgroundColor: colors.bgElev },
  undoTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  undoSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  undoBtn: { minHeight: 36, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.good },
  undoBtnTxt: { color: colors.bg, fontSize: 12.5, fontWeight: "900" },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 21, fontStyle: "italic", paddingHorizontal: 4 },
});
