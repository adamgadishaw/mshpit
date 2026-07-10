import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Image, Platform } from "react-native";
import { colors, radius, mono, shadow } from "../theme";
import { useStore } from "../store";
import { useSpotifyPlayer } from "../lib/spotifyPlayer";
import Icon from "./Icon";
import SpotifyEmbed, { spotifyId } from "./SpotifyEmbed";

// Persistent player bar pinned to the very top, a toolbar you keep listening
// through while you browse. Lives at the app root, so it never unmounts on
// navigation. Two modes:
//   - Connected to Spotify (Premium): the Web Playback SDK streams FULL tracks and
//     our buttons drive real play / pause / next / prev.
//   - Otherwise: the Spotify embed (full tracks for signed-in web users, else a
//     30s preview), with a "Connect Spotify" prompt for the full experience.
export default function PlayerBar({ player, onClose, onIndex }) {
  const { spotifyConnected, connectSpotify } = useStore();
  const list = player && Array.isArray(player.list) ? player.list : [];
  const index = Math.max(0, Math.min(player?.index || 0, list.length - 1));
  const cur = list[index];

  const uris = list.map((t) => { const id = spotifyId(t?.url || t?.id, "track"); return id ? "spotify:track:" + id : null; }).filter(Boolean);
  const { ready, state, playUris, toggle, next, prev } = useSpotifyPlayer(spotifyConnected && !!cur);
  const sdkMode = spotifyConnected && ready && uris.length > 0;

  // Start / re-point the SDK queue only when a new track is opened (signature =
  // the list + the opened index). Our prev/next drive the SDK directly after that,
  // so they don't re-trigger this.
  const sigRef = useRef("");
  useEffect(() => {
    if (!sdkMode) return;
    const sig = uris.join("|") + "@" + index;
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    playUris(uris, Math.min(index, uris.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkMode, uris.join("|"), index]);

  if (!cur) return null;

  const multi = list.length > 1;
  const tk = sdkMode && state?.track ? state.track : null;
  const title = tk?.name || cur.title || cur.artist || "Now playing";
  const artist = tk?.artist || cur.artist || "";
  const paused = sdkMode ? (state ? state.paused : true) : false;

  const Ctrl = ({ icon, onPress, disabled, children }) => (
    <Pressable style={[styles.ctrl, disabled && styles.ctrlOff]} disabled={disabled} onPress={onPress} hitSlop={6}>
      {children || <Icon name={icon} size={17} color={disabled ? colors.textFaint : colors.text} />}
    </Pressable>
  );

  return (
    <View style={styles.bar}>
      {sdkMode && tk?.art ? <Image source={{ uri: tk.art }} style={styles.art} /> : null}
      <View style={[styles.meta, sdkMode && styles.metaGrow]}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {!!artist && <Text style={styles.sub} numberOfLines={1}>{artist}{multi && !sdkMode ? ` · ${index + 1}/${list.length}` : ""}</Text>}
      </View>

      {sdkMode ? (
        <>
          <Ctrl icon="chevron-left" onPress={prev} />
          <Pressable style={[styles.ctrl, styles.play]} onPress={toggle} hitSlop={6}>
            {paused ? <Icon name="play" size={16} color="#1A1206" /> : <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View>}
          </Pressable>
          <Ctrl icon="chevron-right" onPress={next} />
        </>
      ) : (
        <>
          <Ctrl icon="chevron-left" onPress={() => onIndex?.(index - 1)} disabled={!multi || index <= 0} />
          <View style={styles.embedWrap}>
            <SpotifyEmbed kind={cur.kind || "track"} id={cur.id} url={cur.url} height={80} />
          </View>
          <Ctrl icon="chevron-right" onPress={() => onIndex?.(index + 1)} disabled={!multi || index >= list.length - 1} />
        </>
      )}

      {!spotifyConnected && (
        <Pressable style={styles.connect} onPress={connectSpotify} hitSlop={6}>
          <Icon name="music" size={13} color={colors.good} />
          <Text style={styles.connectTxt}>Full songs</Text>
        </Pressable>
      )}
      <Ctrl icon="x" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.bgElev, borderBottomWidth: 1, borderBottomColor: colors.line,
    paddingHorizontal: 10, paddingVertical: 8, minHeight: 64,
    ...(Platform.OS === "web" ? { position: "sticky", top: 0, zIndex: 60 } : null),
    ...shadow.card,
  },
  art: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  meta: { width: 150, paddingLeft: 2 },
  metaGrow: { flex: 1, width: undefined },
  title: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 11, marginTop: 1, fontFamily: mono },
  embedWrap: { flex: 1, minWidth: 0, borderRadius: radius.sm, overflow: "hidden" },
  ctrl: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  ctrlOff: { opacity: 0.4 },
  play: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  pauseGlyph: { flexDirection: "row", gap: 3 },
  pauseBar: { width: 3.5, height: 13, borderRadius: 1.5, backgroundColor: "#1A1206" },
  connect: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.good, backgroundColor: "rgba(111,207,151,0.10)" },
  connectTxt: { color: colors.good, fontSize: 12, fontWeight: "800" },
});
