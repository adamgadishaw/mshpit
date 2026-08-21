import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { memo } from "react";
import { colors, font, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";
import Avatar from "../Avatar";
import SmartImage from "../SmartImage";
import ClipPoster from "../ClipPoster";
import { isVideoUrl } from "../../lib/img";
import { compactDiscoverNumber, discoverPlaybackTrack } from "../../domain/discoverView.mjs";
import { presentFriendsListening } from "../../domain/listeningRediscovery.mjs";
import { SectionHeading } from "./DiscoverPrimitives";

function FriendTrack({ entry, onPlay, onAdd }) {
  const track = discoverPlaybackTrack(entry);
  const copy = (
    <>
      {track ? <Icon name="play" size={11} color={colors.amber} /> : null}
      <View style={styles.friendTrackCopy}>
        <Text style={styles.friendTrackTitle} numberOfLines={1}>{entry.track.title}</Text>
        <Text style={styles.friendTrackArtist} numberOfLines={1}>{entry.track.artist}</Text>
        <Text style={styles.friendTrackTime} numberOfLines={1} accessibilityLabel={entry.recency.label}>{entry.recency.label}</Text>
      </View>
    </>
  );
  if (!track) return <View style={styles.friendTrack}>{copy}</View>;
  return (
    <View style={styles.friendTrackActions}>
      <Pressable style={[styles.friendTrack, styles.friendTrackPlayable]} onPress={() => onPlay?.(track)} accessibilityRole="button" accessibilityLabel={`Play ${track.title} by ${track.artist}. ${entry.recency.label}`}>
        {copy}
      </Pressable>
      <Pressable style={styles.friendTrackAdd} onPress={() => onAdd?.(track)} accessibilityRole="button" accessibilityLabel={`Add ${track.title} by ${track.artist} to a playlist`}>
        <Icon name="plus" size={14} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

export const FriendsListening = memo(function FriendsListening({ rows, loading, error, signedIn, onRetry, onOpenProfile, onPlay, onAdd }) {
  const visibleRows = presentFriendsListening(rows, { now: Date.now() });
  if (!signedIn || (!loading && !error && !visibleRows.length)) return null;
  const hasFreshPlay = visibleRows.some((entry) => entry.recency.state === "fresh");
  return (
    <View style={styles.panel}>
      <SectionHeading eyebrow="YOUR CIRCLE" title={hasFreshPlay ? "Fresh plays from friends" : "Friends' last plays"} detail="Recent activity from people you follow" />
      {loading && !visibleRows.length ? (
        <View style={styles.loading} accessibilityLiveRegion="polite" accessibilityLabel="Loading friends listening"><ActivityIndicator color={colors.amber} /><Text style={styles.stateCopy}>Checking your circle...</Text></View>
      ) : error ? (
        <View style={styles.loading} accessibilityLiveRegion="assertive">
          <Text style={styles.stateCopy} selectable>Friends listening could not update. Check your connection and try again.</Text>
          <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry loading friends listening"><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} accessibilityLabel="Friends listening">
          {visibleRows.map((entry) => (
            <View key={entry.user.id} style={styles.friendCard}>
              <Pressable style={styles.friendPerson} onPress={() => onOpenProfile?.(entry.user.id)} accessibilityRole="button" accessibilityLabel={`Open ${entry.user.name}'s profile`}>
                <Avatar user={entry.user} size={44} />
                <Text style={styles.friendName} numberOfLines={1}>{entry.user.name}</Text>
              </Pressable>
              <FriendTrack entry={entry} onPlay={onPlay} onAdd={onAdd} />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
});

function PhotoTile({ photo, index, onOpen, width }) {
  const video = photo.kind === "video" || photo.type === "video" || isVideoUrl(photo.uri);
  const authoredAlt = typeof photo.altText === "string" ? photo.altText.trim() : "";
  const mediaLabel = authoredAlt || `Open concert ${video ? "clip" : "photo"} ${index + 1}${photo.artist ? `, ${photo.artist}` : ""}`;
  return (
    <Pressable style={[styles.photoTile, { width }]} onPress={onOpen} accessibilityRole="button" accessibilityLabel={mediaLabel} accessibilityHint={video ? "Opens the video player" : "Opens the full-size photo"}>
      {video ? (
        <ClipPoster uri={photo.uri} posterUri={photo.posterUrl || photo.posterUri || null} style={styles.photoImage} compact accessibilityLabel={authoredAlt || "Concert video preview"} accessible={false} />
      ) : (
        <SmartImage uri={photo.uri} posterUri={photo.posterUrl || photo.posterUri || null} style={styles.photoImage} contain={false} previewWidth={640} accessibilityLabel={authoredAlt || "Concert photo"} accessible={false} />
      )}
      <View style={styles.photoMeta}>
        <View style={styles.photoCopy}>
          <Text style={styles.photoArtist} numberOfLines={1}>{photo.artist || (video ? "Concert clip" : "Concert photo")}</Text>
          {!!photo.venue && <Text style={styles.photoVenue} numberOfLines={1}>{photo.venue}</Text>}
        </View>
        {!!photo.likes && <View style={styles.photoLikes}><Icon name="heart" size={12} color={colors.magenta} filled /><Text style={styles.photoLikesText}>{compactDiscoverNumber(photo.likes)}</Text></View>}
      </View>
    </Pressable>
  );
}

export const DiscoverPhotos = memo(function DiscoverPhotos({ photos, photoUris, compact, width, onOpenPhotos }) {
  if (!photos.length) return null;
  return (
    <View style={styles.panel}>
      <SectionHeading eyebrow="FROM THE CROWD" title="Media people are loving" detail="Most-liked concert photos and clips from the community" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} accessibilityLabel="Top concert media">
        {photos.map((photo, index) => <PhotoTile key={`${photo.logId}_${photo.uri}_${index}`} photo={photo} index={index} width={compact ? Math.min(236, width - 64) : 250} onOpen={() => onOpenPhotos?.(photoUris, index)} />)}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, padding: 18, gap: 14, ...shadow.card },
  loading: { minHeight: 100, alignItems: "center", justifyContent: "center", gap: 8 },
  stateCopy: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, textAlign: "center", maxWidth: 420 },
  retryButton: { minHeight: 44, paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.amber, fontFamily: font, fontSize: 12.5, fontWeight: "900" },
  rail: { gap: 11, paddingRight: 6 },
  friendCard: { width: 166, padding: 11, gap: 9, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  friendPerson: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 8 },
  friendName: { flex: 1, color: colors.text, fontFamily: font, fontSize: 12, fontWeight: "800" },
  friendTrackActions: { flexDirection: "row", alignItems: "stretch", gap: 5 },
  friendTrack: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  friendTrackPlayable: { flex: 1, minWidth: 0 },
  friendTrackAdd: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  friendTrackCopy: { flex: 1, minWidth: 0 },
  friendTrackTitle: { color: colors.text, fontFamily: font, fontSize: 11, fontWeight: "800" },
  friendTrackArtist: { color: colors.textDim, fontFamily: font, fontSize: 9.5, paddingTop: 1 },
  friendTrackTime: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, paddingTop: 2 },
  photoTile: { overflow: "hidden", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  photoImage: { width: "100%", aspectRatio: 1.28, backgroundColor: colors.bgElev },
  photoMeta: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 8 },
  photoCopy: { flex: 1, minWidth: 0 },
  photoArtist: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "800" },
  photoVenue: { color: colors.textDim, fontFamily: font, fontSize: 10.5, paddingTop: 2 },
  photoLikes: { flexDirection: "row", alignItems: "center", gap: 3 },
  photoLikesText: { color: colors.textDim, fontFamily: mono, fontSize: 10.5, fontWeight: "800" },
});
