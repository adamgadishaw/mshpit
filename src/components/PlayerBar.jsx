import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, Platform } from "react-native";
import { colors, radius, mono, shadow } from "../theme";
import { useStore } from "../store";
import { useSpotifyPlayer } from "../lib/spotifyPlayer";
import Icon from "./Icon";
import SpotifyEmbed, { spotifyId } from "./SpotifyEmbed";

// Persistent player bar pinned to the very top, a toolbar you keep listening
// through while you browse. Lives at the app root so it never unmounts on nav.
// Modes:
//   connected + Premium -> Web Playback SDK (full tracks, our buttons drive it)
//   otherwise / SDK unavailable -> the Spotify embed
// We commit to one mode per session so the embed and SDK never fight (that flip
// was the "starts then stops" bug), and the play button force-starts playback so
// browser autoplay blocking never leaves it stuck.
export default function PlayerBar({ player, onClose, onIndex }) {
  const { spotifyConnected, connectSpotify } = useStore();
  const list = player && Array.isArray(player.list) ? player.list : [];
  const index = Math.max(0, Math.min(player?.index || 0, list.length - 1));
  const cur = list[index];

  const uris = list.map((t) => { const id = spotifyId(t?.url || t?.id, "track"); return id ? "spotify:track:" + id : null; }).filter(Boolean);
  const { ready, state, playUris, toggle, next, prev } = useSpotifyPlayer(spotifyConnected && !!cur);

  // If connected but the SDK never becomes ready (non-Premium, blocked, etc.),
  // fall back to the embed so playback still works.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!spotifyConnected || ready) { setFailed(false); return; }
    const t = setTimeout(() => setFailed(true), 6000);
    return () => clearTimeout(t);
  }, [spotifyConnected, ready]);

  const sdkMode = spotifyConnected && ready && !failed && uris.length > 0;
  const connecting = spotifyConnected && !ready && !failed && uris.length > 0;

  // Attempt to start the queue when a new track is opened. Autoplay may block this
  // (no gesture), in which case the play button below force-starts it.
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
  const art = tk?.art || cur.art || null;
  const playing = sdkMode && state && !state.paused && !!state.track;

  // In SDK mode the play button both starts (gesture, beats autoplay block) and toggles.
  const playPause = () => { if (!state || !state.track) playUris(uris, Math.min(index, uris.length - 1)); else toggle(); };

  const Ctrl = ({ icon, onPress, disabled }) => (
    <Pressable style={[styles.ctrl, disabled && styles.ctrlOff]} disabled={disabled} onPress={onPress} hitSlop={6}>
      <Icon name={icon} size={17} color={disabled ? colors.textFaint : colors.text} />
    </Pressable>
  );

  return (
    <View style={styles.bar}>
      {art ? <Image source={{ uri: art }} style={styles.art} /> : <View style={[styles.art, styles.artEmpty]}><Icon name="music" size={16} color={colors.textFaint} /></View>}
      <View style={[styles.meta, !sdkMode && !connecting ? null : styles.metaGrow]}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {connecting
          ? <Text style={styles.sub} numberOfLines={1}>Connecting Spotify...</Text>
          : !!artist && <Text style={styles.sub} numberOfLines={1}>{artist}{multi && !sdkMode ? ` · ${index + 1}/${list.length}` : ""}</Text>}
      </View>

      {sdkMode ? (
        <>
          <Ctrl icon="chevron-left" onPress={prev} />
          <Pressable style={[styles.ctrl, styles.play]} onPress={playPause} hitSlop={6}>
            {playing ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <Icon name="play" size={16} color="#1A1206" />}
          </Pressable>
          <Ctrl icon="chevron-right" onPress={next} />
        </>
      ) : connecting ? (
        <View style={styles.dots}><View style={styles.dot} /><View style={styles.dot} /><View style={styles.dot} /></View>
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
  art: { width: 46, height: 46, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  artEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
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
  dots: { flexDirection: "row", gap: 4, paddingHorizontal: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textFaint },
  connect: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.good, backgroundColor: "rgba(111,207,151,0.10)" },
  connectTxt: { color: colors.good, fontSize: 12, fontWeight: "800" },
});
