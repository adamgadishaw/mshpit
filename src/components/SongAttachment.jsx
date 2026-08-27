import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, font, mono, radius } from "../theme";
import { ENABLE_MUSIC_PLAYER } from "../config/runtime.mjs";
import { sharedYouTubeUrl } from "../domain/sharedYouTubeAttachment.mjs";
import Icon from "./Icon";
import SmartImage from "./SmartImage";

export function songToTrack(song) {
  const youtubeUrl = sharedYouTubeUrl(song);
  if (!youtubeUrl) return null;
  return {
    title: song.title || "Shared from YouTube",
    artist: song.artist || "YouTube",
    art: song.thumb || null,
    videoId: song.videoId.trim(),
    youtubeUrl,
  };
}

// A shared YouTube video, rendered like Facebook/Twitter render one: a large
// 16:9 thumbnail and title make it read as real media in the post rather than a
// tiny sidebar chip. While MSHpit playback is unavailable, the validated video
// id opens the exact shared YouTube page instead of re-searching or guessing.
//
// `compact` keeps the old small horizontal card for tight contexts (the composer
// preview, playlist rows) where a full media block would be too heavy.
export default function SongAttachment({ song, onPlay, compact = false }) {
  const track = songToTrack(song);
  if (!track) return null;
  const canUsePlayer = ENABLE_MUSIC_PLAYER && typeof onPlay === "function";
  const press = canUsePlayer
    ? () => onPlay(track)
    : () => {
      void Linking.openURL(track.youtubeUrl).catch(() => {
        // architecture: allow-empty-catch -- The post stays usable if the external browser declines a validated YouTube URL.
      });
    };
  const a11y = {
    accessibilityRole: canUsePlayer ? "button" : "link",
    accessibilityLabel: canUsePlayer
      ? `Play ${track.title} by ${track.artist}`
      : `Open ${track.title} by ${track.artist} on YouTube`,
  };

  if (compact) {
    return (
      <Pressable style={styles.compactCard} onPress={press} {...a11y}>
        <SmartImage uri={track.art} style={styles.compactArt} contain={false} />
        <View style={styles.compactCopy}>
          <Text style={styles.kicker}>{canUsePlayer ? "PLAY" : "WATCH ON YOUTUBE"}</Text>
          <Text style={styles.compactTitle} numberOfLines={2}>{track.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
        </View>
        <View style={styles.compactPlay}><Icon name="play" size={16} color="#1A1206" /></View>
      </Pressable>
    );
  }

  return (
    <Pressable style={styles.card} onPress={press} {...a11y}>
      <View style={styles.stage}>
        <SmartImage uri={track.art} style={StyleSheet.absoluteFill} contain={false} />
        {/* A soft bottom gradient-ish scrim keeps the title legible over any frame. */}
        <View style={styles.scrim} pointerEvents="none" />
        <View style={styles.playWrap} pointerEvents="none">
          <View style={styles.playBig}><Icon name="play" size={26} color="#1A1206" /></View>
        </View>
        <View style={styles.badge} pointerEvents="none">
          <Icon name="play" size={9} color={colors.amber} />
          <Text style={styles.badgeTxt}>{canUsePlayer ? "PLAY" : "WATCH ON YOUTUBE"}</Text>
        </View>
      </View>
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>{track.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{track.artist}{canUsePlayer ? "  ·  play" : "  ·  YouTube"}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // ---- large Facebook-style media card (default) ----
  card: {
    marginTop: 12,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.lineSoft,
    backgroundColor: colors.bgElev,
    overflow: "hidden",
  },
  stage: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000", justifyContent: "center", alignItems: "center" },
  scrim: { ...StyleSheet.absoluteFillObject, top: "55%", backgroundColor: "rgba(5,7,12,0.28)" },
  playWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  playBig: {
    width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center",
    paddingLeft: 3, backgroundColor: colors.amberStrong,
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  badge: {
    position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(5,7,12,0.66)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  badgeTxt: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  meta: { paddingHorizontal: 13, paddingVertical: 11, gap: 3 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "800", lineHeight: 21 },
  artist: { color: colors.textDim, fontFamily: font, fontSize: 12.5 },

  // ---- compact horizontal card (composer preview, playlist rows) ----
  compactCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  compactArt: { width: 72, height: 54, borderRadius: radius.sm, borderCurve: "continuous" },
  compactCopy: { flex: 1, minWidth: 0 },
  compactTitle: { color: colors.text, fontFamily: displayFont, fontSize: 14.5, fontWeight: "800", lineHeight: 19 },
  compactPlay: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, paddingLeft: 2 },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.3, marginBottom: 3 },
});
