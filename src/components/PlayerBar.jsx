import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, ScrollView, Platform } from "react-native";
import { colors, radius, mono, shadow } from "../theme";
import { useStore } from "../store";
import { useYouTubePlayer } from "../lib/youtubePlayer";
import { useAudioPreview } from "../lib/audioPreview";
import Icon from "./Icon";

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

// Volume: a speaker toggle (click to mute/restore) + a draggable level bar.
function VolumeControl({ volume, onChange }) {
  const [w, setW] = useState(0);
  const trackRef = useRef(null);
  const prevRef = useRef(volume > 0 ? volume : 0.8);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  useEffect(() => {
    if (!web) return;
    const el = trackRef.current;
    if (!el || !el.addEventListener) return;
    const setAt = (clientX) => { const r = el.getBoundingClientRect(); cbRef.current(Math.max(0, Math.min(1, (clientX - r.left) / r.width))); };
    const move = (ev) => setAt(ev.clientX);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    const down = (ev) => { ev.preventDefault(); setAt(ev.clientX); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); };
    el.addEventListener("mousedown", down);
    return () => { el.removeEventListener("mousedown", down); up(); };
  }, []);
  const setAtX = (x) => { if (w > 0) onChange(Math.max(0, Math.min(1, x / w))); };
  const muted = volume <= 0.001;
  const toggleMute = () => { if (muted) onChange(prevRef.current || 0.8); else { prevRef.current = volume; onChange(0); } };
  const pct = `${(Math.max(0, Math.min(1, volume)) * 100).toFixed(1)}%`;
  const nativeResponder = web ? {} : {
    onStartShouldSetResponder: () => true, onMoveShouldSetResponder: () => true,
    onResponderGrant: (e) => setAtX(e.nativeEvent.locationX), onResponderMove: (e) => setAtX(e.nativeEvent.locationX),
  };
  return (
    <View style={styles.vol}>
      <Pressable onPress={toggleMute} hitSlop={6} accessibilityRole="button" accessibilityLabel={muted ? "Unmute" : "Mute"}>
        <Icon name={muted ? "volume-x" : "volume"} size={16} color={colors.textDim} />
      </Pressable>
      <View ref={trackRef} style={styles.volTrack} onLayout={(e) => setW(e.nativeEvent.layout.width)} {...nativeResponder}>
        <View style={styles.trackBg} />
        <View style={[styles.trackFill, { width: pct }]} />
        <View style={[styles.thumb, { left: pct }]} />
      </View>
    </View>
  );
}

