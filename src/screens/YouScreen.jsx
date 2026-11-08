import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Share, Platform, useWindowDimensions } from "react-native";
import { colors, radius, shadow, displayFont } from "../theme";
import Icon from "../components/Icon";
import SmartImage from "../components/SmartImage";
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
const IS_IOS = Platform.OS === "ios";
const MemoryCollection = IS_IOS ? ScrollView : View;
const ProfileScreen = lazyWithRetry(() => import("./ProfileScreen"), "ProfileScreen");

// The You tab is your own profile: the same page other members see, with your
// inbox, activity, calendar and settings in its header, and a private block of
// concert memories that only you see. Account tools that are not profile work
// (moderation, artist pages, log out) live in Settings, and artist
// recommendations live in Discover.
export default function YouScreen({ onLogin, onManageProfile, onSettings, onOpen, onOpenPost, onActivity, onInbox, onCalendar, profile = {} }) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const largeText = IS_IOS && fontScale > 1.25;
  const memoryCardWidth = Math.min(largeText ? 420 : 280, Math.max(1, windowWidth - 48));
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
          <Text style={styles.heroName}>{IS_IOS ? "Your live-music life" : "You're logged out"}</Text>
          <Text style={styles.heroHandle}>{IS_IOS ? "Keep the shows, photos and memories that stay with you." : "Log in to build your live-music history and post reviews."}</Text>
          <Pressable style={styles.primary} onPress={onLogin} {...(IS_IOS ? { accessibilityRole: "button", accessibilityLabel: "Log in or sign up" } : {})}>
            <Text style={styles.primaryTxt}>{IS_IOS ? "Log in or sign up" : "LOG IN / SIGN UP"}</Text>
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
          <View style={styles.memoriesHeading}><Text style={styles.sectionTitle} {...(IS_IOS ? { accessibilityRole: "header" } : {})}>Concert memories</Text>{IS_IOS ? <View style={styles.privateLabel}><Icon name="lock" size={12} color={colors.textDim} /><Text style={styles.privateLabelText}>Only you</Text></View> : null}</View>
          <Text style={styles.scopeCopy}>{IS_IOS ? "Great nights, worth another look." : "Only you can see this. Tap a memory for a quick look."}</Text>
          <MemoryCollection horizontal={IS_IOS || undefined} showsHorizontalScrollIndicator={IS_IOS ? false : undefined} contentContainerStyle={IS_IOS ? styles.memoryGrid : undefined} style={IS_IOS ? styles.memoryRail : styles.memoryGrid}>
            {memories.map((memory) => {
              // Only explicit still-image descriptors are used as artwork. Legacy
              // and video-only memories keep the dated ticket fallback.
              const artwork = IS_IOS ? concertMemoryGallery(memory.log, []).find((item) => item.kind === "image") : null;
              return <View key={memory.id} style={[styles.memoryCard, IS_IOS && { width: memoryCardWidth }]}>
                {IS_IOS ? <Pressable style={styles.memoryArtwork} onPress={() => setMemorySelection({ accountId: session.id, memory })} accessibilityRole="button" accessibilityLabel={`Preview concert memory for ${memory.artist}`}>
                  {artwork ? <SmartImage uri={artwork.uri} style={StyleSheet.absoluteFill} contain={false} accessible={false} /> : <View style={styles.memoryArtworkFallback}><Icon name="ticket" size={42} color={colors.amber} /><Text style={styles.memoryYear}>{memory.date.slice(0, 4)}</Text></View>}
                </Pressable> : null}
                <View style={styles.memoryTop}>
                  <View style={styles.memoryIcon}><Icon name="ticket" size={18} color={memory.kind === "anniversary" ? colors.magenta : colors.amber} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.memoryKind}>{memory.kind === "anniversary" ? "Anniversary" : "Rediscover"}</Text>
                    <Text style={styles.memoryDetail}>{memory.detail}</Text>
                  </View>
                </View>
                <Text style={styles.memoryArtist} numberOfLines={IS_IOS ? undefined : 1}>{memory.artist}</Text>
                <Text style={styles.memoryVenue} numberOfLines={IS_IOS ? undefined : 2}>{memory.venue}{memory.city ? ` · ${memory.city}` : ""} · {formatDate(memory.date, memory.date)}</Text>
                <View style={[styles.memoryActions, largeText && styles.nativeMemoryActionsLarge]}>
                  <Pressable style={styles.memoryAction} onPress={() => setMemorySelection({ accountId: session.id, memory })} accessibilityRole="button" accessibilityLabel={`Open memory for ${memory.artist}`}>
                    <Icon name="ticket" size={13} color={colors.amber} />
                    <Text style={styles.memoryActionText}>Open memory</Text>
                  </Pressable>
                  <Pressable style={styles.memoryAction} onPress={() => shareMemory(memory)} accessibilityRole="button" accessibilityLabel={`Share memory for ${memory.artist}`}>
                    <Icon name="share" size={13} color={colors.amber} />
                    <Text style={styles.memoryActionText}>Share memory</Text>
                  </Pressable>
                </View>
              </View>;
            })}
          </MemoryCollection>
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

