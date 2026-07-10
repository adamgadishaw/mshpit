import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { colors, radius, mono, shadow } from "../theme";
import Icon from "./Icon";
import SpotifyEmbed from "./SpotifyEmbed";

// Persistent player bar pinned to the very top — a toolbar you can keep listening
// through while you browse profiles / artists / fan clubs. Lives at the app root
// (never unmounted on navigation), plays the queue via the Spotify embed (full
// tracks for logged-in Spotify users), and supports prev / next across the queue.
export default function PlayerBar({ player, onClose, onIndex }) {
  if (!player || !Array.isArray(player.list) || !player.list.length) return null;
  const { list, index = 0 } = player;
  const cur = list[Math.max(0, Math.min(index, list.length - 1))];
  if (!cur) return null;
  const multi = list.length > 1;
  const canPrev = multi && index > 0;
  const canNext = multi && index < list.length - 1;

  return (
    <View style={styles.bar}>
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>{cur.title || cur.artist || "Now playing"}</Text>
        {!!(cur.title && cur.artist) && <Text style={styles.sub} numberOfLines={1}>{cur.artist}{multi ? ` · ${index + 1}/${list.length}` : ""}</Text>}
      </View>

      <Pressable style={[styles.ctrl, !canPrev && styles.ctrlOff]} disabled={!canPrev} onPress={() => onIndex?.(index - 1)} hitSlop={6}>
        <Icon name="chevron-left" size={18} color={canPrev ? colors.text : colors.textFaint} />
      </Pressable>

      {/* The embed IS the transport (play/pause/seek + full tracks when signed in). */}
      <View style={styles.embedWrap}>
        <SpotifyEmbed kind={cur.kind || "track"} id={cur.id} url={cur.url} height={80} />
      </View>

      <Pressable style={[styles.ctrl, !canNext && styles.ctrlOff]} disabled={!canNext} onPress={() => onIndex?.(index + 1)} hitSlop={6}>
        <Icon name="chevron-right" size={18} color={canNext ? colors.text : colors.textFaint} />
      </Pressable>
      <Pressable style={styles.ctrl} onPress={onClose} hitSlop={6}>
        <Icon name="x" size={16} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.bgElev, borderBottomWidth: 1, borderBottomColor: colors.line,
    paddingHorizontal: 10, paddingVertical: 7, minHeight: 92,
    ...(Platform.OS === "web" ? { position: "sticky", top: 0, zIndex: 60 } : null),
    ...shadow.card,
  },
  meta: { width: 150, paddingLeft: 4 },
  title: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 11, marginTop: 1, fontFamily: mono },
  embedWrap: { flex: 1, minWidth: 0, borderRadius: radius.sm, overflow: "hidden" },
  ctrl: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  ctrlOff: { opacity: 0.4 },
});
