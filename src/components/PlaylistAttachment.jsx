import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, font, mono, radius } from "../theme";
import Icon from "./Icon";
import SmartImage from "./SmartImage";

// Map a post's immutable playlist snapshot to the player's track shape. Videos
// keep their exact resolved YouTube id, so playback never searches for a
// different upload of the same title.
export function playlistToTracks(playlist) {
  const list = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
  return list
    .filter((t) => t && t.title)
    .map((t) => ({
      kind: "track",
      title: t.title,
      artist: t.artist || null,
      url: t.url || null,
      id: t.sourceId || t.id || null,
      sourceId: t.sourceId || t.id || null,
      provider: t.provider || null,
      videoId: t.videoId || null,
      duration: t.duration || 0,
      art: t.art || null,
    }));
}

// A playable playlist share on a post: tap the header (or any track) to load the
// whole list into the player queue. onPlay is the app's openPlayer(media, queue).
export default function PlaylistAttachment({ playlist, onPlay }) {
  const tracks = playlistToTracks(playlist);
  if (!tracks.length) return null;
  const cover = tracks.find((t) => t.art)?.art || null;
  const count = tracks.length;
  const owner = playlist?.owner?.name;
  const play = (track = tracks[0]) => onPlay?.(track, tracks);

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.head}
        onPress={onPlay ? () => play() : undefined}
        accessibilityRole={onPlay ? "button" : undefined}
        accessibilityLabel={`Play playlist ${playlist?.name || ""}, ${count} ${count === 1 ? "song" : "songs"}`}
      >
        {cover ? <SmartImage uri={cover} style={styles.art} contain={false} /> : <View style={[styles.art, styles.artEmpty]}><Icon name="music" size={22} color={colors.amber} /></View>}
        <View style={styles.copy}>
          <Text style={styles.kicker}>PLAYLIST</Text>
          <Text style={styles.title} numberOfLines={2}>{playlist?.name || "Playlist"}</Text>
          <Text style={styles.meta} numberOfLines={1}>{count} {count === 1 ? "song" : "songs"}{owner ? ` · ${owner}` : ""}</Text>
        </View>
        <View style={styles.play}><Icon name="play" size={17} color="#1A1206" /></View>
      </Pressable>

      <View style={styles.tracks}>
        {tracks.slice(0, 3).map((t, i) => (
          <Pressable key={`${t.videoId || t.id || t.title}:${i}`} style={styles.trackRow} onPress={onPlay ? () => play(t) : undefined} accessibilityRole={onPlay ? "button" : undefined} accessibilityLabel={`Play ${t.title}`}>
            <Text style={styles.idx}>{i + 1}</Text>
            <Text style={styles.trackTitle} numberOfLines={1}>{t.title}</Text>
            {!!t.artist && <Text style={styles.trackArtist} numberOfLines={1}>{t.artist}</Text>}
          </Pressable>
        ))}
        {count > 3 && <Text style={styles.more}>+{count - 3} more {count - 3 === 1 ? "song" : "songs"}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10 },
  art: { width: 64, height: 64, borderRadius: radius.sm, borderCurve: "continuous" },
  artEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  copy: { flex: 1, minWidth: 0 },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.3, marginBottom: 3 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "800", lineHeight: 19 },
  meta: { color: colors.textDim, fontFamily: font, fontSize: 12, marginTop: 2 },
  play: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, paddingLeft: 2 },
  tracks: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 6 },
  trackRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  idx: { color: colors.textFaint, fontFamily: mono, fontSize: 11, width: 16 },
  trackTitle: { color: colors.text, fontFamily: font, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  trackArtist: { color: colors.textFaint, fontFamily: font, fontSize: 11, marginLeft: "auto", maxWidth: "45%" },
  more: { color: colors.textDim, fontFamily: mono, fontSize: 11, fontWeight: "700", paddingVertical: 5 },
});
