import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Share } from "react-native";
import { colors, radius, shadow, displayFont } from "../theme";
import Icon from "../components/Icon";
import ConcertMemoryModal from "../components/ConcertMemoryModal";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { useStore } from "../store";
import { formatDate } from "../domain/dates.mjs";
import { concertMemoryShareText, selectConcertMemories, selectedConcertMemoryForAccount } from "../domain/concertMemories.mjs";
import { concertMemoryGallery } from "../domain/concertMemoryGallery.mjs";
import { useProfileHistory } from "../features/profileHistory/useProfileHistory";
import { useArtistEventReviews } from "../features/artistEvents/useArtistEventArchive";

// Loaded with the same lazy loader App.js uses, so both share one on-demand
// chunk. A static import here made the bundler hoist the whole profile screen
// into first-load code that every visitor downloads.
const ProfileScreen = lazyWithRetry(() => import("./ProfileScreen"), "ProfileScreen");

// The You tab is your own profile: the same page other members see, with your
// inbox, activity, calendar and settings in its header, and a private block of
// concert memories that only you see. Account tools that are not profile work
// (moderation, artist pages, log out) live in Settings, and artist
// recommendations live in Discover.
export default function YouScreen({ onLogin, onManageProfile, onSettings, onOpen, onOpenPost, onActivity, onInbox, onCalendar, profile = {} }) {
  const { session, logsByUser, unreadNotifications, inboxUnread } = useStore();
  const history = useProfileHistory({ accountId: session?.id, targetId: session?.id, enabled: !!session });
  const cachedMine = session ? logsByUser(session.id) : [];
  const mine = session && (history.posts.length || history.status === "ready") ? history.posts : cachedMine;
  const notif = session ? unreadNotifications() : 0;
  const unread = session ? inboxUnread() : 0;
  const [memoryStatus, setMemoryStatus] = useState("");
  const [memorySelection, setMemorySelection] = useState(null);
  const selectedMemory = selectedConcertMemoryForAccount(memorySelection, session?.id);
  const selectedMemoryLog = selectedMemory?.log || null;
  const selectedArchiveShowKey = selectedMemoryLog?.archiveShowKey || null;
  const { resource: selectedMemoryReviews } = useArtistEventReviews({
    accountId: session?.id || null,
    name: selectedMemory?.artist || null,
    artistKey: selectedMemoryLog?.artistKey || null,
    showKey: selectedArchiveShowKey,
    limit: 12,
    enabled: !!selectedMemory && !!selectedArchiveShowKey,
  });
  const selectedMemoryGallery = useMemo(
    () => concertMemoryGallery(selectedMemoryLog, selectedMemoryReviews.data?.reviews, { limit: 12 }),
    [selectedMemoryLog, selectedMemoryReviews.data?.reviews],
  );
  const selectedMemoryGalleryLoading = !!selectedArchiveShowKey
    && ["idle", "loading", "refreshing"].includes(selectedMemoryReviews.status);

  const memories = useMemo(
    () => selectConcertMemories(mine, { ownerId: session?.id, now: Date.now(), limit: 2 }),
    [mine, session?.id],
  );
  const shareMemory = async (memory) => {
    try {
      setMemoryStatus(`Opening share options for ${memory.artist}.`);
      const result = await Share.share({ title: "Concert memory", message: concertMemoryShareText(memory) });
      setMemoryStatus(result.action === Share.dismissedAction ? "Sharing canceled." : "Concert memory shared.");
    } catch {
      setMemoryStatus("That concert memory could not be shared. Please try again.");
    }
  };
  const openMemoryBreakdown = (log) => {
    setMemorySelection(null);
    onOpen?.(log);
  };
  const openMemoryPost = (log) => {
    setMemorySelection(null);
    onOpenPost?.(log);
  };

  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.loggedOut}>
          <View style={styles.loggedOutAvatar}>
            <Icon name="you" size={28} color={colors.textDim} />
          </View>
          <Text style={styles.heroName}>You&apos;re logged out</Text>
          <Text style={styles.heroHandle}>Log in to build your live-music history and post reviews.</Text>
          <Pressable style={styles.primary} onPress={onLogin}>
            <Text style={styles.primaryTxt}>LOG IN / SIGN UP</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const ownerTools = [
    { key: "inbox", icon: "mail", label: "Inbox", badge: unread, onPress: onInbox },
    { key: "activity", icon: "bell", label: "Activity", badge: notif, onPress: onActivity },
    { key: "calendar", icon: "calendar", label: "Calendar", onPress: onCalendar },
    { key: "settings", icon: "menu", label: "Settings", onPress: onSettings },
  ];

  return (
    <>
    <ProfileScreen {...profile} userId={session.id} asTab ownerTools={ownerTools} onManageProfile={onManageProfile}>
      {memories.length > 0 && (
        <View style={styles.memories}>
          <Text style={styles.sectionTitle}>Concert memories</Text>
          <Text style={styles.scopeCopy}>Only you can see this. Tap a memory for a quick look.</Text>
          <View style={styles.memoryGrid}>
            {memories.map((memory) => (
              <View key={memory.id} style={styles.memoryCard}>
                <View style={styles.memoryTop}>
                  <View style={styles.memoryIcon}><Icon name="ticket" size={18} color={memory.kind === "anniversary" ? colors.magenta : colors.amber} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.memoryKind}>{memory.kind === "anniversary" ? "Anniversary" : "Rediscover"}</Text>
                    <Text style={styles.memoryDetail}>{memory.detail}</Text>
                  </View>
                </View>
                <Text style={styles.memoryArtist} numberOfLines={1}>{memory.artist}</Text>
                <Text style={styles.memoryVenue} numberOfLines={2}>{memory.venue}{memory.city ? ` · ${memory.city}` : ""} · {formatDate(memory.date, memory.date)}</Text>
                <View style={styles.memoryActions}>
                  <Pressable style={styles.memoryAction} onPress={() => setMemorySelection({ accountId: session.id, memory })} accessibilityRole="button" accessibilityLabel={`Open memory for ${memory.artist}`}>
                    <Icon name="ticket" size={13} color={colors.amber} />
                    <Text style={styles.memoryActionText}>Open memory</Text>
                  </Pressable>
                  <Pressable style={styles.memoryAction} onPress={() => shareMemory(memory)} accessibilityRole="button" accessibilityLabel={`Share memory for ${memory.artist}`}>
                    <Icon name="share" size={13} color={colors.amber} />
                    <Text style={styles.memoryActionText}>Share memory</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
          {!!memoryStatus && <Text style={styles.actionStatus} accessibilityLiveRegion="polite">{memoryStatus}</Text>}
        </View>
      )}
    </ProfileScreen>
    <ConcertMemoryModal
      memory={selectedMemory}
      gallery={selectedMemoryGallery}
      galleryLoading={selectedMemoryGalleryLoading}
      onClose={() => setMemorySelection(null)}
      onOpenFull={onOpen ? openMemoryBreakdown : null}
      onOpenPost={onOpenPost ? openMemoryPost : null}
      onShare={shareMemory}
    />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  loggedOut: { alignItems: "center", marginTop: 60, gap: 6 },
  loggedOutAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  heroName: { color: colors.text, fontFamily: displayFont, fontSize: 22, fontWeight: "900", letterSpacing: -0.3 },
  heroHandle: { color: colors.textDim, fontSize: 13, marginTop: 3, textAlign: "center" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center", marginTop: 22 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },

  memories: { marginHorizontal: 16, marginTop: 20 },
  sectionTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: "800" },
  scopeCopy: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 12 },
  memoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  memoryCard: { flexGrow: 1, flexBasis: 260, minWidth: 0, gap: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, ...shadow.card },
  memoryTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  memoryIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  memoryKind: { color: colors.textDim, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  memoryDetail: { color: colors.magenta, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 2 },
  memoryArtist: { color: colors.text, fontSize: 16, fontWeight: "900" },
  memoryVenue: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  memoryActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  memoryAction: { minHeight: 44, flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  memoryActionText: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  actionStatus: { color: colors.textDim, fontSize: 12, marginTop: 8 },
});
