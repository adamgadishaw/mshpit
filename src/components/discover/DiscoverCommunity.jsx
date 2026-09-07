import { Pressable, StyleSheet, Text, View } from "react-native";
import { memo, useState } from "react";
import { colors, font, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";
import SmartImage from "../SmartImage";
import ClipPoster from "../ClipPoster";
import { mediaDisplayKind, mediaPosterUri } from "../../domain/postMediaDisplay.mjs";
import { compactDiscoverNumber } from "../../domain/discoverView.mjs";
import { SectionHeading } from "./DiscoverPrimitives";
import { discoveryGridLayout } from "../../domain/discoveryGridLayout.mjs";

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
  const [containerWidth, setContainerWidth] = useState(null);
  const layout = discoveryGridLayout(containerWidth ?? Math.min(width, 1040) - (compact ? 54 : 86));
  if (!photos.length) return null;
  return (
    <View style={[styles.panel, compact && styles.panelCompact]}>
      <SectionHeading eyebrow="FAN PHOTOS AND VIDEOS" title="Popular photos and videos" detail="The most-liked concert photos and clips shared by fans" />
      <View style={[styles.grid, { gap: layout.gap }]} onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)} accessibilityLabel="Popular concert photos and videos">
        {photos.map((photo, index) => <PhotoTile key={`${photo.logId}_${photo.uri}_${index}`} photo={photo} index={index} width={layout.tileWidth} onOpen={() => onOpenPhotos?.(photoUris, index)} />)}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, padding: 18, gap: 14, ...shadow.card },
  panelCompact: { padding: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", width: "100%", minWidth: 0 },
  photoTile: { minWidth: 0, maxWidth: "100%", overflow: "hidden", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  photoImage: { width: "100%", aspectRatio: 1.28, backgroundColor: colors.bgElev },
  photoMeta: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 8 },
  photoCopy: { flex: 1, minWidth: 0 },
  photoArtist: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "800" },
  photoVenue: { color: colors.textDim, fontFamily: font, fontSize: 10.5, paddingTop: 2 },
  photoLikes: { flexDirection: "row", alignItems: "center", gap: 3 },
  photoLikesText: { color: colors.textDim, fontFamily: mono, fontSize: 10.5, fontWeight: "800" },
});
