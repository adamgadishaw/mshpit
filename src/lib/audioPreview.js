import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  audioPreviewLeaseMatches,
  classifyAudioPlayRejection,
} from "../domain/audioPreviewFailure.mjs";

// HTML5 <audio> engine for the 30s preview mp3s that Deezer/Spotify give us. This
// is what makes the play buttons work for EVERYONE (no Spotify Premium, no OAuth):
// it plays a real audio file, exposes a seekable position + duration for the
// scrubber, and fires onEnded so the queue auto-advances. Spotify Connect (full
// tracks) still takes priority when a listener has linked a Premium account.
const web = Platform.OS === "web" && typeof window !== "undefined";

function attemptMediaControl(action) {
  try {
    action();
    return true;
  } catch {
    // HTMLMediaElement control can reject during source replacement/teardown;
    // play() failures are handled separately because those affect the listener.
    return false;
  }
}

export function useAudioPreview(src, { enabled = true, mediaKey = "", onEnded, onStarted, startAt = 0, volume = 1 } = {}) {
  const audioRef = useRef(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const startedRef = useRef(onStarted);
  startedRef.current = onStarted;
  const startRef = useRef(startAt); // where to resume this src (survives a reload)
  startRef.current = startAt;
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);
  const loadGenerationRef = useRef(0);
  const activeLoadRef = useRef(null);
  const lastPos = useRef(0); // throttle decorative progress updates to cut shell re-renders

  // Each source/queue occurrence gets its own element and immutable load lease.
  // A delayed event or play() rejection from the prior load can therefore never
  // report a failure against the song that replaced it.
  useEffect(() => {
    if (!web || !enabled) {
      activeLoadRef.current = null;
      setPlaying(false);
      return;
    }
    const a = new window.Audio();
    const lease = {
      element: a,
      mediaKey,
      source: src || null,
      generation: ++loadGenerationRef.current,
    };
    const isCurrent = () => audioPreviewLeaseMatches(activeLoadRef.current, lease);
    const occurrence = { mediaKey: lease.mediaKey, source: lease.source };
    a.preload = "auto";
    audioRef.current = a;
    activeLoadRef.current = lease;
    // timeupdate can fire several times per second. One progress update per
    // second is smooth enough for a 30-second preview and avoids repeatedly
    // re-rendering the persistent player shell.
    const onTime = () => { if (!isCurrent()) return; const t = a.currentTime || 0; if (Math.abs(t - lastPos.current) >= 0.95) { lastPos.current = t; setPos(t); } };
    const onMeta = () => { if (isCurrent()) setDur(isFinite(a.duration) ? a.duration : 0); };
    const onPlay = () => { if (!isCurrent()) return; setPlaying(true); setError(null); startedRef.current?.(occurrence); };
    const onPause = () => { if (isCurrent()) setPlaying(false); };
    const onEnd = () => { if (!isCurrent()) return; setPlaying(false); endedRef.current?.(occurrence); };
    const onError = () => {
      if (!isCurrent()) return;
      setPlaying(false);
      setError({ kind: "playback", code: a.error?.code || 0, mediaKey: lease.mediaKey, source: lease.source });
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("playing", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onError);
    return () => {
      if (isCurrent()) activeLoadRef.current = null;
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("playing", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onError);
      // Clearing with `src = ""` makes the browser resolve the empty string
      // against the page URL and try to load the document itself as media
      // ("Invalid URI. Load of media resource failed"). Remove the attribute.
      attemptMediaControl(() => { a.pause(); a.removeAttribute("src"); a.load(); });
      if (audioRef.current === a) audioRef.current = null;
    };
  }, [enabled, mediaKey, src]);

  // Load + auto-play whenever the track changes (autoplay is allowed because the
  // user has already tapped a play button = a page gesture).
  useEffect(() => {
    const a = audioRef.current;
    const lease = activeLoadRef.current;
    if (!a || !lease || lease.element !== a) return;
    setPos(0); setDur(0); setPlaying(false); setError(null);
    if (!src) { attemptMediaControl(() => { a.pause(); a.removeAttribute("src"); a.load(); }); return; }
    // Explicitly reload even when the URI is unchanged. Adjacent queue entries
    // can intentionally contain the same recording, and an ended media element
    // otherwise stays ended instead of starting occurrence two from zero.
    attemptMediaControl(() => a.pause());
    a.src = src;
    attemptMediaControl(() => { a.volume = Math.max(0, Math.min(1, volume)); });
    // Resume where we left off before a reload (theme change / refresh), once.
    const resumeAt = startRef.current;
    if (resumeAt > 0.5) {
      const seekOnce = () => { attemptMediaControl(() => { a.currentTime = Math.min(resumeAt, (a.duration || resumeAt) - 0.3); }); a.removeEventListener("loadedmetadata", seekOnce); };
      a.addEventListener("loadedmetadata", seekOnce);
    }
    attemptMediaControl(() => a.load());
    const reportPlayRejection = (reason) => {
      const failure = classifyAudioPlayRejection(reason);
      if (!failure || !audioPreviewLeaseMatches(activeLoadRef.current, lease)) return;
      setError({ ...failure, mediaKey: lease.mediaKey, source: lease.source });
    };
    try { a.play()?.catch?.(reportPlayRejection); } catch (reason) { reportPlayRejection(reason); }
  }, [src, enabled, mediaKey]);

  const toggle = () => {
    const a = audioRef.current;
    const lease = activeLoadRef.current;
    if (!a || !lease || lease.element !== a) return;
    if (a.paused) {
      const reportPlayRejection = (reason) => {
        const failure = classifyAudioPlayRejection(reason);
        if (!failure || !audioPreviewLeaseMatches(activeLoadRef.current, lease)) return;
        setError({ ...failure, mediaKey: lease.mediaKey, source: lease.source });
      };
      try { a.play()?.catch?.(reportPlayRejection); } catch (reason) { reportPlayRejection(reason); }
    } else a.pause();
  };
  const pause = () => {
    const a = audioRef.current;
    if (!a) return;
    attemptMediaControl(() => a.pause());
  };
  const seek = (sec) => {
    const a = audioRef.current;
    if (!a || !isFinite(sec)) return;
    attemptMediaControl(() => { a.currentTime = Math.max(0, Math.min(sec, a.duration || sec)); setPos(a.currentTime); });
  };
  // Keep the element's volume in sync when the caller changes it live.
  useEffect(() => { const a = audioRef.current; if (a) attemptMediaControl(() => { a.volume = Math.max(0, Math.min(1, volume)); }); }, [volume]);
  return { pos, dur, playing, error, toggle, pause, seek };
}
