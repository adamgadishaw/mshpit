import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, Image, ScrollView, Platform, useWindowDimensions } from "react-native";
import { colors, radius, mono, shadow } from "../theme";
import { useStore } from "../store";
import { useYouTubePlayer } from "../lib/youtubePlayer";
import { useAudioPreview } from "../lib/audioPreview";
import { captureAppError } from "../lib/diagnostics";
import { trackKey } from "../lib/playback";
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
export default function PlayerBar({
  player,
  layout = "bar",
  minimized = false,
  obscured = false,
  onMinimize,
  onRestore,
  onClose,
  onIndex,
  onPlayAt,
  onRemove,
  onMoveNext,
  history = [],
  onRefreshHistory,
  onSaveSession,
  onPlayTrack,
  onPlaybackStarted,
  onOpenArtist,
  onAddToPlaylist,
}) {
  const { resolveYouTube, invalidateYouTube, resolveDeezerPreview } = useStore();
  const column = layout === "column";
  const { width: winWidth } = useWindowDimensions();
  const compactMobile = !column && winWidth < 700;
  const list = player && Array.isArray(player.list) ? player.list : [];
  const index = Math.max(0, Math.min(player?.index || 0, list.length - 1));
  const cur = list[index];
  const curKey = trackKey(cur);
  const directVideoId = /^[A-Za-z0-9_-]{11}$/.test(String(cur?.videoId || "")) ? String(cur.videoId) : null;
  const youtubeHostId = column ? "pit-youtube-player-host-column" : "pit-youtube-player-host-compact";

  // Volume (0–1), persisted across sessions; applied to whichever engine is live.
  const [volume, setVol] = useState(() => { try { return web && typeof localStorage !== "undefined" ? Math.max(0, Math.min(1, JSON.parse(localStorage.getItem("pit.volume") ?? "0.8"))) : 0.8; } catch { return 0.8; } });
  useEffect(() => { try { if (web) localStorage.setItem("pit.volume", String(volume)); } catch {} }, [volume]);

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
        directVideoId ? Promise.resolve(directVideoId) : within(resolveYouTube(cur.title, cur.artist, cur.duration || 0)),
        // Stored provider previews are short-lived signed URLs. Always ask the
        // resolver for a fresh one; its bounded cache avoids duplicate requests.
        within(resolveDeezerPreview(cur.title, cur.artist)),
      ]);
      if (!cancelled) setResolved({ key: curKey, videoId, preview });
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); timers.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  // Mount YouTube only after a real video ID resolves. Preview-only tracks keep
  // the same visible player surface without creating a hidden cross-origin frame.
  const yt = useYouTubePlayer(web && !!cur && !!resolved.videoId && !minimized, { hostId: youtubeHostId, mediaKey: curKey });
  useEffect(() => { yt.setVolume(volume); }, [volume, yt.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const forThis = resolved.key === curKey;
  // A video the current player errored on (embedding disabled / removed) is not
  // usable — drop to the preview instead of playing silence.
  // Initialization errors are terminal for this player instance too. Without
  // this, an API-load failure leaves `hasVideo` true and "Loading video..."
  // visible forever instead of selecting the already-resolved preview fallback.
  const ytFailed = yt.error?.kind === "init" || (!!yt.error?.videoId && yt.error.videoId === resolved.videoId);
  // Native has no YouTube iframe host in this component. Treat the resolved id
  // as metadata there and use the preview engine instead of hanging "connecting".
  const hasVideo = web && forThis && !!resolved.videoId && !ytFailed;
  const ytActive = hasVideo && yt.ready;
  const connecting = hasVideo && !yt.ready;
  const previewSrc = forThis && !hasVideo ? resolved.preview : null;
  const hasNext = index < list.length - 1;

  // Removed and non-embeddable videos (IFrame errors 100/101/150) must not stay
  // pinned in either cache. The next play excludes this ID and selects a newly
  // scored candidate while this play immediately falls back to a fresh preview.
  const invalidatedRef = useRef("");
  useEffect(() => {
    const failedId = yt.error?.videoId;
    if (!cur || !failedId || ![100, 101, 150].includes(Number(yt.error?.code))) return;
    const signature = `${cur.artist || ""}|${cur.title || ""}|${failedId}`;
    if (invalidatedRef.current === signature) return;
    invalidatedRef.current = signature;
    invalidateYouTube(cur.title, cur.artist, failedId);
  }, [yt.error?.code, yt.error?.videoId, curKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuilding the iframe (minimize/restore or a responsive host swap) must not
  // restart the song. Capture the live YouTube clock and consume it on the next
  // engine load; clear it only when the actual track changes.
  const engineResumeRef = useRef(null);
  const previousHostRef = useRef(youtubeHostId);
  useEffect(() => {
    if (previousHostRef.current === youtubeHostId) return;
    if (ytActive && forThis && yt.state.position > 0) engineResumeRef.current = { key: curKey, ms: yt.state.position };
    previousHostRef.current = youtubeHostId;
  }, [youtubeHostId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (engineResumeRef.current && engineResumeRef.current.key !== curKey) engineResumeRef.current = null;
  }, [curKey]);
  useEffect(() => {
    if (minimized && ytActive && forThis && yt.state.position > 0) engineResumeRef.current = { key: curKey, ms: yt.state.position };
  }, [minimized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume across reloads (theme switch / F5): remember where we were and pick the
  // song back up instead of restarting it. Position is persisted every few seconds
  // to localStorage; on mount we seek to it once for the same track.
  const [resume] = useState(() => { try { return web && typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem("pit.playpos") || "null") : null; } catch { return null; } });
  const resumedRef = useRef(false);
  const engineResumeMs = engineResumeRef.current?.key === curKey ? (engineResumeRef.current.ms || 0) : 0;
  const resumeMs = engineResumeMs || (!resumedRef.current && resume && resume.key === curKey ? (resume.ms || 0) : 0);
  const [showVideo, setShowVideo] = useState(true);

  const recordedKeyRef = useRef(null);
  const markPlaybackStarted = () => {
    if (!curKey || recordedKeyRef.current === curKey) return;
    recordedKeyRef.current = curKey;
    onPlaybackStarted?.({ ...cur, videoId: (forThis && resolved.videoId) || cur.videoId || null });
  };

  const audio = useAudioPreview(previewSrc, {
    enabled: !ytActive,
    onEnded: () => { if (hasNext) onIndex?.(index + 1); },
    onStarted: markPlaybackStarted,
    startAt: resumeMs / 1000,
    volume,
  });

  // Count YouTube only after its engine reports PLAYING. Preview audio reports
  // the same event through onStarted above.
  useEffect(() => {
    if (ytActive && yt.state.playing) markPlaybackStarted();
  }, [ytActive, yt.state.playing, curKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the resolved video into the YouTube player; our index (prev/next) drives
  // it. loadVideoById auto-plays, matching tap-to-play. Resume seeks on reload.
  const sigRef = useRef("");
  useEffect(() => { if (minimized) sigRef.current = ""; }, [minimized]);
  useEffect(() => { if (!yt.ready) sigRef.current = ""; }, [yt.ready]);
  useEffect(() => {
    if (!ytActive || minimized || obscured || !showVideo) return;
    const sig = `${resolved.videoId}@${index}@${youtubeHostId}`;
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    const liveResumeMs = engineResumeRef.current?.key === curKey ? (engineResumeRef.current.ms || 0) : resumeMs;
    yt.load(resolved.videoId, { startSec: liveResumeMs > 1000 ? liveResumeMs / 1000 : 0 });
    engineResumeRef.current = null;
    resumedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytActive, resolved.videoId, index, minimized, obscured, showVideo, youtubeHostId]);
  // When the preview engine is driving this track, stop any video still playing.
  useEffect(() => { if (forThis && !ytActive) yt.pause(); }, [forThis, ytActive, curKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mark preview resume consumed once it's flowing, so later tracks start at 0.
  useEffect(() => { if (previewSrc && resumeMs > 0) resumedRef.current = true; }, [previewSrc, resumeMs]);

  // Auto-advance when the YouTube track ends (fires once, via the player's state).
  useEffect(() => { yt.onEnded(() => { if (hasNext) onIndex?.(index + 1); }); }); // eslint-disable-line react-hooks/exhaustive-deps

  // The React-owned player surface is the only iframe host. YouTube playback is
  // paused whenever that surface is hidden, undersized, covered, or the tab is
  // backgrounded; the engine also independently enforces those visibility gates.
  useEffect(() => { yt.setVisible(ytActive && showVideo && !minimized && !obscured); }, [ytActive, showVideo, minimized, obscured]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!minimized && !obscured) return;
    yt.pause();
    audio.pause?.();
  }, [minimized, obscured]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { yt.setMeta({ title: cur ? (cur.title || cur.artist || "Now playing") : "Now playing" }); }, [curKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const upNext = list.slice(index + 1);
  const panelOpen = open;
  const togglePanel = () => setOpen((wasOpen) => {
    if (!wasOpen) onRefreshHistory?.();
    return !wasOpen;
  });

  useEffect(() => {
    if (column && !minimized) onRefreshHistory?.();
    // Refresh only as the panel is restored, not whenever the callback identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column, minimized]);

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

  // Keep diagnostics hooks above the empty-player return. Persisted queues can
  // briefly resolve to an invalid index and later recover without remounting.
  const unplayable = !!cur && forThis && !ytActive && !previewSrc && !connecting;
  const reportedFailure = useRef(null);
  useEffect(() => {
    const failureKind = audio.error?.kind || yt.error?.kind || (unplayable ? "unavailable" : null);
    if (!failureKind || !curKey) return;
    const key = `${curKey}:${failureKind}`;
    if (reportedFailure.current === key) return;
    reportedFailure.current = key;
    captureAppError(new Error("Playback source failed"), {
      code: "PIT-MEDIA-001",
      context: "Starting the selected track",
      source: audio.error ? "audio-preview" : "youtube-player",
      severity: "warning",
      // Reload autoplay can be blocked until the next user gesture. Record that
      // diagnostic without alarming the listener; the visible Play button is the
      // expected recovery path, not a broken-track failure.
      toast: unplayable || (!!audio.error && audio.error.kind !== "permission"),
    });
  }, [audio.error?.kind, curKey, unplayable, yt.error?.kind]);

  const playlistTrack = (track, exactVideoId = null) => ({
    title: track?.title || track?.artist,
    artist: track?.artist,
    url: track?.url,
    id: track?.id,
    sourceId: track?.sourceId || track?.id,
    provider: track?.provider,
    videoId: exactVideoId || track?.videoId || null,
    duration: track?.duration,
    preview: track?.preview,
    art: track?.art,
  });

  if (!cur) {
    if (!column) return null;
    // Idle column: collapsed by default (App starts it minimized), so an empty
    // session is a slim rail, not a quarter of the screen. It expands on play.
    if (minimized) {
      return (
        <View style={styles.miniShell}>
          <Pressable style={styles.miniRestore} onPress={onRestore} accessibilityRole="button" accessibilityLabel="Open the player panel">
            <Icon name="chevron-right" size={18} color={colors.amber} />
          </Pressable>
          <View style={[styles.miniArt, styles.artEmpty]}><Icon name="music" size={18} color={colors.textDim} /></View>
          <Text style={styles.miniTitle}>PLAYER</Text>
        </View>
      );
    }
    return (
      <View style={styles.columnShell}>
        <View style={styles.columnHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.columnEyebrow}>PIT PLAYER</Text>
            <Text style={styles.columnHeadTitle}>Your listening session</Text>
          </View>
          <Pressable style={styles.headIcon} hitSlop={5} onPress={onMinimize} accessibilityRole="button" accessibilityLabel="Collapse the player panel">
            <Icon name="chevron-left" size={16} color={colors.textDim} />
          </Pressable>
        </View>
        {history.length ? (
          <ScrollView style={styles.columnQueueScroll} contentContainerStyle={styles.columnQueueContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.groupLabel}>RECENTLY PLAYED</Text>
            {history.slice(0, 12).map((track, historyIndex) => (
              <View key={`idle-history:${track.id || historyIndex}:${trackKey(track) || "track"}`} style={styles.qRow}>
                {track.art ? <Image source={{ uri: track.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                <Pressable style={{ flex: 1 }} onPress={() => onPlayTrack?.(playlistTrack(track))} accessibilityRole="button" accessibilityLabel={`Play ${track.title} again`}>
                  <Text style={styles.qTitle} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.qArtist} numberOfLines={1}>{track.artist}</Text>
                </Pressable>
                {onAddToPlaylist && <Pressable style={styles.qAct} onPress={() => onAddToPlaylist(playlistTrack(track))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Add ${track.title} to a playlist`}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>}
                <Icon name="play" size={13} color={colors.amber} />
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.emptyPlayer}>
            <View style={styles.emptyDisc}><Icon name="music" size={34} color={colors.amber} /></View>
            <Text style={styles.emptyTitle}>Nothing playing yet</Text>
            <Text style={styles.emptyCopy}>Choose a song from an artist, playlist, or Discover. Your player and queue will stay here while you explore Pit.</Text>
          </View>
        )}
      </View>
    );
  }

  const multi = list.length > 1;
  const title = cur.title || cur.artist || "Now playing";
  const artist = cur.artist || "";
  const art = cur.art || null;

  // Unified transport across whichever engine is live (YouTube player or preview mp3).
  const scrubbable = ytActive || !!previewSrc;
  const resolving = !forThis; // still fetching a source for this track
  const posMs = ytActive ? (yt.state.position || 0) : audio.pos * 1000;
  const durMs = ytActive ? (yt.state.duration || 0) : audio.dur * 1000;
  posRef.current = posMs;
  const playing = ytActive ? yt.state.playing : audio.playing;
  const playPause = () => {
    if (ytActive) {
      if (yt.state.playing) yt.pause();
      else {
        if (!showVideo) setShowVideo(true);
        // The engine queues this request until the host is visibly rendered.
        yt.play();
      }
    } else if (previewSrc) audio.toggle();
  };
  const onSeek = (ms) => { if (ytActive) yt.seek(ms); else audio.seek(ms / 1000); };
  const goPrev = () => onIndex?.(index - 1);
  const goNext = () => onIndex?.(index + 1);
  const minimizePlayer = () => {
    if (ytActive && yt.state.position > 0) engineResumeRef.current = { key: curKey, ms: yt.state.position };
    yt.pause();
    audio.pause?.();
    onMinimize?.();
  };
  const closePlayer = () => { yt.pause(); audio.pause?.(); onClose?.(); };

  const doSave = async () => {
    if (saving) return;
    setSaving(true);
    const intended = list.slice(0, Math.max(1, Math.min(player?.explicitCount ?? list.length, list.length)));
    const result = await onSaveSession?.(intended, `${cur.artist || "Session"} mix`);
    setSaving(false);
    if (result) { setSaved(true); setTimeout(() => setSaved(false), 1800); }
  };
  const Ctrl = ({ icon, onPress, disabled }) => (
    <Pressable style={[styles.ctrl, disabled && styles.ctrlOff]} disabled={disabled} onPress={onPress} hitSlop={6}>
      <Icon name={icon} size={17} color={disabled ? colors.textFaint : colors.text} />
    </Pressable>
  );

  const statusLine = connecting ? "Loading video..."
    : resolving ? "Loading..."
    : unplayable ? "Not available to play"
    : artist + (ytActive ? "  ·  YouTube" : previewSrc ? "  ·  preview" : "");

  // Compact (mobile) rule: the 200px video stage only takes space while the
  // video is actually on screen. Preview audio or paused video collapses it to
  // zero height (the host div stays mounted so the engine survives), which is
  // what keeps the phone layout usable. The desktop column always shows the
  // stage; it has the room and the placeholder art looks intentional there.
  const compactStageCollapsed = !column && !(ytActive && showVideo);
  const mediaSurface = (
    <View style={[styles.videoStage, !column && styles.compactVideoStage, compactStageCollapsed && styles.compactStageCollapsed]}>
      <View
        nativeID={youtubeHostId}
        style={[styles.videoHost, { opacity: ytActive && showVideo ? 1 : 0 }]}
        pointerEvents={ytActive && showVideo ? "auto" : "none"}
        accessibilityLabel={`YouTube player for ${title}`}
      />
      {(!ytActive || !showVideo) && !compactStageCollapsed && (
        <View style={styles.mediaPlaceholder} pointerEvents="none">
          {art ? <Image source={{ uri: art }} style={styles.heroArt} /> : <View style={[styles.heroArt, styles.artEmpty]}><Icon name="music" size={34} color={colors.amber} /></View>}
          <View style={styles.placeholderShade} />
          <View style={styles.placeholderLabel}>
            <Icon name={showVideo ? "music" : "play"} size={12} color={colors.amber} />
            <Text style={styles.placeholderTxt}>{showVideo ? (previewSrc ? "PREVIEW AUDIO" : "TUNING VIDEO") : "VIDEO PAUSED"}</Text>
          </View>
        </View>
      )}
    </View>
  );

  if (column && minimized) {
    return (
      <View style={styles.miniShell}>
        <Pressable style={styles.miniRestore} onPress={onRestore} accessibilityRole="button" accessibilityLabel="Restore player">
          <Icon name="chevron-right" size={18} color={colors.amber} />
        </Pressable>
        {art ? <Image source={{ uri: art }} style={styles.miniArt} /> : <View style={[styles.miniArt, styles.artEmpty]}><Icon name="music" size={18} color={colors.textDim} /></View>}
        <Text style={styles.miniTitle} numberOfLines={3}>{title}</Text>
        <Text style={styles.miniPaused}>PAUSED</Text>
      </View>
    );
  }

  // Mobile collapsed: one slim row instead of bar + video + scrubber eating half
  // the phone. Collapsing paused playback (YouTube terms: no hidden audio), so
  // the row honestly reads PAUSED; tapping it restores and you resume from there.
  if (minimized) {
    return (
      <Pressable style={styles.miniRowShell} onPress={onRestore} accessibilityRole="button" accessibilityLabel={`Open player. ${title} is paused.`}>
        {art ? <Image source={{ uri: art }} style={styles.miniRowArt} /> : <View style={[styles.miniRowArt, styles.artEmpty]}><Icon name="music" size={14} color={colors.textFaint} /></View>}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{artist ? artist + "  ·  " : ""}PAUSED</Text>
        </View>
        <View style={styles.miniRowBtn}><Icon name="chevron-down" size={16} color={colors.amber} /></View>
      </Pressable>
    );
  }

  if (column) {
    return (
      <View style={styles.columnShell}>
        <View style={styles.columnHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.columnEyebrow}>PIT PLAYER</Text>
            <Text style={styles.columnHeadTitle}>Now playing</Text>
          </View>
          {/* 34pt circles by design; hitSlop takes the touch target to 44pt. */}
          <Pressable style={styles.headIcon} hitSlop={5} onPress={minimizePlayer} accessibilityRole="button" accessibilityLabel="Minimize player, pauses playback">
            <Icon name="chevron-left" size={16} color={colors.textDim} />
          </Pressable>
          <Pressable style={styles.headIcon} hitSlop={5} onPress={closePlayer} accessibilityRole="button" accessibilityLabel="End listening session">
            <Icon name="x" size={15} color={colors.textDim} />
          </Pressable>
        </View>

        {mediaSurface}

        <View style={styles.columnMeta}>
          <Text style={styles.columnTitle} numberOfLines={2}>{title}</Text>
          {artist ? (
            <Pressable onPress={() => onOpenArtist?.(artist)} disabled={!onOpenArtist} accessibilityRole={onOpenArtist ? "button" : undefined} accessibilityLabel={onOpenArtist ? `Open ${artist}` : undefined}>
              <Text style={styles.columnArtist} numberOfLines={1}>{artist}</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.columnStatus, unplayable && { color: colors.gold }]} numberOfLines={1}>{statusLine}</Text>
        </View>

        <View style={styles.columnTransport}>
          <Pressable style={[styles.columnCtrl, index <= 0 && styles.ctrlOff]} disabled={index <= 0} onPress={goPrev} accessibilityRole="button" accessibilityLabel="Previous track">
            <Icon name="chevron-left" size={21} color={index <= 0 ? colors.textFaint : colors.text} />
          </Pressable>
          <Pressable style={[styles.columnPlay, !scrubbable && styles.ctrlOff]} onPress={playPause} disabled={!scrubbable} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"}>
            {(connecting || resolving) && !scrubbable
              ? <View style={styles.dots}><View style={styles.dotDark} /><View style={styles.dotDark} /><View style={styles.dotDark} /></View>
              : playing ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <Icon name="play" size={21} color="#1A1206" />}
          </Pressable>
          <Pressable style={[styles.columnCtrl, index >= list.length - 1 && styles.ctrlOff]} disabled={index >= list.length - 1} onPress={goNext} accessibilityRole="button" accessibilityLabel="Next track">
            <Icon name="chevron-right" size={21} color={index >= list.length - 1 ? colors.textFaint : colors.text} />
          </Pressable>
        </View>

        {scrubbable && (
          <View style={styles.columnScrub}>
            <Scrubber posMs={posMs} durMs={durMs} onSeek={onSeek} live />
            <VolumeControl volume={volume} onChange={setVol} />
          </View>
        )}

        <View style={styles.columnActions}>
          <Pressable style={[styles.columnAction, panelOpen && styles.columnActionOn]} onPress={togglePanel} accessibilityRole="button" accessibilityState={{ expanded: panelOpen }} accessibilityLabel={`${panelOpen ? "Hide" : "Show"} listening session, ${upNext.length} up next`}>
            <Icon name="feed" size={14} color={panelOpen ? colors.amber : colors.textDim} />
            <Text style={[styles.columnActionTxt, panelOpen && { color: colors.amber }]}>Queue {upNext.length}</Text>
          </Pressable>
          {ytActive && (
            <Pressable style={[styles.columnAction, showVideo && styles.columnActionOn]} onPress={() => setShowVideo((visible) => { if (visible) yt.pause(); return !visible; })} accessibilityRole="button" accessibilityLabel={showVideo ? "Hide video, pauses playback" : "Show video"}>
              <Icon name="play" size={13} color={showVideo ? colors.amber : colors.textDim} />
              <Text style={[styles.columnActionTxt, showVideo && { color: colors.amber }]}>Video</Text>
            </Pressable>
          )}
          {onAddToPlaylist && (
            <Pressable style={styles.columnAction} onPress={() => onAddToPlaylist(playlistTrack(cur, forThis ? resolved.videoId : null))} accessibilityRole="button" accessibilityLabel={`Add ${title} to a playlist`}>
              <Icon name="plus" size={14} color={colors.textDim} />
              <Text style={styles.columnActionTxt}>Playlist</Text>
            </Pressable>
          )}
          <Pressable style={styles.columnAction} onPress={doSave} disabled={saving} accessibilityRole="button" accessibilityLabel="Save listening session">
            <Icon name={saved ? "check" : "star"} size={13} color={saved ? colors.good : colors.textDim} />
            <Text style={[styles.columnActionTxt, saved && { color: colors.good }]}>{saved ? "Saved" : saving ? "Saving" : "Save mix"}</Text>
          </Pressable>
        </View>

        <View style={styles.columnQueueArea}>
          <View style={styles.columnQueueHead}>
            <Text style={styles.panelTitle}>{panelOpen ? "LISTENING SESSION" : "COMING UP"}</Text>
            {!panelOpen && nextTitle ? <Text style={styles.columnQueueCount}>{upNext.length} queued</Text> : null}
          </View>
          {panelOpen ? (
            <ScrollView style={styles.columnQueueScroll} contentContainerStyle={styles.columnQueueContent} showsVerticalScrollIndicator={false}>
              {upNext.length > 0 && <Text style={styles.groupLabel}>UP NEXT · {upNext.length}</Text>}
              {upNext.map((t, j) => {
                const real = index + 1 + j;
                return (
                  <View key={`${trackKey(t) || "track"}:${real}`} style={styles.qRow} accessibilityLabel={`Up next ${j + 1}: ${t.title}${t.artist ? " by " + t.artist : ""}`}>
                    {t.art ? <Image source={{ uri: t.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                    <Pressable style={{ flex: 1 }} onPress={() => onPlayAt?.(real)} accessibilityRole="button" accessibilityLabel={`Play ${t.title}`}>
                      <Text style={styles.qTitle} numberOfLines={1}>{t.title}</Text>
                      <Text style={styles.qArtist} numberOfLines={1}>{t.artist}</Text>
                    </Pressable>
                    {onAddToPlaylist && <Pressable style={styles.qAct} onPress={() => onAddToPlaylist(playlistTrack(t))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Add ${t.title} to a playlist`}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>}
                    <Pressable style={styles.qAct} onPress={() => onMoveNext?.(real)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Play ${t.title} next`}><Icon name="menu" size={14} color={colors.textDim} /></Pressable>
                    <Pressable style={styles.qAct} onPress={() => onRemove?.(real)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${t.title} from queue`}><Icon name="x" size={13} color={colors.textDim} /></Pressable>
                  </View>
                );
              })}
              {history.length > 0 && <Text style={styles.groupLabel}>RECENTLY PLAYED</Text>}
              {history.slice(0, 8).map((t, j) => (
                <Pressable key={`history:${j}:${trackKey(t) || "track"}`} style={styles.qRow} onPress={() => onPlayTrack?.(playlistTrack(t))} accessibilityRole="button" accessibilityLabel={`Play ${t.title} again`}>
                  {t.art ? <Image source={{ uri: t.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                  <View style={{ flex: 1 }}><Text style={styles.qTitle} numberOfLines={1}>{t.title}</Text><Text style={styles.qArtist} numberOfLines={1}>{t.artist}</Text></View>
                  {onAddToPlaylist && <Pressable style={styles.qAct} onPress={() => onAddToPlaylist(playlistTrack(t))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Add ${t.title} to a playlist`}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>}
                  <Icon name="play" size={13} color={colors.textDim} />
                </Pressable>
              ))}
            </ScrollView>
          ) : nextTitle ? (
            <Pressable style={styles.nextCard} onPress={() => onPlayAt?.(index + 1)} accessibilityRole="button" accessibilityLabel={`Play next, ${nextTitle}`}>
              {upNext[0]?.art ? <Image source={{ uri: upNext[0].art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
              <View style={{ flex: 1 }}><Text style={styles.qTitle} numberOfLines={1}>{nextTitle}</Text><Text style={styles.qArtist} numberOfLines={1}>{upNext[0]?.artist}</Text></View>
              <Icon name="play" size={13} color={colors.amber} />
            </Pressable>
          ) : (
            <Text style={styles.queueEmpty}>Your queue is clear. Pick another song to keep the session going.</Text>
          )}
        </View>
      </View>
    );
  }

  // The queue panel opens ONLY on an explicit tap (the queue button or the title),
  // never on hover — hovering the bar was accidentally popping the panel open.
  return (
    <View style={styles.shell}>
      {web && mediaSurface}
      <View style={styles.bar}>
        {art ? <Image source={{ uri: art }} style={styles.art} /> : <View style={[styles.art, styles.artEmpty]}><Icon name="music" size={16} color={colors.textFaint} /></View>}
        <Pressable style={[styles.meta, styles.metaGrow]} onPress={(multi || history.length) ? togglePanel : undefined} accessibilityRole={(multi || history.length) ? "button" : undefined} accessibilityLabel={(multi || history.length) ? `Now playing ${title}. Open listening session.` : undefined}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {peekNext && nextTitle
            ? <Text style={styles.peekNext} numberOfLines={1}>{"↑ Up next · " + nextTitle}</Text>
            : <Text style={styles.sub} numberOfLines={1}>{statusLine}</Text>}
        </Pressable>

        {compactMobile ? (
          <>
            <Pressable style={[styles.mobilePlay, !scrubbable && styles.ctrlOff]} onPress={playPause} disabled={!scrubbable} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"}>
              {(connecting || resolving) && !scrubbable
                ? <View style={styles.dots}><View style={styles.dotDark} /><View style={styles.dotDark} /><View style={styles.dotDark} /></View>
                : playing ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <Icon name="play" size={19} color="#1A1206" />}
            </Pressable>
            <Pressable style={[styles.mobileMenu, panelOpen && styles.queueBtnOn]} onPress={togglePanel} accessibilityRole="button" accessibilityState={{ expanded: panelOpen }} accessibilityLabel={`Open player controls, ${upNext.length} up next`}>
              <Icon name="feed" size={18} color={panelOpen ? colors.amber : colors.textDim} />
            </Pressable>
          </>
        ) : (
          <>
            <Ctrl icon="chevron-left" onPress={goPrev} disabled={index <= 0} />
            <Pressable style={[styles.ctrl, styles.play, !scrubbable && styles.ctrlOff]} onPress={playPause} hitSlop={6} disabled={!scrubbable}>
              {(connecting || resolving) && !scrubbable
                ? <View style={styles.dots}><View style={styles.dotDark} /><View style={styles.dotDark} /><View style={styles.dotDark} /></View>
                : playing ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <Icon name="play" size={16} color="#1A1206" />}
            </Pressable>
            <Ctrl icon="chevron-right" onPress={goNext} disabled={index >= list.length - 1} />

            {(multi || history.length > 0) && (
              <Pressable style={[styles.queueBtn, panelOpen && styles.queueBtnOn]} onPress={togglePanel} hitSlop={6} accessibilityRole="button" accessibilityState={{ expanded: panelOpen }} accessibilityLabel={`${panelOpen ? "Hide" : "Show"} listening session, ${upNext.length} up next`}>
                <Icon name="feed" size={13} color={panelOpen ? colors.amber : colors.textDim} />
                <Text style={[styles.queueTxt, panelOpen && { color: colors.amber }]}>{upNext.length}</Text>
              </Pressable>
            )}
            {ytActive && (
              <Pressable style={[styles.queueBtn, showVideo && styles.queueBtnOn]} onPress={() => setShowVideo((v) => { if (v) yt.pause(); return !v; })} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: showVideo }} accessibilityLabel={showVideo ? "Hide video" : "Show video"}>
                <Icon name="play" size={12} color={showVideo ? colors.amber : colors.textDim} />
                <Text style={[styles.queueTxt, showVideo && { color: colors.amber }]}>Video</Text>
              </Pressable>
            )}
            <Ctrl icon="chevron-down" onPress={minimizePlayer} />
            <Ctrl icon="x" onPress={closePlayer} />
          </>
        )}
      </View>

      {scrubbable && (
        <View style={styles.scrubRow}>
          <View style={{ flex: 1 }}><Scrubber posMs={posMs} durMs={durMs} onSeek={onSeek} live /></View>
          {/* Phones have hardware volume; the slider only earns its width on
              wider screens. */}
          {winWidth >= 700 && <VolumeControl volume={volume} onChange={setVol} />}
        </View>
      )}

      {!compactMobile && panelOpen && (multi || history.length > 0) && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>LISTENING SESSION</Text>
            <View style={styles.panelActions}>
              {onAddToPlaylist && (
                <Pressable style={styles.addBtn} onPress={() => onAddToPlaylist(playlistTrack(cur, forThis ? resolved.videoId : null))}>
                  <Icon name="plus" size={12} color={colors.textDim} />
                  <Text style={styles.addTxt}>Add song</Text>
                </Pressable>
              )}
              <Pressable style={styles.saveBtn} onPress={doSave} disabled={saving}>
                <Icon name={saved ? "check" : "star"} size={12} color={saved ? colors.good : colors.amber} />
                <Text style={[styles.saveTxt, saved && { color: colors.good }]}>{saved ? "Saved" : saving ? "Saving" : "Save session"}</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView style={styles.panelScroll} showsVerticalScrollIndicator={false}>
            {upNext.length > 0 && <Text style={styles.groupLabel}>UP NEXT · {upNext.length}</Text>}
            {upNext.map((t, j) => {
              const real = index + 1 + j;
              return (
                <View key={(t.url || t.title) + real} style={styles.qRow} accessibilityLabel={`Up next ${j + 1}: ${t.title}${t.artist ? " by " + t.artist : ""}`}>
                  {t.art ? <Image source={{ uri: t.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                  <Pressable style={{ flex: 1 }} onPress={() => onPlayAt?.(real)} accessibilityRole="button" accessibilityLabel={`Play ${t.title}`}>
                    <Text style={styles.qTitle} numberOfLines={1}>{t.title}</Text>
                    <Text style={styles.qArtist} numberOfLines={1}>{t.artist}</Text>
                  </Pressable>
                  {onAddToPlaylist && <Pressable style={styles.qAct} onPress={() => onAddToPlaylist(playlistTrack(t))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Add ${t.title} to a playlist`}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>}
                  <Pressable style={styles.qAct} onPress={() => onMoveNext?.(real)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Play ${t.title} next`}><Icon name="menu" size={14} color={colors.textDim} /></Pressable>
                  <Pressable style={styles.qAct} onPress={() => onRemove?.(real)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${t.title} from queue`}><Icon name="x" size={13} color={colors.textDim} /></Pressable>
                </View>
              );
            })}

            {history.length > 0 && <Text style={styles.groupLabel}>RECENTLY PLAYED</Text>}
            {history.slice(0, 8).map((t, j) => (
              <Pressable key={"h" + j + (t.url || t.title)} style={styles.qRow} onPress={() => onPlayTrack?.(playlistTrack(t))}>
                {t.art ? <Image source={{ uri: t.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.qTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={styles.qArtist} numberOfLines={1}>{t.artist}</Text>
                </View>
                {onAddToPlaylist && <Pressable style={styles.qAct} onPress={() => onAddToPlaylist(playlistTrack(t))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Add ${t.title} to a playlist`}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>}
                <Icon name="play" size={13} color={colors.textDim} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <Modal visible={compactMobile && panelOpen} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={styles.mobileSheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close player controls" />
          <View style={styles.mobileSheet}>
            <View style={styles.mobileSheetHandle} />
            <View style={styles.mobileSheetHead}>
              <Text style={styles.mobileSheetKicker}>NOW PLAYING</Text>
              <Pressable style={styles.mobileSheetClose} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close player controls"><Icon name="x" size={19} color={colors.textDim} /></Pressable>
            </View>
            <View style={styles.mobileNowPlaying}>
              {art ? <Image source={{ uri: art }} style={styles.mobileSheetArt} /> : <View style={[styles.mobileSheetArt, styles.artEmpty]}><Icon name="music" size={24} color={colors.textFaint} /></View>}
              <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => { setOpen(false); if (cur?.artist) onOpenArtist?.(cur.artist); }} accessibilityRole={cur?.artist ? "button" : undefined}>
                <Text style={styles.mobileSheetTitle} numberOfLines={2}>{title}</Text>
                <Text style={styles.mobileSheetArtist} numberOfLines={1}>{cur?.artist || statusLine}</Text>
              </Pressable>
            </View>
            {scrubbable && <View style={styles.mobileSheetScrub}><Scrubber posMs={posMs} durMs={durMs} onSeek={onSeek} live /></View>}
            <View style={styles.mobileTransport}>
              <Pressable style={[styles.mobileTransportBtn, index <= 0 && styles.ctrlOff]} onPress={goPrev} disabled={index <= 0} accessibilityRole="button" accessibilityLabel="Previous song"><Icon name="chevron-left" size={25} color={colors.text} /></Pressable>
              <Pressable style={[styles.mobileTransportPlay, !scrubbable && styles.ctrlOff]} onPress={playPause} disabled={!scrubbable} accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"}>
                {playing ? <View style={styles.pauseGlyph}><View style={[styles.pauseBar, styles.mobilePauseBar]} /><View style={[styles.pauseBar, styles.mobilePauseBar]} /></View> : <Icon name="play" size={25} color="#1A1206" />}
              </Pressable>
              <Pressable style={[styles.mobileTransportBtn, index >= list.length - 1 && styles.ctrlOff]} onPress={goNext} disabled={index >= list.length - 1} accessibilityRole="button" accessibilityLabel="Next song"><Icon name="chevron-right" size={25} color={colors.text} /></Pressable>
            </View>
            <View style={styles.mobileQuickActions}>
              {onAddToPlaylist && <Pressable style={styles.mobileQuickBtn} onPress={() => onAddToPlaylist(playlistTrack(cur, forThis ? resolved.videoId : null))}><Icon name="plus" size={16} color={colors.amber} /><Text style={styles.mobileQuickTxt}>Playlist</Text></Pressable>}
              <Pressable style={styles.mobileQuickBtn} onPress={doSave} disabled={saving}><Icon name={saved ? "check" : "star"} size={16} color={saved ? colors.good : colors.amber} /><Text style={styles.mobileQuickTxt}>{saved ? "Saved" : "Save mix"}</Text></Pressable>
              {ytActive && <Pressable style={styles.mobileQuickBtn} onPress={() => { setOpen(false); setShowVideo(true); }}><Icon name="play" size={16} color={colors.amber} /><Text style={styles.mobileQuickTxt}>Video</Text></Pressable>}
              <Pressable style={styles.mobileQuickBtn} onPress={() => { setOpen(false); closePlayer(); }}><Icon name="x" size={16} color={colors.danger} /><Text style={[styles.mobileQuickTxt, { color: colors.danger }]}>Stop</Text></Pressable>
            </View>

            <ScrollView style={styles.mobileQueueScroll} contentContainerStyle={styles.mobileQueueContent} showsVerticalScrollIndicator={false}>
              {upNext.length > 0 && <Text style={styles.groupLabel}>UP NEXT Â· {upNext.length}</Text>}
              {upNext.map((track, queueIndex) => {
                const realIndex = index + 1 + queueIndex;
                return (
                  <View key={`mobile-up-next:${realIndex}:${trackKey(track) || track.title}`} style={styles.mobileQueueRow}>
                    <Pressable style={styles.mobileQueueMain} onPress={() => { onPlayAt?.(realIndex); setOpen(false); }} accessibilityRole="button" accessibilityLabel={`Play ${track.title}`}>
                      {track.art ? <Image source={{ uri: track.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                      <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.qTitle} numberOfLines={1}>{track.title}</Text><Text style={styles.qArtist} numberOfLines={1}>{track.artist}</Text></View>
                    </Pressable>
                    <Pressable style={styles.mobileQueueAction} onPress={() => onRemove?.(realIndex)} accessibilityRole="button" accessibilityLabel={`Remove ${track.title} from queue`}><Icon name="x" size={16} color={colors.textDim} /></Pressable>
                  </View>
                );
              })}
              {history.length > 0 && <Text style={styles.groupLabel}>RECENTLY PLAYED</Text>}
              {history.slice(0, 8).map((track, historyIndex) => (
                <Pressable key={`mobile-history:${historyIndex}:${trackKey(track) || track.title}`} style={styles.mobileQueueMain} onPress={() => { onPlayTrack?.(playlistTrack(track)); setOpen(false); }} accessibilityRole="button" accessibilityLabel={`Play ${track.title} again`}>
                  {track.art ? <Image source={{ uri: track.art }} style={styles.qArt} /> : <View style={[styles.qArt, styles.artEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
                  <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.qTitle} numberOfLines={1}>{track.title}</Text><Text style={styles.qArtist} numberOfLines={1}>{track.artist}</Text></View>
                  <Icon name="play" size={15} color={colors.amber} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  columnShell: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: colors.bgElev, borderRightWidth: 1, borderRightColor: colors.line, overflow: "hidden" },
  columnHead: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  columnEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  columnHeadTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 2 },
  headIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  emptyPlayer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 34, paddingBottom: 70 },
  emptyDisc: { width: 90, height: 90, borderRadius: 45, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 18 },
  emptyCopy: { color: colors.textDim, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8, maxWidth: 280 },
  videoStage: { width: "100%", minHeight: 200, aspectRatio: 16 / 9, maxHeight: 270, alignItems: "center", justifyContent: "center", backgroundColor: "#000", overflow: "hidden" },
  compactVideoStage: { alignSelf: "center", maxWidth: 480, width: "100%" },
  // Collapsed-but-mounted: zero footprint while no video is on screen (the
  // engine's host div must stay in the DOM to survive pause/resume).
  compactStageCollapsed: { minHeight: 0, maxHeight: 0, height: 0, aspectRatio: undefined },
  // Fill the 16:9 stage exactly. No min-width/height here: those forced the host
  // larger than the stage at some breakpoints, and overflow:hidden then cropped
  // the video. The iframe is pinned to 100%/100% of this host (youtubePlayer.js),
  // so it always tracks the stage and letterboxes the video instead of cropping.
  videoHost: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000" },
  mediaPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  heroArt: { width: 132, height: 132, borderRadius: 18, backgroundColor: colors.surfaceAlt, ...shadow.sheet },
  placeholderShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,6,10,0.16)" },
  placeholderLabel: { position: "absolute", left: 12, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(9,10,14,0.86)", borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  placeholderTxt: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  columnMeta: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 8 },
  columnTitle: { color: colors.text, fontSize: 19, lineHeight: 24, fontWeight: "900", letterSpacing: -0.2 },
  columnArtist: { color: colors.textDim, fontSize: 14, lineHeight: 20, fontWeight: "700", marginTop: 2 },
  columnStatus: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, marginTop: 4 },
  columnTransport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, paddingHorizontal: 18, paddingVertical: 8 },
  columnCtrl: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  columnPlay: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, borderWidth: 1, borderColor: colors.amber, ...shadow.control },
  columnScrub: { width: "100%", paddingHorizontal: 12, paddingTop: 2, paddingBottom: 7, alignItems: "stretch" },
  columnActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 },
  columnAction: { minWidth: 94, flexGrow: 1, height: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 9, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  columnActionOn: { borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  columnActionTxt: { color: colors.textDim, fontSize: 11, fontWeight: "800" },
  columnQueueArea: { flex: 1, minHeight: 92, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 12, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  columnQueueHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  columnQueueCount: { color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  columnQueueScroll: { flex: 1 },
  columnQueueContent: { paddingBottom: 12 },
  nextCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 9, marginTop: 4, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  queueEmpty: { color: colors.textFaint, fontSize: 12, lineHeight: 18, fontStyle: "italic", marginTop: 7 },
  miniShell: { flex: 1, minWidth: 0, alignItems: "center", gap: 12, paddingTop: 14, backgroundColor: colors.bgElev, borderRightWidth: 1, borderRightColor: colors.line },
  miniRestore: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.amber },
  miniArt: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  miniTitle: { color: colors.text, fontSize: 11, lineHeight: 15, fontWeight: "800", textAlign: "center", paddingHorizontal: 8 },
  miniPaused: { color: colors.textFaint, fontFamily: mono, fontSize: 8, letterSpacing: 1.2 },
  miniRowShell: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.bgElev, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 12, paddingVertical: 7, minHeight: 52 },
  miniRowArt: { width: 36, height: 36, borderRadius: 7, backgroundColor: colors.surfaceAlt },
  miniRowBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface },
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
  scrub: { width: "100%", flexDirection: "row", alignItems: "center", gap: 10 },
  vol: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 7, marginLeft: 12, ...(web ? { width: 110 } : { width: 90 }) },
  volTrack: { flex: 1, height: 16, justifyContent: "center", ...(web ? { cursor: "pointer" } : null) },
  time: { color: colors.textDim, fontSize: 11, fontFamily: mono, width: 40, textAlign: "center" },
  track: { flex: 1, height: 16, justifyContent: "center", ...(web ? { cursor: "pointer" } : null) },
  trackBg: { position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt },
  trackFill: { position: "absolute", left: 0, height: 4, borderRadius: 2, backgroundColor: colors.amber },
  thumb: { position: "absolute", width: 11, height: 11, borderRadius: 6, backgroundColor: colors.amber, marginLeft: -5.5, ...shadow.card },
  ctrl: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  mobilePlay: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, borderWidth: 1, borderColor: colors.amber, ...shadow.control },
  mobileMenu: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
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
  mobileSheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.58)" },
  mobileSheet: { maxHeight: "86%", minHeight: "62%", backgroundColor: colors.bgElev, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.line, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 28 : 18, ...shadow.sheet },
  mobileSheetHandle: { alignSelf: "center", width: 42, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 7 },
  mobileSheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 42 },
  mobileSheetKicker: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.6 },
  mobileSheetClose: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  mobileNowPlaying: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10 },
  mobileSheetArt: { width: 76, height: 76, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  mobileSheetTitle: { color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  mobileSheetArtist: { color: colors.textDim, fontSize: 13.5, lineHeight: 19, marginTop: 3 },
  mobileSheetScrub: { width: "100%", paddingVertical: 7 },
  mobileTransport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28, paddingVertical: 9 },
  mobileTransportBtn: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  mobileTransportPlay: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, borderWidth: 1, borderColor: colors.amber, ...shadow.control },
  mobilePauseBar: { width: 5, height: 20 },
  mobileQuickActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  mobileQuickBtn: { minHeight: 44, flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  mobileQuickTxt: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  mobileQueueScroll: { flexShrink: 1, minHeight: 120 },
  mobileQueueContent: { paddingBottom: 18 },
  mobileQueueRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  mobileQueueMain: { minHeight: 58, flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  mobileQueueAction: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  groupLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.2, fontWeight: "800", marginTop: 8, marginBottom: 4 },
  qRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  qArt: { width: 34, height: 34, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  qTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  qArtist: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  qAct: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 14 },
});
