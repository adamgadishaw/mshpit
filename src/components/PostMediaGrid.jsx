import { useRef } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors, mono, radius } from "../theme";
import { isVideoUrl } from "../lib/img";
import SmartImage from "./SmartImage";
import { mediaDisplayItems, mediaDisplayUri } from "../domain/postMediaDisplay.mjs";
import { postMediaGridLayout } from "../domain/postMediaGridLayout.mjs";

function Tile({ item, index, onOpen, openerId, style, more = 0, contain = false }) {
  const openerRef = useRef(null);
  const uri = mediaDisplayUri(item);
  const video = isVideoUrl(uri);
  const authoredAlt = typeof item?.altText === "string" ? item.altText.trim() : "";
  return (
    <Pressable
      ref={openerRef}
      nativeID={openerId}
      style={[styles.tile, style]}
      onPress={onOpen ? () => onOpen(index, openerRef.current) : undefined}
      accessibilityRole={onOpen ? "button" : undefined}
      accessibilityLabel={authoredAlt || (video ? "Concert video" : "Concert photo")}
      accessibilityHint={`${video ? "Double tap to play video" : "Double tap to open photo"}${more ? `. Opens a gallery with ${more} more items` : ""}`}
    >
      {/* Feed cards need a screen-sized derivative, not a 12 MP original. The
          full durable object remains untouched for PhotoViewer. */}
      <SmartImage
        uri={uri}
        posterUri={item?.posterUrl || null}
        style={StyleSheet.absoluteFill}
        contain={contain}
        previewWidth={1200}
        accessible={false}
      />
      {!!more && (
        <View style={styles.moreScrim} pointerEvents="none">
          <Text style={styles.moreText}>+{more}</Text>
        </View>
      )}
    </Pressable>
  );
}

// A predictable Facebook-style collage: media stays large enough to understand
// in the feed, while the full uncropped item remains one tap away in the viewer.
// The component is shared by status and concert posts so neither falls back to
// the old 64px thumbnail strip.
export default function PostMediaGrid({ media = [], onOpen, openerScope = null }) {
  const { width: viewportWidth } = useWindowDimensions();
  const items = mediaDisplayItems({ photos: Array.isArray(media) ? media : [] });
  if (!items.length) return null;
  const openerScopeKey = openerScope === null || openerScope === undefined
    ? null
    : String(openerScope).replace(/[^A-Za-z0-9_-]/g, "-");
  const openerIdFor = (index) => openerScopeKey ? `pit-media-${openerScopeKey}-${index}` : undefined;

  const desktopLayout = postMediaGridLayout({
    viewportWidth,
    count: items.length,
    width: items[0]?.width,
    height: items[0]?.height,
  });
  const desktopGridStyle = desktopLayout.desktop
    ? { maxWidth: desktopLayout.maxWidth, alignSelf: "center" }
    : null;

  if (items.length === 1) {
    return (
      <View style={[styles.grid, styles.one, desktopGridStyle, desktopLayout.aspectRatio ? { aspectRatio: desktopLayout.aspectRatio } : null]}>
        <Tile item={items[0]} index={0} onOpen={onOpen} openerId={openerIdFor(0)} style={styles.fill} contain={desktopLayout.containSingle} />
      </View>
    );
  }

  if (items.length === 2) {
    return (
      <View style={[styles.grid, styles.two, styles.row, desktopGridStyle]}>
        <Tile item={items[0]} index={0} onOpen={onOpen} openerId={openerIdFor(0)} style={styles.flex} />
        <Tile item={items[1]} index={1} onOpen={onOpen} openerId={openerIdFor(1)} style={styles.flex} />
      </View>
    );
  }

  if (items.length === 3) {
    return (
      <View style={[styles.grid, styles.three, styles.row, desktopGridStyle]}>
        <Tile item={items[0]} index={0} onOpen={onOpen} openerId={openerIdFor(0)} style={styles.hero} />
        <View style={styles.stack}>
          <Tile item={items[1]} index={1} onOpen={onOpen} openerId={openerIdFor(1)} style={styles.flex} />
          <Tile item={items[2]} index={2} onOpen={onOpen} openerId={openerIdFor(2)} style={styles.flex} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.grid, styles.four, desktopGridStyle]}>
      <View style={styles.row}>
        <Tile item={items[0]} index={0} onOpen={onOpen} openerId={openerIdFor(0)} style={styles.flex} />
        <Tile item={items[1]} index={1} onOpen={onOpen} openerId={openerIdFor(1)} style={styles.flex} />
      </View>
      <View style={styles.row}>
        <Tile item={items[2]} index={2} onOpen={onOpen} openerId={openerIdFor(2)} style={styles.flex} />
        <Tile item={items[3]} index={3} onOpen={onOpen} openerId={openerIdFor(3)} style={styles.flex} more={Math.max(0, items.length - 4)} />
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
