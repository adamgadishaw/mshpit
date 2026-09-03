import { useRef } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors, mono, radius } from "../theme";
import SmartImage from "./SmartImage";
import { mediaDisplayItems, mediaDisplayKind, mediaDisplayUri, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import { postMediaGridLayout, postMediaPreviewWidth } from "../domain/postMediaGridLayout.mjs";

function Tile({ item, index, onOpen, openerId, style, more = 0, contain = false, viewable = null, previewWidth }) {
  const openerRef = useRef(null);
  const uri = mediaDisplayUri(item);
  const mediaKind = mediaDisplayKind(item);
  const video = mediaKind === "video";
  const authoredAlt = typeof item?.altText === "string" ? item.altText.trim() : "";
  const interactive = typeof onOpen === "function";
  const accessibilityLabel = authoredAlt || (video ? "Concert video" : "Concert photo");
  const moreHint = more
    ? ` Opens a gallery with ${more} additional ${more === 1 ? "item" : "items"}.`
    : "";
  const content = (
    <>
      {/* Feed cards need a screen-sized derivative, not a 12 MP original. The
          full durable object remains untouched for PhotoViewer. */}
      <SmartImage
        uri={uri}
        posterUri={mediaPosterUri(item)}
        mediaKind={mediaKind}
        viewable={viewable}
        style={StyleSheet.absoluteFill}
        // Photos keep the collage crop. A video poster forwards `null` instead
        // of a hard `false` so ClipPoster can letterbox it on wide desktop
        // tiles, where covering a portrait clip hides most of the frame.
        contain={video && contain !== true ? null : contain}
        previewWidth={previewWidth}
        priority={index === 0 && viewable === true ? "high" : "normal"}
        loading={viewable === true ? "eager" : "lazy"}
        accessible={false}
      />
      {!!more && (
        <View style={styles.moreScrim} pointerEvents="none">
          <Text style={styles.moreText}>+{more}</Text>
        </View>
      )}
    </>
  );

  if (!interactive) {
    return (
      <View style={[styles.tile, style]} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      ref={openerRef}
      nativeID={openerId}
      style={[styles.tile, style]}
      onPress={() => onOpen(index, openerRef.current)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={`${video ? "Opens the video player." : "Opens the full-size photo."}${moreHint}`}
    >
      {content}
    </Pressable>
  );
}

// A predictable Facebook-style collage: media stays large enough to understand
// in the feed, while the full uncropped item remains one tap away in the viewer.
// The component is shared by status and concert posts so neither falls back to
// the old 64px thumbnail strip.
export default function PostMediaGrid({ media = [], onOpen, openerScope = null, viewable = null }) {
  const { width: viewportWidth, height: viewportHeight, scale } = useWindowDimensions();
  const items = mediaDisplayItems({ photos: Array.isArray(media) ? media : [] });
  if (!items.length) return null;
  const openerScopeKey = openerScope === null || openerScope === undefined
    ? null
    : String(openerScope).replace(/[^A-Za-z0-9_-]/g, "-");
  const openerIdFor = (index) => openerScopeKey ? `pit-media-${openerScopeKey}-${index}` : undefined;

  const desktopLayout = postMediaGridLayout({
    viewportWidth,
    viewportHeight,
    count: items.length,
    width: items[0]?.width,
    height: items[0]?.height,
  });
  const desktopGridStyle = desktopLayout.desktop
    ? { maxWidth: desktopLayout.maxWidth, alignSelf: "center" }
    : null;
  const previewWidthFor = (tileFraction) => postMediaPreviewWidth({
    viewportWidth,
    scale,
    desktopMaxWidth: desktopLayout.desktop ? desktopLayout.maxWidth : null,
    tileFraction,
  });

  if (items.length === 1) {
    return (
      <View style={[styles.grid, styles.one, desktopGridStyle, desktopLayout.aspectRatio ? { aspectRatio: desktopLayout.aspectRatio } : null]}>
        <Tile item={items[0]} index={0} onOpen={onOpen} openerId={openerIdFor(0)} style={styles.fill} contain={desktopLayout.containSingle} viewable={viewable} previewWidth={previewWidthFor(1)} />
      </View>
    );
  }

  if (items.length === 2) {
    return (
      <View style={[styles.grid, styles.two, styles.row, desktopGridStyle]}>
        <Tile item={items[0]} index={0} onOpen={onOpen} openerId={openerIdFor(0)} style={styles.flex} viewable={viewable} previewWidth={previewWidthFor(1 / 2)} />
        <Tile item={items[1]} index={1} onOpen={onOpen} openerId={openerIdFor(1)} style={styles.flex} viewable={viewable} previewWidth={previewWidthFor(1 / 2)} />
      </View>
    );
  }

  if (items.length === 3) {
    return (
      <View style={[styles.grid, styles.three, styles.row, desktopGridStyle]}>
        <Tile item={items[0]} index={0} onOpen={onOpen} openerId={openerIdFor(0)} style={styles.hero} viewable={viewable} previewWidth={previewWidthFor(2 / 3)} />
        <View style={styles.stack}>
          <Tile item={items[1]} index={1} onOpen={onOpen} openerId={openerIdFor(1)} style={styles.flex} viewable={viewable} previewWidth={previewWidthFor(1 / 3)} />
          <Tile item={items[2]} index={2} onOpen={onOpen} openerId={openerIdFor(2)} style={styles.flex} viewable={viewable} previewWidth={previewWidthFor(1 / 3)} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.grid, styles.four, desktopGridStyle]}>
      <View style={styles.row}>
        <Tile item={items[0]} index={0} onOpen={onOpen} openerId={openerIdFor(0)} style={styles.flex} viewable={viewable} previewWidth={previewWidthFor(1 / 2)} />
        <Tile item={items[1]} index={1} onOpen={onOpen} openerId={openerIdFor(1)} style={styles.flex} viewable={viewable} previewWidth={previewWidthFor(1 / 2)} />
      </View>
      <View style={styles.row}>
        <Tile item={items[2]} index={2} onOpen={onOpen} openerId={openerIdFor(2)} style={styles.flex} viewable={viewable} previewWidth={previewWidthFor(1 / 2)} />
        <Tile item={items[3]} index={3} onOpen={onOpen} openerId={openerIdFor(3)} style={styles.flex} more={Math.max(0, items.length - 4)} viewable={viewable} previewWidth={previewWidthFor(1 / 2)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: "100%",
    marginTop: 12,
    overflow: "hidden",
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.lineSoft,
    backgroundColor: colors.bgElev,
    gap: 2,
  },
  one: { aspectRatio: 4 / 3 },
  two: { aspectRatio: 16 / 9 },
  three: { aspectRatio: 4 / 3 },
  four: { aspectRatio: 4 / 3 },
  row: { flexDirection: "row", flex: 1, gap: 2 },
  stack: { flex: 1, gap: 2 },
  flex: { flex: 1 },
  hero: { flex: 2 },
  fill: { ...StyleSheet.absoluteFillObject },
  tile: { minWidth: 0, minHeight: 0, overflow: "hidden", backgroundColor: colors.bgElev },
  moreScrim: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,7,12,0.62)" },
  moreText: { color: "#fff", fontFamily: mono, fontSize: 30, fontWeight: "900", textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 8 },
});
