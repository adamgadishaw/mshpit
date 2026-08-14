import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { memo, useState } from "react";
import { colors, font, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";
import Avatar from "../Avatar";
import { proxied, isHttp } from "../../lib/img";
import { compactDiscoverNumber } from "../../domain/discoverView.mjs";
import { SectionHeading } from "./DiscoverPrimitives";

export const FriendsListening = memo(function FriendsListening({ rows, loading, error, signedIn, onRetry, onOpenProfile, onPlay }) {
  if (!signedIn || (!loading && !error && !rows.length)) return null;
  return (
    <View style={styles.panel}>
      <SectionHeading eyebrow="YOUR CIRCLE" title="Friends listening" detail="The latest play from people you follow" />
      {loading && !rows.length ? (
        <View style={styles.loading} accessibilityLiveRegion="polite" accessibilityLabel="Loading friends listening"><ActivityIndicator color={colors.amber} /><Text style={styles.stateCopy}>Checking your circle...</Text></View>
      ) : error ? (
        <View style={styles.loading} accessibilityLiveRegion="assertive">
          <Text style={styles.stateCopy} selectable>Friends listening could not update. Check your connection and try again.</Text>
          <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry loading friends listening"><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} accessibilityLabel="Friends listening">
          {rows.map((entry) => (
            <View key={entry.user.id} style={styles.friendCard}>
              <Pressable style={styles.friendPerson} onPress={() => onOpenProfile?.(entry.user.id)} accessibilityRole="button" accessibilityLabel={`Open ${entry.user.name}'s profile`}>
                <Avatar user={entry.user} size={44} />
                <Text style={styles.friendName} numberOfLines={1}>{entry.user.name}</Text>
              </Pressable>
              <Pressable style={styles.friendTrack} onPress={() => onPlay?.({ name: entry.track.artist, photo: entry.track.art, topTrack: entry.track })} accessibilityRole="button" accessibilityLabel={`Play ${entry.track.title} by ${entry.track.artist}`}>
                <Icon name="play" size={11} color={colors.amber} />
                <View style={styles.friendTrackCopy}>
                  <Text style={styles.friendTrackTitle} numberOfLines={1}>{entry.track.title}</Text>
                  <Text style={styles.friendTrackArtist} numberOfLines={1}>{entry.track.artist}</Text>
                </View>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
});

function PhotoTile({ photo, index, onOpen, width }) {
  const [failed, setFailed] = useState(false);
  return (
    <Pressable style={[styles.photoTile, { width }]} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open concert photo ${index + 1}${photo.artist ? `, ${photo.artist}` : ""}`}>
      {failed ? (
        <View style={styles.photoFallback}><Icon name="photo" size={26} color={colors.textFaint} /><Text style={styles.photoFallbackText}>Photo unavailable</Text></View>
      ) : (
        <Image source={{ uri: isHttp(photo.uri) ? proxied(photo.uri, 640) : photo.uri }} style={styles.photoImage} resizeMode="cover" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      )}
      <View style={styles.photoMeta}>
        <View style={styles.photoCopy}>
          <Text style={styles.photoArtist} numberOfLines={1}>{photo.artist || "Concert photo"}</Text>
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
      <SectionHeading eyebrow="FROM THE CROWD" title="Photos people are loving" detail="Most-liked concert shots from the community" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} accessibilityLabel="Top concert photos">
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
  friendTrack: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  friendTrackCopy: { flex: 1, minWidth: 0 },
  friendTrackTitle: { color: colors.text, fontFamily: font, fontSize: 11, fontWeight: "800" },
  friendTrackArtist: { color: colors.textDim, fontFamily: font, fontSize: 9.5, paddingTop: 1 },
  photoTile: { overflow: "hidden", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  photoImage: { width: "100%", aspectRatio: 1.28, backgroundColor: colors.bgElev },
  photoFallback: { width: "100%", aspectRatio: 1.28, alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: colors.bgElev },
  photoFallbackText: { color: colors.textFaint, fontFamily: font, fontSize: 11 },
  photoMeta: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 8 },
  photoCopy: { flex: 1, minWidth: 0 },
  photoArtist: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "800" },
  photoVenue: { color: colors.textDim, fontFamily: font, fontSize: 10.5, paddingTop: 2 },
  photoLikes: { flexDirection: "row", alignItems: "center", gap: 3 },
  photoLikesText: { color: colors.textDim, fontFamily: mono, fontSize: 10.5, fontWeight: "800" },
});
