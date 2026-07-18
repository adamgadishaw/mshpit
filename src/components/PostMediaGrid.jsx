import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, mono, radius } from "../theme";
import { isVideoUrl } from "../lib/img";
import SmartImage from "./SmartImage";

function Tile({ uri, index, onOpen, style, more = 0 }) {
  const video = isVideoUrl(uri);
  return (
    <Pressable
      style={[styles.tile, style]}
      onPress={onOpen ? () => onOpen(index) : undefined}
      accessibilityRole={onOpen ? "button" : undefined}
      accessibilityLabel={`${video ? "Play video" : "Open photo"}${more ? `, ${more} more items` : ""}`}
    >
      <SmartImage uri={uri} style={StyleSheet.absoluteFill} contain={false} />
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
export default function PostMediaGrid({ media = [], onOpen }) {
  const items = (Array.isArray(media) ? media : []).filter(Boolean);
  if (!items.length) return null;

  if (items.length === 1) {
    return (
      <View style={[styles.grid, styles.one]}>
        <Tile uri={items[0]} index={0} onOpen={onOpen} style={styles.fill} />
      </View>
    );
  }

  if (items.length === 2) {
    return (
      <View style={[styles.grid, styles.two, styles.row]}>
        <Tile uri={items[0]} index={0} onOpen={onOpen} style={styles.flex} />
        <Tile uri={items[1]} index={1} onOpen={onOpen} style={styles.flex} />
      </View>
    );
  }

  if (items.length === 3) {
    return (
      <View style={[styles.grid, styles.three, styles.row]}>
        <Tile uri={items[0]} index={0} onOpen={onOpen} style={styles.hero} />
        <View style={styles.stack}>
          <Tile uri={items[1]} index={1} onOpen={onOpen} style={styles.flex} />
          <Tile uri={items[2]} index={2} onOpen={onOpen} style={styles.flex} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.grid, styles.four]}>
      <View style={styles.row}>
        <Tile uri={items[0]} index={0} onOpen={onOpen} style={styles.flex} />
        <Tile uri={items[1]} index={1} onOpen={onOpen} style={styles.flex} />
      </View>
      <View style={styles.row}>
        <Tile uri={items[2]} index={2} onOpen={onOpen} style={styles.flex} />
        <Tile uri={items[3]} index={3} onOpen={onOpen} style={styles.flex} more={Math.max(0, items.length - 4)} />
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
