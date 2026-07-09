import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, radius, mono } from "../theme";
import Icon from "./Icon";
import SpotifyEmbed from "./SpotifyEmbed";

// In-app player sheet. Opens over whatever you were on, plays the track/artist via
// the Spotify embed, and closes back to it — nobody leaves the app.
export default function MediaSheet({ media, onClose }) {
  if (!media) return null;
  const { kind = "track", id, url, title, artist } = media;
  const height = kind === "artist" ? 352 : 152;
  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{title || artist || "Now playing"}</Text>
            {!!(title && artist) && <Text style={styles.sub} numberOfLines={1}>{artist}</Text>}
          </View>
          <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
            <Icon name="x" size={18} color={colors.text} />
          </Pressable>
        </View>
        <SpotifyEmbed kind={kind} id={id} url={url} height={height} />
        <Text style={styles.note}>Playing in-app · full tracks with a Spotify login</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,6,11,0.6)", justifyContent: "flex-end", zIndex: 50 },
  sheet: { backgroundColor: colors.bgElev, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderTopWidth: 1, borderColor: colors.line, padding: 16, paddingBottom: 28 },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 1 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  note: { color: colors.textFaint, fontFamily: mono, fontSize: 11, marginTop: 10, textAlign: "center" },
});
