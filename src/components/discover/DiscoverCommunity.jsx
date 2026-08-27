import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { memo } from "react";
import { colors, font, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";
import SmartImage from "../SmartImage";
import ClipPoster from "../ClipPoster";
import { mediaDisplayKind, mediaPosterUri } from "../../domain/postMediaDisplay.mjs";
import { compactDiscoverNumber } from "../../domain/discoverView.mjs";
import { SectionHeading } from "./DiscoverPrimitives";

function PhotoTile({ photo, index, onOpen, width }) {
  const video = mediaDisplayKind(photo) === "video";
  const authoredAlt = typeof photo.altText === "string" ? photo.altText.trim() : "";
  const mediaLabel = authoredAlt || `Open concert ${video ? "clip" : "photo"} ${index + 1}${photo.artist ? `, ${photo.artist}` : ""}`;
  return (
    <Pressable style={[styles.photoTile, { width }]} onPress={onOpen} accessibilityRole="button" accessibilityLabel={mediaLabel} accessibilityHint={video ? "Opens the video player" : "Opens the full-size photo"}>
      {video ? (
        <ClipPoster uri={photo.uri} posterUri={mediaPosterUri(photo)} style={styles.photoImage} compact accessibilityLabel={authoredAlt || "Concert video preview"} accessible={false} />
      ) : (
        <SmartImage uri={photo.uri} mediaKind="image" style={styles.photoImage} contain={false} previewWidth={640} accessibilityLabel={authoredAlt || "Concert photo"} accessible={false} />
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
  rail: { gap: 11, paddingRight: 6 },
  photoTile: { overflow: "hidden", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  photoImage: { width: "100%", aspectRatio: 1.28, backgroundColor: colors.bgElev },
  photoMeta: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 8 },
  photoCopy: { flex: 1, minWidth: 0 },
  photoArtist: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "800" },
  photoVenue: { color: colors.textDim, fontFamily: font, fontSize: 10.5, paddingTop: 2 },
  photoLikes: { flexDirection: "row", alignItems: "center", gap: 3 },
  photoLikesText: { color: colors.textDim, fontFamily: mono, fontSize: 10.5, fontWeight: "800" },
});
