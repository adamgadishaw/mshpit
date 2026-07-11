import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, ScrollView, Platform } from "react-native";
import { colors, radius, mono, shadow } from "../theme";
import { useStore } from "../store";
import { useSpotifyPlayer } from "../lib/spotifyPlayer";
import { useAudioPreview } from "../lib/audioPreview";
import Icon from "./Icon";
import SpotifyEmbed, { spotifyId } from "./SpotifyEmbed";

const web = Platform.OS === "web";

const fmtTime = (ms) => {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Seekable progress bar: tap or drag anywhere to skip to that point. Shows elapsed
// on the left and time remaining on the right, like a traditional player. On web
// it listens on the real DOM node (click + drag); native uses the responder API.
function Scrubber({ posMs, durMs, onSeek, live }) {
  const [w, setW] = useState(0);
  const trackRef = useRef(null);
  const stRef = useRef({ onSeek, durMs });
  stRef.current = { onSeek, durMs };

  useEffect(() => {
    if (!web) return;
    const el = trackRef.current;
    if (!el || !el.addEventListener) return;
    const seekTo = (clientX) => {
      const { onSeek: cb, durMs: dur } = stRef.current;
      if (!dur) return;
      const r = el.getBoundingClientRect();
      cb(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur);
    };
    const move = (ev) => seekTo(ev.clientX);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    const down = (ev) => { ev.preventDefault(); seekTo(ev.clientX); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); };
    el.addEventListener("mousedown", down);
    return () => { el.removeEventListener("mousedown", down); up(); };
  }, []);

  const frac = durMs > 0 ? Math.max(0, Math.min(1, posMs / durMs)) : 0;
  const seekAt = (x) => { if (durMs > 0 && w > 0) onSeek((Math.max(0, Math.min(x, w)) / w) * durMs); };
  const pct = `${(frac * 100).toFixed(2)}%`;
  const nativeResponder = web ? {} : {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: (e) => seekAt(e.nativeEvent.locationX),
    onResponderMove: (e) => seekAt(e.nativeEvent.locationX),
  };
  return (
    <View style={styles.scrub}>
      <Text style={styles.time}>{fmtTime(posMs)}</Text>
      <View
        ref={trackRef}
        style={styles.track}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        {...nativeResponder}
      >
        <View style={styles.trackBg} />
        <View style={[styles.trackFill, { width: pct }]} />
        <View style={[styles.thumb, { left: pct }]} />
      </View>
      <Text style={styles.time}>{live ? "-" + fmtTime(Math.max(0, durMs - posMs)) : fmtTime(durMs)}</Text>
    </View>
  );
}

