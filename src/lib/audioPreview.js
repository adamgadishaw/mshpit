import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// HTML5 <audio> engine for the 30s preview mp3s that Deezer/Spotify give us. This
// is what makes the play buttons work for EVERYONE (no Spotify Premium, no OAuth):
// it plays a real audio file, exposes a seekable position + duration for the
// scrubber, and fires onEnded so the queue auto-advances. Spotify Connect (full
// tracks) still takes priority when a listener has linked a Premium account.
const web = Platform.OS === "web" && typeof window !== "undefined";

export function useAudioPreview(src, { enabled = true, onEnded } = {}) {
  const audioRef = useRef(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);

  // One <audio> element per mount, wired to state.
  useEffect(() => {
    if (!web || !enabled) return;
    const a = new window.Audio();
    a.preload = "auto";
    audioRef.current = a;
    const onTime = () => setPos(a.currentTime || 0);
    const onMeta = () => setDur(isFinite(a.duration) ? a.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => { setPlaying(false); endedRef.current && endedRef.current(); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("playing", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("playing", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnd);
      try { a.pause(); a.src = ""; } catch {}
      audioRef.current = null;
    };
  }, [enabled]);

  // Load + auto-play whenever the track changes (autoplay is allowed because the
  // user has already tapped a play button = a page gesture).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    setPos(0); setDur(0);
    if (!src) { try { a.pause(); a.removeAttribute("src"); a.load(); } catch {} return; }
    a.src = src;
    a.play().catch(() => {});
  }, [src, enabled]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };
  const seek = (sec) => {
    const a = audioRef.current;
    if (!a || !isFinite(sec)) return;
    try { a.currentTime = Math.max(0, Math.min(sec, a.duration || sec)); setPos(a.currentTime); } catch {}
  };
  return { pos, dur, playing, toggle, seek };
}