const baseStyles = StyleSheet.create({
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


const iosStyles = IS_IOS ? StyleSheet.create({
  content: { padding: 24, paddingBottom: 48 },
  loggedOut: { alignItems: "flex-start", marginTop: 48, gap: 12 },
  loggedOutAvatar: { ...baseStyles.loggedOutAvatar, width: 80, height: 80, borderRadius: 24, borderWidth: 0, marginBottom: 14 },
  heroName: { color: colors.text, fontSize: 34, fontWeight: "700", letterSpacing: -0.8 },
  heroHandle: { color: colors.textDim, fontSize: 17, lineHeight: 25, marginTop: 4 },
  primary: { ...baseStyles.primary, minHeight: 50, borderRadius: 14, alignSelf: "stretch" },
  primaryTxt: { color: "#1A1206", fontSize: 17, fontWeight: "600" },
  memories: { marginTop: 28 },
  memoriesHeading: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginHorizontal: 24 },
  sectionTitle: { flexShrink: 1, maxWidth: "100%", color: colors.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.35 },
  privateLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
  privateLabelText: { color: colors.textDim, fontSize: 12 },
  scopeCopy: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginTop: 5, marginBottom: 16, marginHorizontal: 24 },
  memoryRail: { overflow: "visible" },
  memoryGrid: { flexDirection: "row", alignItems: "flex-start", gap: 14, paddingHorizontal: 24, paddingBottom: 4 },
  memoryCard: { width: 280, gap: 10, padding: 0 },
  memoryArtwork: { width: "100%", aspectRatio: 1.75, backgroundColor: colors.surfaceAlt, borderRadius: 14, overflow: "hidden" },
  memoryArtworkFallback: { flex: 1, padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  memoryYear: { flexShrink: 1, color: colors.textDim, fontSize: 36, fontWeight: "300", letterSpacing: -1.5 },
  memoryTop: { flexDirection: "row", gap: 9, alignItems: "center", marginTop: 2 },
  memoryIcon: { display: "none" },
  memoryKind: { color: colors.amber, fontSize: 12, fontWeight: "600" },
  memoryDetail: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  memoryArtist: { color: colors.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.25 },
  memoryVenue: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  memoryActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  nativeMemoryActionsLarge: { flexDirection: "column", alignItems: "stretch" },
  memoryAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, maxWidth: "100%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  memoryActionText: { flexShrink: 1, color: colors.amber, fontSize: 13, fontWeight: "600" },
  actionStatus: { color: colors.textDim, fontSize: 13, marginTop: 12, marginHorizontal: 24 },
}) : {};
const styles = { ...baseStyles, ...iosStyles };