// Persistent top player. Keeps playing across navigation, streams full tracks via
// the Web Playback SDK when connected (embed otherwise), and drops down a session
// panel (up next + recently played + save-as-playlist) on hover or tap.
export default function PlayerBar({ player, onClose, onIndex, onPlayAt, onRemove, onMoveNext, history = [], onSaveSession, onPlayTrack, onOpenArtist, onAddToPlaylist }) {
  const { spotifyConnected, connectSpotify } = useStore();
  const list = player && Array.isArray(player.list) ? player.list : [];
  const index = Math.max(0, Math.min(player?.index || 0, list.length - 1));
  const cur = list[index];

  const uris = list.map((t) => { const id = spotifyId(t?.url || t?.id, "track"); return id ? "spotify:track:" + id : null; }).filter(Boolean);
  const { ready, state, error, playUris, toggle, next, prev, seek } = useSpotifyPlayer(spotifyConnected && !!cur);

  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!spotifyConnected || ready) { setFailed(false); return; }
    const t = setTimeout(() => setFailed(true), 6000);
    return () => clearTimeout(t);
  }, [spotifyConnected, ready]);

  const blocked = failed || !!error;
  const sdkMode = spotifyConnected && ready && !blocked && uris.length > 0;
  const connecting = spotifyConnected && !ready && !blocked && uris.length > 0;

  // Preview mode: play the 30s mp3 directly (works for everyone, no Premium). This
  // is the default when Spotify Connect isn't streaming and we have a preview URL.
  const previewUrl = cur?.preview || null;
  const previewMode = !sdkMode && !connecting && !!previewUrl;
  const embedMode = !sdkMode && !connecting && !previewMode;
  const hasNext = index < list.length - 1;
  const audio = useAudioPreview(previewMode ? previewUrl : null, {
    enabled: previewMode,
    onEnded: () => { if (hasNext) onIndex?.(index + 1); },
  });

  const sigRef = useRef("");
  useEffect(() => {
    if (!sdkMode) return;
    const sig = uris.join("|") + "@" + index;
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    playUris(uris, Math.min(index, uris.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkMode, uris.join("|"), index]);

  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const upNext = list.slice(index + 1);
  const panelOpen = open;

  if (!cur) return null;

  const multi = list.length > 1;
  const tk = sdkMode && state?.track ? state.track : null;
  const title = tk?.name || cur.title || cur.artist || "Now playing";
  const artist = tk?.artist || cur.artist || "";
  const art = tk?.art || cur.art || null;

  // Unified transport across whichever engine is live (Spotify SDK or preview mp3).
  const scrubbable = sdkMode || previewMode;
  const posMs = sdkMode ? (state?.position || 0) : audio.pos * 1000;
  const durMs = sdkMode ? (state?.duration || 0) : audio.dur * 1000;
  const playing = sdkMode ? (state && !state.paused && !!state.track) : (previewMode && audio.playing);
  const playPause = () => {
    if (sdkMode) { if (!state || !state.track) playUris(uris, Math.min(index, uris.length - 1)); else toggle(); }
    else if (previewMode) audio.toggle();
  };
  const onSeek = (ms) => { if (sdkMode) seek(ms); else if (previewMode) audio.seek(ms / 1000); };
  const goPrev = () => { if (sdkMode) prev(); else onIndex?.(index - 1); };
  const goNext = () => { if (sdkMode) next(); else onIndex?.(index + 1); };

  const doSave = () => { const s = onSaveSession?.(list, `${cur.artist || "Session"} mix`); if (s) { setSaved(true); setTimeout(() => setSaved(false), 1800); } };

  const Ctrl = ({ icon, onPress, disabled }) => (
    <Pressable style={[styles.ctrl, disabled && styles.ctrlOff]} disabled={disabled} onPress={onPress} hitSlop={6}>
      <Icon name={icon} size={17} color={disabled ? colors.textFaint : colors.text} />
    </Pressable>
  );

  const hoverProps = web ? { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) } : {};

  return (
    <View style={styles.shell} {...hoverProps}>
      <View style={styles.bar}>
        {art ? <Image source={{ uri: art }} style={styles.art} /> : <View style={[styles.art, styles.artEmpty]}><Icon name="music" size={16} color={colors.textFaint} /></View>}
        <View style={[styles.meta, (scrubbable || connecting) && styles.metaGrow]}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {connecting
            ? <Text style={styles.sub} numberOfLines={1}>Connecting Spotify...</Text>
            : !!artist && <Text style={styles.sub} numberOfLines={1}>{artist}{previewMode ? "  ·  preview" : ""}</Text>}
        </View>

        {scrubbable ? (
          <>
            <Ctrl icon="chevron-left" onPress={goPrev} disabled={!sdkMode && index <= 0} />
            <Pressable style={[styles.ctrl, styles.play]} onPress={playPause} hitSlop={6}>
              {playing ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <Icon name="play" size={16} color="#1A1206" />}
            </Pressable>
            <Ctrl icon="chevron-right" onPress={goNext} disabled={!sdkMode && index >= list.length - 1} />
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

        {multi && (
          <Pressable style={[styles.queueBtn, panelOpen && styles.queueBtnOn]} onPress={() => setOpen((o) => !o)} hitSlop={6}>
            <Icon name="feed" size={13} color={panelOpen ? colors.amber : colors.textDim} />
            <Text style={[styles.queueTxt, panelOpen && { color: colors.amber }]}>{upNext.length}</Text>
          </Pressable>
        )}
        {error ? (
          <Pressable style={styles.notice} onPress={error.kind === "auth" ? connectSpotify : undefined}>
            <Icon name={error.kind === "premium" ? "star" : "lock"} size={12} color={colors.gold} />
            <Text style={styles.noticeTxt} numberOfLines={1}>{error.kind === "premium" ? "Premium needed" : "Reconnect"}</Text>
          </Pressable>
        ) : !spotifyConnected ? (
          <Pressable style={styles.connect} onPress={connectSpotify} hitSlop={6}>
            <Icon name="music" size={13} color={colors.good} />
            <Text style={styles.connectTxt}>Full songs</Text>
          </Pressable>
        ) : null}
        <Ctrl icon="x" onPress={onClose} />
      </View>

      {scrubbable && (
        <View style={styles.scrubRow}>
          <Scrubber posMs={posMs} durMs={durMs} onSeek={onSeek} live />
        </View>
      )}

      {panelOpen && (multi || history.length > 0) && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>LISTENING SESSION</Text>
            <View style={styles.panelActions}>
              {onAddToPlaylist && (
                <Pressable style={styles.addBtn} onPress={() => onAddToPlaylist({ title: cur.title || cur.artist, artist: cur.artist, url: cur.url, preview: cur.preview, art })}>
                  <Icon name="plus" size={12} color={colors.textDim} />
                  <Text style={styles.addTxt}>Add song</Text>
                </Pressable>
              )}
              <Pressable style={styles.saveBtn} onPress={doSave}>
                <Icon name={saved ? "check" : "star"} size={12} color={saved ? colors.good : colors.amber} />
                <Text style={[styles.saveTxt, saved && { color: colors.good }]}>{saved ? "Saved" : "Save session"}</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView style={styles.panelScroll} showsVerticalScrollIndicator={false}>
            {upNext.length > 0 && <Text style={styles.groupLabel}>UP NEXT · {upNext.length}</Text>}
            {upNext.slice(0, 10).map((t, j) => {
              const real = index + 1 + j;
              return (
                <View key={(t.url || t.title) + real} style={styles.qRow}>
                  {t.art ? <Image source={{ uri: t.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                  <Pressable style={{ flex: 1 }} onPress={() => onPlayAt?.(real)}>
                    <Text style={styles.qTitle} numberOfLines={1}>{t.title}</Text>
                    <Text style={styles.qArtist} numberOfLines={1}>{t.artist}</Text>
                  </Pressable>
                  {onAddToPlaylist && <Pressable style={styles.qAct} onPress={() => onAddToPlaylist({ title: t.title, artist: t.artist, url: t.url, preview: t.preview, art: t.art })} hitSlop={6}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>}
                  <Pressable style={styles.qAct} onPress={() => onMoveNext?.(real)} hitSlop={6}><Icon name="menu" size={14} color={colors.textDim} /></Pressable>
                  <Pressable style={styles.qAct} onPress={() => onRemove?.(real)} hitSlop={6}><Icon name="x" size={13} color={colors.textDim} /></Pressable>
                </View>
              );
            })}

            {history.length > 0 && <Text style={styles.groupLabel}>RECENTLY PLAYED</Text>}
            {history.slice(0, 8).map((t, j) => (
              <Pressable key={"h" + j + (t.url || t.title)} style={styles.qRow} onPress={() => onPlayTrack?.({ kind: "track", url: t.url, id: t.id, preview: t.preview, title: t.title, artist: t.artist, art: t.art })}>
                {t.art ? <Image source={{ uri: t.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.qTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={styles.qArtist} numberOfLines={1}>{t.artist}</Text>
                </View>
                <Icon name="play" size={13} color={colors.textDim} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { ...(web ? { position: "sticky", top: 0, zIndex: 60 } : null) },
  bar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.bgElev, borderBottomWidth: 1, borderBottomColor: colors.line,
    paddingHorizontal: 10, paddingVertical: 8, minHeight: 64, ...shadow.card,
  },
  art: { width: 46, height: 46, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  artEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  meta: { width: 150, paddingLeft: 2 },
  metaGrow: { flex: 1, width: undefined },
  title: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 11, marginTop: 1, fontFamily: mono },
  embedWrap: { flex: 1, minWidth: 0, borderRadius: radius.sm, overflow: "hidden" },
  scrubRow: { backgroundColor: colors.bgElev, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 12, paddingBottom: 8, paddingTop: 2 },
  scrub: { flexDirection: "row", alignItems: "center", gap: 10 },
  time: { color: colors.textDim, fontSize: 11, fontFamily: mono, width: 40, textAlign: "center" },
  track: { flex: 1, height: 16, justifyContent: "center", ...(web ? { cursor: "pointer" } : null) },
  trackBg: { position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt },
  trackFill: { position: "absolute", left: 0, height: 4, borderRadius: 2, backgroundColor: colors.amber },
  thumb: { position: "absolute", width: 11, height: 11, borderRadius: 6, backgroundColor: colors.amber, marginLeft: -5.5, ...shadow.card },
  ctrl: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  ctrlOff: { opacity: 0.4 },
  play: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  pauseGlyph: { flexDirection: "row", gap: 3 },
  pauseBar: { width: 3.5, height: 13, borderRadius: 1.5, backgroundColor: "#1A1206" },
  dots: { flexDirection: "row", gap: 4, paddingHorizontal: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textFaint },
  queueBtn: { flexDirection: "row", alignItems: "center", gap: 4, height: 36, paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  queueBtnOn: { borderColor: colors.amber },
  queueTxt: { color: colors.textDim, fontSize: 12, fontWeight: "800", fontFamily: mono },
  connect: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.good, backgroundColor: "rgba(111,207,151,0.10)" },
  connectTxt: { color: colors.good, fontSize: 12, fontWeight: "800" },
  notice: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.gold, backgroundColor: "rgba(232,182,90,0.10)" },
  noticeTxt: { color: colors.gold, fontSize: 12, fontWeight: "800" },

  panel: { backgroundColor: colors.bgElev, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 12, paddingBottom: 10, ...shadow.sheet },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  panelTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  panelActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  saveTxt: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  addTxt: { color: colors.textDim, fontSize: 12, fontWeight: "800" },
  panelScroll: { maxHeight: 300 },
  groupLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.2, fontWeight: "800", marginTop: 8, marginBottom: 4 },
  qRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  qArt: { width: 34, height: 34, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  qTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  qArtist: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  qAct: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 14 },
});
