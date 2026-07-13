import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// HTML5 <audio> engine for the 30s preview mp3s that Deezer/Spotify give us. This
// is what makes the play buttons work for EVERYONE (no Spotify Premium, no OAuth):
// it plays a real audio file, exposes a seekable position + duration for the
// scrubber, and fires onEnded so the queue auto-advances. Spotify Connect (full
// tracks) still takes priority when a listener has linked a Premium account.
const web = Platform.OS === "web" && typeof window !== "undefined";

export function useAudioPreview(src, { enabled = true, onEnded, startAt = 0, volume = 1 } = {}) {
  const audioRef = useRef(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const startRef = useRef(startAt); // where to resume this src (survives a reload)
  startRef.current = startAt;
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);
  const lastPos = useRef(0); // throttle position state updates to cut re-renders (lag)

  // One <audio> element per mount, wired to state.
  useEffect(() => {
    if (!web || !enabled) return;
    const a = new window.Audio();
    a.preload = "auto";
    audioRef.current = a;
    // timeupdate fires ~4x/sec; only push to state ~3x/sec so the whole player
    // bar isn't re-rendering on every tick (that was a real lag source).
    const onTime = () => { const t = a.currentTime || 0; if (Math.abs(t - lastPos.current) >= 0.28) { lastPos.current = t; setPos(t); } };
    const onMeta = () => setDur(isFinite(a.duration) ? a.duration : 0);
    const onPlay = () => { setPlaying(true); setError(null); };
    const onPause = () => setPlaying(false);
    const onEnd = () => { setPlaying(false); endedRef.current && endedRef.current(); };
    const onError = () => { setPlaying(false); setError({ kind: "playback", code: a.error?.code || 0 }); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("playing", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("playing", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onError);
      try { a.pause(); a.src = ""; } catch {}
      audioRef.current = null;
    };
  }, [enabled]);

  // Load + auto-play whenever the track changes (autoplay is allowed because the
  // user has already tapped a play button = a page gesture).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    setPos(0); setDur(0); setError(null);
    if (!src) { try { a.pause(); a.removeAttribute("src"); a.load(); } catch {} return; }
    a.src = src;
    try { a.volume = Math.max(0, Math.min(1, volume)); } catch {}
    // Resume where we left off before a reload (theme change / refresh), once.
    const resumeAt = startRef.current;
    if (resumeAt > 0.5) {
      const seekOnce = () => { try { a.currentTime = Math.min(resumeAt, (a.duration || resumeAt) - 0.3); } catch {}; a.removeEventListener("loadedmetadata", seekOnce); };
      a.addEventListener("loadedmetadata", seekOnce);
    }
    a.play().catch((reason) => setError({ kind: reason?.name === "NotAllowedError" ? "permission" : "playback" }));
  }, [src, enabled]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch((reason) => setError({ kind: reason?.name === "NotAllowedError" ? "permission" : "playback" })); else a.pause();
  };
  const seek = (sec) => {
    const a = audioRef.current;
    if (!a || !isFinite(sec)) return;
    try { a.currentTime = Math.max(0, Math.min(sec, a.duration || sec)); setPos(a.currentTime); } catch {}
  };
  // Keep the element's volume in sync when the caller changes it live.
  useEffect(() => { const a = audioRef.current; if (a) { try { a.volume = Math.max(0, Math.min(1, volume)); } catch {} } }, [volume]);
  return { pos, dur, playing, error, toggle, seek };
}