// Persistent top player. One unified in-app player that streams the FULL song or
// video through the YouTube IFrame Player, so every track plays for everyone with
// no account and no Premium. When YouTube has no match it falls back to a Deezer
// 30s preview mp3. Plays ONE track at a time, driven by our own queue index, so the
// song you tap is always the song that plays.
export default function PlayerBar({ player, onClose, onIndex, onPlayAt, onRemove, onMoveNext, history = [], onSaveSession, onPlayTrack, onOpenArtist, onAddToPlaylist }) {
  const { resolveYouTube, resolveDeezerPreview } = useStore();
  const list = player && Array.isArray(player.list) ? player.list : [];
  const index = Math.max(0, Math.min(player?.index || 0, list.length - 1));
  const cur = list[index];
  const curKey = cur ? (cur.url || cur.id || cur.preview || cur.title) : null;

  const yt = useYouTubePlayer(web);

  // Volume (0–1), persisted across sessions; applied to whichever engine is live.
  const [volume, setVol] = useState(() => { try { return web && typeof localStorage !== "undefined" ? Math.max(0, Math.min(1, JSON.parse(localStorage.getItem("pit.volume") ?? "0.8"))) : 0.8; } catch { return 0.8; } });
  useEffect(() => { try { if (web) localStorage.setItem("pit.volume", String(volume)); } catch {} }, [volume]);
  useEffect(() => { yt.setVolume(volume); }, [volume, yt.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the CURRENT track: a YouTube video ID for full playback AND a Deezer
  // preview mp3 in parallel, so the preview is ready as a fallback if YouTube has
  // no match or the video turns out to be un-embeddable. One track at a time.
  const [resolved, setResolved] = useState({ key: null, videoId: null, preview: null });
  useEffect(() => {
    if (!cur) { setResolved({ key: null, videoId: null, preview: null }); return; }
    let cancelled = false;
    const timers = new Set();
    // A stalled provider request must settle so the player can show its existing
    // unavailable state instead of spinning forever. The underlying fetch may
    // still finish, but its result is ignored after this track changes.
    const within = (promise, ms = 12000) => new Promise((resolve) => {
      const timer = setTimeout(() => { timers.delete(timer); resolve(null); }, ms);
      timers.add(timer);
      Promise.resolve(promise).then((value) => {
        clearTimeout(timer); timers.delete(timer); resolve(value ?? null);
      }).catch(() => {
        clearTimeout(timer); timers.delete(timer); resolve(null);
      });
    });
    (async () => {
      const [videoId, preview] = await Promise.all([
        within(resolveYouTube(cur.title, cur.artist)),
        cur.preview ? Promise.resolve(cur.preview) : within(resolveDeezerPreview(cur.title, cur.artist)),
      ]);
      if (!cancelled) setResolved({ key: curKey, videoId, preview });
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); timers.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  const forThis = resolved.key === curKey;
  // A video the current player errored on (embedding disabled / removed) is not
  // usable — drop to the preview instead of playing silence.
  // Initialization errors are terminal for this player instance too. Without
  // this, an API-load failure leaves `hasVideo` true and "Loading video..."
  // visible forever instead of selecting the already-resolved preview fallback.
  const ytFailed = yt.error?.kind === "init" || (!!yt.error?.videoId && yt.error.videoId === resolved.videoId);
  const hasVideo = forThis && !!resolved.videoId && !ytFailed;
  const ytActive = hasVideo && yt.ready;
  const connecting = hasVideo && !yt.ready;
  const previewSrc = forThis && !hasVideo ? resolved.preview : null;
  const hasNext = index < list.length - 1;

  // Resume across reloads (theme switch / F5): remember where we were and pick the
  // song back up instead of restarting it. Position is persisted every few seconds
  // to localStorage; on mount we seek to it once for the same track.
  const [resume] = useState(() => { try { return web && typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem("pit.playpos") || "null") : null; } catch { return null; } });
  const resumedRef = useRef(false);
  const resumeMs = !resumedRef.current && resume && resume.key === curKey ? (resume.ms || 0) : 0;

  const audio = useAudioPreview(previewSrc, {
    enabled: !ytActive,
    onEnded: () => { if (hasNext) onIndex?.(index + 1); },
    startAt: resumeMs / 1000,
    volume,
  });

  // Load the resolved video into the YouTube player; our index (prev/next) drives
  // it. loadVideoById auto-plays, matching tap-to-play. Resume seeks on reload.
  const sigRef = useRef("");
  useEffect(() => {
    if (!ytActive) return;
    const sig = resolved.videoId + "@" + index;
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    yt.load(resolved.videoId, { startSec: resumeMs > 1000 ? resumeMs / 1000 : 0 });
    resumedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytActive, resolved.videoId, index]);
  // When the preview engine is driving this track, stop any video still playing.
  useEffect(() => { if (forThis && !ytActive) yt.pause(); }, [forThis, ytActive, curKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mark preview resume consumed once it's flowing, so later tracks start at 0.
  useEffect(() => { if (previewSrc && resumeMs > 0) resumedRef.current = true; }, [previewSrc, resumeMs]);

  // Auto-advance when the YouTube track ends (fires once, via the player's state).
  useEffect(() => { yt.onEnded(() => { if (hasNext) onIndex?.(index + 1); }); }); // eslint-disable-line react-hooks/exhaustive-deps

  // Show / hide the floating video window (audio keeps playing either way).
  const [showVideo, setShowVideo] = useState(true);
  useEffect(() => { yt.setVisible(ytActive && showVideo); }, [ytActive, showVideo]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the window's title current and wire its prev / next / close buttons to the
  // same queue the top bar drives, so the pop-out player is fully in sync.
  useEffect(() => { yt.setMeta({ title: cur ? (cur.title || cur.artist || "Now playing") : "Now playing" }); }, [curKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { yt.setControls({ onPrev: () => onIndex?.(index - 1), onNext: () => onIndex?.(index + 1), onClose: () => setShowVideo(false) }); }); // eslint-disable-line react-hooks/exhaustive-deps

  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const upNext = list.slice(index + 1);
  const panelOpen = open;

  // Persist playback position every few seconds so a reload (theme change / F5)
  // can resume the song instead of restarting it.
  const posRef = useRef(0);
  const keyRef = useRef(curKey);
  keyRef.current = curKey;
  useEffect(() => {
    if (!web) return;
    const id = setInterval(() => {
      if (posRef.current > 1000 && keyRef.current) { try { localStorage.setItem("pit.playpos", JSON.stringify({ key: keyRef.current, ms: posRef.current })); } catch {} }
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // Occasionally flash "up next" right on the bar, so people see what's coming
  // without opening the queue.
  const [peekNext, setPeekNext] = useState(false);
  const nextTitle = upNext[0]?.title || null;
  useEffect(() => {
    if (!nextTitle) { setPeekNext(false); return; }
    let off;
    const id = setInterval(() => { setPeekNext(true); off = setTimeout(() => setPeekNext(false), 3800); }, 13000);
    return () => { clearInterval(id); clearTimeout(off); };
  }, [nextTitle]);

  if (!cur) return null;

  const multi = list.length > 1;
  const title = cur.title || cur.artist || "Now playing";
  const artist = cur.artist || "";
  const art = cur.art || null;

  // Unified transport across whichever engine is live (YouTube player or preview mp3).
  const scrubbable = ytActive || !!previewSrc;
  const resolving = !forThis; // still fetching a source for this track
  const unplayable = forThis && !ytActive && !previewSrc && !connecting;
  const posMs = ytActive ? (yt.state.position || 0) : audio.pos * 1000;
  const durMs = ytActive ? (yt.state.duration || 0) : audio.dur * 1000;
  posRef.current = posMs;
  const playing = ytActive ? yt.state.playing : audio.playing;
  const playPause = () => { if (ytActive) yt.toggle(); else if (previewSrc) audio.toggle(); };
  const onSeek = (ms) => { if (ytActive) yt.seek(ms); else audio.seek(ms / 1000); };
  const goPrev = () => onIndex?.(index - 1);
  const goNext = () => onIndex?.(index + 1);

  const doSave = () => { const s = onSaveSession?.(list, `${cur.artist || "Session"} mix`); if (s) { setSaved(true); setTimeout(() => setSaved(false), 1800); } };

  const Ctrl = ({ icon, onPress, disabled }) => (
    <Pressable style={[styles.ctrl, disabled && styles.ctrlOff]} disabled={disabled} onPress={onPress} hitSlop={6}>
      <Icon name={icon} size={17} color={disabled ? colors.textFaint : colors.text} />
    </Pressable>
  );

  const statusLine = connecting ? "Loading video..."
    : resolving ? "Loading..."
    : unplayable ? "Not available to play"
    : artist + (ytActive ? "  ·  YouTube" : previewSrc ? "  ·  preview" : "");

  // The queue panel opens ONLY on an explicit tap (the queue button or the title),
  // never on hover — hovering the bar was accidentally popping the panel open.
  return (
    <View style={styles.shell}>
      <View style={styles.bar}>
        {art ? <Image source={{ uri: art }} style={styles.art} /> : <View style={[styles.art, styles.artEmpty]}><Icon name="music" size={16} color={colors.textFaint} /></View>}
        <Pressable style={[styles.meta, styles.metaGrow]} onPress={() => multi && setOpen((o) => !o)} accessibilityRole={multi ? "button" : undefined} accessibilityLabel={multi ? `Now playing ${title}. ${upNext.length} up next. Open queue.` : undefined}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {peekNext && nextTitle
            ? <Text style={styles.peekNext} numberOfLines={1}>{"↑ Up next · " + nextTitle}</Text>
            : <Text style={styles.sub} numberOfLines={1}>{statusLine}</Text>}
        </Pressable>

        <Ctrl icon="chevron-left" onPress={goPrev} disabled={index <= 0} />
        <Pressable style={[styles.ctrl, styles.play, !scrubbable && styles.ctrlOff]} onPress={playPause} hitSlop={6} disabled={!scrubbable}>
          {(connecting || resolving) && !scrubbable
            ? <View style={styles.dots}><View style={styles.dotDark} /><View style={styles.dotDark} /><View style={styles.dotDark} /></View>
            : playing ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <Icon name="play" size={16} color="#1A1206" />}
        </Pressable>
        <Ctrl icon="chevron-right" onPress={goNext} disabled={index >= list.length - 1} />

        {multi && (
          <Pressable style={[styles.queueBtn, panelOpen && styles.queueBtnOn]} onPress={() => setOpen((o) => !o)} hitSlop={6} accessibilityRole="button" accessibilityState={{ expanded: panelOpen }} accessibilityLabel={`${panelOpen ? "Hide" : "Show"} queue, ${upNext.length} up next`}>
            <Icon name="feed" size={13} color={panelOpen ? colors.amber : colors.textDim} />
            <Text style={[styles.queueTxt, panelOpen && { color: colors.amber }]}>{upNext.length}</Text>
          </Pressable>
        )}
        {ytActive && (
          <Pressable style={[styles.queueBtn, showVideo && styles.queueBtnOn]} onPress={() => setShowVideo((v) => !v)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: showVideo }} accessibilityLabel={showVideo ? "Hide video" : "Show video"}>
            <Icon name="play" size={12} color={showVideo ? colors.amber : colors.textDim} />
            <Text style={[styles.queueTxt, showVideo && { color: colors.amber }]}>{showVideo ? "Video" : "Video"}</Text>
          </Pressable>
        )}
        <Ctrl icon="x" onPress={onClose} />
      </View>

      {scrubbable && (
        <View style={styles.scrubRow}>
          <View style={{ flex: 1 }}><Scrubber posMs={posMs} durMs={durMs} onSeek={onSeek} live /></View>
          <VolumeControl volume={volume} onChange={setVol} />
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
                <View key={(t.url || t.title) + real} style={styles.qRow} accessibilityLabel={`Up next ${j + 1}: ${t.title}${t.artist ? " by " + t.artist : ""}`}>
                  {t.art ? <Image source={{ uri: t.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                  <Pressable style={{ flex: 1 }} onPress={() => onPlayAt?.(real)} accessibilityRole="button" accessibilityLabel={`Play ${t.title}`}>
                    <Text style={styles.qTitle} numberOfLines={1}>{t.title}</Text>
                    <Text style={styles.qArtist} numberOfLines={1}>{t.artist}</Text>
                  </Pressable>
                  {onAddToPlaylist && <Pressable style={styles.qAct} onPress={() => onAddToPlaylist({ title: t.title, artist: t.artist, url: t.url, preview: t.preview, art: t.art })} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Add ${t.title} to a playlist`}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>}
                  <Pressable style={styles.qAct} onPress={() => onMoveNext?.(real)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Play ${t.title} next`}><Icon name="menu" size={14} color={colors.textDim} /></Pressable>
                  <Pressable style={styles.qAct} onPress={() => onRemove?.(real)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${t.title} from queue`}><Icon name="x" size={13} color={colors.textDim} /></Pressable>
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
  peekNext: { color: colors.amber, fontSize: 11, marginTop: 1, fontFamily: mono, fontWeight: "700" },
  embedWrap: { flex: 1, minWidth: 0, borderRadius: radius.sm, overflow: "hidden" },
  scrubRow: { backgroundColor: colors.bgElev, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 12, paddingBottom: 8, paddingTop: 2 },
  scrub: { flexDirection: "row", alignItems: "center", gap: 10 },
  vol: { flexDirection: "row", alignItems: "center", gap: 7, marginLeft: 12, ...(web ? { width: 110 } : { width: 90 }) },
  volTrack: { flex: 1, height: 16, justifyContent: "center", ...(web ? { cursor: "pointer" } : null) },
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
  dots: { flexDirection: "row", gap: 3, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textFaint },
  dotDark: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#1A1206" },
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
