import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, useWindowDimensions } from "react-native";
import { colors, mono, radius, shadow } from "../theme";
import { load, save } from "../lib/persist";
import TicketStub from "../components/TicketStub";
import Icon from "../components/Icon";
import { filteredFeedNextAction } from "../domain/feedPagination.mjs";

const PAGE = 8; // load the feed in pages, like the big apps - never all at once

export default function FeedScreen({ feed, followingFeed, localFeed, loggedIn, homeCity, unread = 0, notifUnread = 0, newUser = false, hideHeaderActions = false, onLoadMore, hasMore = false, loadingMore = false, onOpen, onComment, onPreview, onOpenProfile, onOpenArtist, onOpenVenue, onOpenNearby, onOpenInbox, onOpenNotifications, onOpenMenu, onOpenClips, onReport, onEdit, onOpenPhotos, onPlay, onLogShow, onEditProfile }) {
  const { width } = useWindowDimensions();
  const phone = width < 700;
  const [filter, setFilter] = useState("everyone"); // following | local | everyone
  const [count, setCount] = useState(PAGE);
  const [gsDone, setGsDone] = useState(() => load("pit.gsDismissed", false));
  const dismissGs = () => { setGsDone(true); save("pit.gsDismissed", true); };
  const full = filter === "following" ? followingFeed : filter === "local" ? localFeed : feed;
  const data = full.slice(0, count);
  const filteredPageLoading = loadingMore && count >= full.length;

  const pick = (f) => { setFilter(f); setCount(PAGE); };
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

  // Concert cards are tall and media-heavy. Stage them gently on phones so
  // image decoding and comment-preview mounts do not all hit one frame.
  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews
      initialNumToRender={phone ? 3 : PAGE}
      maxToRenderPerBatch={phone ? 2 : PAGE}
      updateCellsBatchingPeriod={phone ? 75 : 50}
      windowSize={phone ? 3 : 7}
      ListHeaderComponent={
        <View style={styles.head}>
          <View style={styles.wordmarkRow}>
            <Text style={styles.wordmark}>PIT</Text>
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
          <Text style={styles.tag}>shows worth seeing, from people you trust</Text>

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

          {loggedIn && newUser && !gsDone && (
            <View style={styles.gs}>
              <View style={styles.gsHead}>
                <Text style={styles.gsTitle}>Get started on Pit</Text>
                <Pressable onPress={dismissGs} hitSlop={10}><Icon name="x" size={16} color={colors.textDim} /></Pressable>
              </View>
              <GsStep n="1" icon="plus" label="Log your first show" sub="Rate the band and the room" onPress={onLogShow} />
              <GsStep n="2" icon="pin" label="Find shows near you" sub="Local venues & upcoming gigs" onPress={onOpenNearby} />
              <GsStep n="3" icon="edit" label="Complete your profile" sub="Photo, bio, favorite artists" onPress={onEditProfile} />
            </View>
          )}

          {loggedIn && (
            <View style={styles.segment}>
              <Seg label="Following" on={filter === "following"} onPress={() => pick("following")} />
              <Seg label="Local" on={filter === "local"} onPress={() => pick("local")} />
              <Seg label="Everyone" on={filter === "everyone"} onPress={() => pick("everyone")} />
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
        </View>
      }
      ListFooterComponent={filter !== "everyone" && (count < full.length || hasMore) ? (
        <Pressable
          style={[styles.olderBtn, filteredPageLoading && styles.olderBtnOff]}
          onPress={loadOlderFiltered}
          disabled={filteredPageLoading}
          accessibilityRole="button"
          accessibilityLabel="Load older posts"
          accessibilityState={{ disabled: filteredPageLoading }}
        >
          <Text style={styles.olderTxt}>
            {filteredPageLoading ? "Loading older posts..." : count < full.length ? "Show more posts" : "Load older posts"}
          </Text>
        </Pressable>
      ) : null}
      renderItem={({ item }) => (
        <TicketStub log={item} onOpen={onOpen} onComment={onComment} onPreview={onPreview} onOpenProfile={onOpenProfile} onOpenArtist={onOpenArtist} onOpenVenue={onOpenVenue} onReport={onReport} onEdit={onEdit} onOpenPhotos={onOpenPhotos} onPlay={onPlay} />
      )}
    />
  );
}

function Seg({ label, on, onPress }) {
  return (
    <Pressable style={[styles.seg, on && styles.segOn]} onPress={onPress}>
      <Text style={[styles.segTxt, on && styles.segTxtOn]}>{label}</Text>
    </Pressable>
  );
}

function GsStep({ n, icon, label, sub, onPress }) {
  return (
    <Pressable style={styles.gsStep} onPress={onPress}>
      <View style={styles.gsIcon}><Icon name={icon} size={16} color={colors.amber} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.gsLabel}>{label}</Text>
        <Text style={styles.gsSub}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={colors.textDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  gs: { backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, padding: 14, marginBottom: 14 },
  gsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  gsTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  gsStep: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 },
  gsIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  gsLabel: { color: colors.text, fontSize: 14, fontWeight: "700" },
  gsSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  emptyBox: { alignItems: "center", paddingTop: 40, paddingHorizontal: 30, gap: 6 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  emptySub: { color: colors.textDim, fontSize: 14, lineHeight: 20, textAlign: "center" },
  olderBtn: { alignSelf: "center", marginTop: 18, paddingHorizontal: 18, paddingVertical: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  olderBtnOff: { opacity: 0.55 },
  olderTxt: { color: colors.text, fontSize: 14, fontWeight: "800" },
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
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 21, fontStyle: "italic", paddingHorizontal: 4 },
});
