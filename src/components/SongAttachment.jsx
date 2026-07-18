import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, font, mono, radius } from "../theme";
import Icon from "./Icon";
import SmartImage from "./SmartImage";

export function songToTrack(song) {
  if (!song?.videoId) return null;
  return {
    title: song.title || "Shared from YouTube",
    artist: song.artist || "YouTube",
    art: song.thumb || null,
    videoId: song.videoId,
  };
}

// A compact, playable song share that still reads as part of the post. The
// validated YouTube id goes directly to the player, so it never searches for a
// similarly named song and accidentally swaps in karaoke or lyric uploads.
export default function SongAttachment({ song, onPlay, compact = false }) {
  const track = songToTrack(song);
  if (!track) return null;
  return (
    <Pressable
      style={[styles.card, compact && styles.compact]}
      onPress={onPlay ? () => onPlay(track) : undefined}
      accessibilityRole={onPlay ? "button" : undefined}
      accessibilityLabel={`Play ${track.title} by ${track.artist}`}
    >
      <SmartImage uri={track.art} style={[styles.art, compact && styles.artCompact]} contain={false} />
      <View style={styles.copy}>
        <Text style={styles.kicker}>SONG ON REPEAT</Text>
        <Text style={styles.title} numberOfLines={2}>{track.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
      </View>
      <View style={styles.play}><Icon name="play" size={17} color="#1A1206" /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, padding: 10, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  compact: { marginTop: 0 },
  art: { width: 94, height: 70, borderRadius: radius.sm, borderCurve: "continuous" },
  artCompact: { width: 72, height: 54 },
  copy: { flex: 1, minWidth: 0 },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.3, marginBottom: 3 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 14.5, fontWeight: "800", lineHeight: 19 },
  artist: { color: colors.textDim, fontFamily: font, fontSize: 12, marginTop: 2 },
  play: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, paddingLeft: 2 },
});
