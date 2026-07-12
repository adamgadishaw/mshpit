import { useEffect, useRef, useState, useCallback } from "react";
import { Platform } from "react-native";

// YouTube IFrame Player wrapper. Plays the FULL song/video for everyone with no
// account and no Premium (the reason we moved off Spotify). One persistent player
// lives in a fixed, body-appended holder so React Native's DOM never reparents or
// reloads it mid-song; our top bar drives play / pause / seek / next through the
// IFrame API, and the same holder doubles as a small floating video you can
// show or hide. Audio keeps playing whether the video is visible or not.
const web = Platform.OS === "web" && typeof window !== "undefined";

let apiPromise = null;
function loadApi() {
  if (!web) return Promise.reject(new Error("no-dom"));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    // YouTube calls this global once its script is ready.
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch {} resolve(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => reject(new Error("yt-api-load-failed"));
    document.head.appendChild(s);
  });
  return apiPromise;
}

// The fixed holder that hosts the player element. Created once, reused forever.
function ensureHolder() {
  let holder = document.getElementById("pit-yt-holder");
  if (!holder) {
    holder = document.createElement("div");
    holder.id = "pit-yt-holder";
    const inner = document.createElement("div");
    inner.id = "pit-yt-player";
    holder.appendChild(inner);
    document.body.appendChild(holder);
  }
  applyHolderStyle(holder, false);
  return holder;
}

// Visible = a small rounded video card bottom-right; hidden = a 1px offscreen box
// that still plays audio (never display:none, which would stop playback).
function applyHolderStyle(holder, visible) {
  const base = "position:fixed;z-index:80;overflow:hidden;transition:opacity .15s ease;";
  holder.style.cssText = visible
    ? base + "right:16px;bottom:88px;width:260px;height:146px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);opacity:1;"
    : base + "left:-9999px;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  const inner = holder.firstChild;
  if (inner) { inner.style.width = "100%"; inner.style.height = "100%"; }
}

export function useYouTubePlayer(enabled) {
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState({ position: 0, duration: 0, playing: false });
  const [error, setError] = useState(null); // { kind, message }
  const endedCbRef = useRef(null);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    if (!web || !enabled) return;
    let cancelled = false;
    loadApi().then((YT) => {
      if (cancelled) return;
      ensureHolder();
      const player = new YT.Player("pit-yt-player", {
        width: "260", height: "146",
        playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => { setReady(true); setError(null); },
          onError: (e) => {
            // 101/150 = embedding disabled for that video; 100 = removed/private.
            const kind = e?.data === 101 || e?.data === 150 ? "embed" : "playback";
            setError({ kind, code: e?.data, message: kind === "embed" ? "This video can't be embedded; playing a preview." : "Video unavailable." });
          },
          onStateChange: (e) => {
            // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
            if (e.data === 0) { wasPlayingRef.current = false; endedCbRef.current && endedCbRef.current(); }
            if (e.data === 1) { wasPlayingRef.current = true; setError(null); }
          },
        },
      });
      playerRef.current = player;
    }).catch(() => setError({ kind: "init", message: "YouTube player failed to load." }));
    return () => {
      cancelled = true;
      try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
      playerRef.current = null; setReady(false);
    };
  }, [enabled]);

  // Poll for position/duration so the scrubber animates (state events are discrete).
  useEffect(() => {
    if (!web || !enabled) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p || !p.getCurrentTime) return;
      try {
        const st = p.getPlayerState ? p.getPlayerState() : -1;
        setState({ position: (p.getCurrentTime() || 0) * 1000, duration: (p.getDuration() || 0) * 1000, playing: st === 1 || st === 3 });
      } catch {}
    }, 500);
    return () => clearInterval(id);
  }, [enabled]);

  const load = useCallback((videoId, { startSec = 0 } = {}) => {
    const p = playerRef.current;
    if (!p || !p.loadVideoById) return;
    setError(null);
    try { p.loadVideoById({ videoId, startSeconds: Math.max(0, startSec) }); } catch {}
  }, []);
  const play = useCallback(() => { try { playerRef.current && playerRef.current.playVideo(); } catch {} }, []);
  const pause = useCallback(() => { try { playerRef.current && playerRef.current.pauseVideo(); } catch {} }, []);
  const toggle = useCallback(() => {
    const p = playerRef.current; if (!p || !p.getPlayerState) return;
    try { (p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo()); } catch {}
  }, []);
  const seek = useCallback((ms) => { try { playerRef.current && playerRef.current.seekTo(Math.max(0, ms / 1000), true); } catch {} }, []);
  const setVolume = useCallback((v) => { try { playerRef.current && playerRef.current.setVolume(Math.max(0, Math.min(100, Math.round(v * 100)))); } catch {} }, []);
  const setVisible = useCallback((visible) => { const h = web && document.getElementById("pit-yt-holder"); if (h) applyHolderStyle(h, !!visible); }, []);
  const onEnded = useCallback((cb) => { endedCbRef.current = cb; }, []);

  return { ready, state, error, load, play, pause, toggle, seek, setVolume, setVisible, onEnded };
}
