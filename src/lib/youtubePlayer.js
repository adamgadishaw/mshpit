import { useEffect, useRef, useState, useCallback } from "react";
import { Platform } from "react-native";

// YouTube IFrame Player wrapper. Plays the FULL song/video for everyone with no
// account and no Premium (the reason we moved off Spotify). The player lives in a
// single, body-appended FLOATING WINDOW so React Native's DOM never reparents or
// reloads it mid-song — the video keeps playing while you move around the app.
// The window is a real pop-up: draggable by its header, minimizable to audio-only,
// and closable, with its own prev / play / next controls. Our top bar drives the
// same player, so the two stay in sync.
const web = Platform.OS === "web" && typeof window !== "undefined";

let apiPromise = null;
function loadApi() {
  if (!web) return Promise.reject(new Error("no-dom"));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch {} finish(resolve, window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => finish(reject, new Error("yt-api-load-failed"));
    timeout = setTimeout(() => finish(reject, new Error("yt-api-load-timeout")), 12000);
    document.head.appendChild(s);
  }).catch((error) => {
    // Permit a later mount to retry after a transient script/CDN failure.
    apiPromise = null;
    throw error;
  });
  return apiPromise;
}

const WIN_W = () => Math.min(320, (web ? window.innerWidth : 360) - 24);
const VID_H = (w) => Math.round((w * 9) / 16); // 16:9

// Small media-control SVGs (no emoji — matches the app's hand-drawn icon set).
const SVG = {
  prev: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h2.2v14H7z"/><path d="M20 5v14l-9.5-7z"/></svg>',
  next: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M14.8 5H17v14h-2.2z"/><path d="M4 5v14l9.5-7z"/></svg>',
  play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1"/><rect x="13.8" y="5" width="4.2" height="14" rx="1"/></svg>',
  min: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 15l6-6 6 6"/></svg>',
  expand: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  close: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function injectStyleOnce() {
  if (document.getElementById("pit-yt-style")) return;
  const s = document.createElement("style");
  s.id = "pit-yt-style";
  s.textContent = `
  .pit-ytwin{position:fixed;z-index:90;background:#14171f;border:1px solid #2a2f3a;border-radius:14px;box-shadow:0 18px 44px rgba(0,0,0,.55);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;opacity:0;pointer-events:none;transition:opacity .16s ease;}
  .pit-ytwin.on{opacity:1;pointer-events:auto;}
  .pit-ytwin-head{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 11px;background:#1b1f28;border-bottom:1px solid #2a2f3a;cursor:grab;user-select:none;}
  .pit-ytwin-head:active{cursor:grabbing;}
  .pit-ytwin.collapsed .pit-ytwin-head{cursor:pointer;border-bottom:none;}
  .pit-ytwin-dot{width:8px;height:8px;border-radius:4px;background:#f2a65a;box-shadow:0 0 8px rgba(242,166,90,.9);flex:none;}
  .pit-ytwin-title{flex:1;color:#eaecef;font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .pit-ytwin-btn{width:26px;height:26px;border:none;border-radius:7px;background:transparent;color:#aeb4bf;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}
  .pit-ytwin-btn:hover{background:#2a2f3a;color:#fff;}
  .pit-ytwin-video{width:100%;background:#000;overflow:hidden;transition:height .18s ease;}
  .pit-ytwin.collapsed .pit-ytwin-video{height:0 !important;}
  .pit-ytwin-video iframe{width:100%;border:0;display:block;}
  .pit-ytwin-ctrls{display:flex;align-items:center;justify-content:center;gap:16px;padding:8px;background:#1b1f28;border-top:1px solid #2a2f3a;}
  .pit-ytwin.collapsed .pit-ytwin-ctrls{display:none;}
  .pit-ytwin-c{border:none;background:transparent;color:#eaecef;cursor:pointer;width:36px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0;}
  .pit-ytwin-c:hover{background:#2a2f3a;}
  .pit-ytwin-play{background:#f2a65a;color:#1a1206;}
  .pit-ytwin-play:hover{background:#f4b673;}
  `;
  document.head.appendChild(s);
}

// Persisted window position (so it stays where you dragged it, across reloads).
function loadPos() { try { return JSON.parse(localStorage.getItem("pit.ytwin") || "null"); } catch { return null; } }
function savePos(p) { try { localStorage.setItem("pit.ytwin", JSON.stringify(p)); } catch {} }
function clampPos(x, y, w, h) {
  const maxX = window.innerWidth - w - 8, maxY = window.innerHeight - h - 8;
  return { x: Math.max(8, Math.min(x, maxX)), y: Math.max(8, Math.min(y, maxY)) };
}

export function useYouTubePlayer(enabled) {
  const playerRef = useRef(null);
  const videoIdRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState({ position: 0, duration: 0, playing: false });
  const [error, setError] = useState(null); // { kind, message }
  const endedCbRef = useRef(null);
  const handlersRef = useRef({}); // { onPrev, onNext, onClose }
  const metaRef = useRef({ title: "" });
  const shownRef = useRef(false);
  const collapsedRef = useRef(false);
  const applyRef = useRef(() => {});

  useEffect(() => {
    if (!web || !enabled) return;
    let cancelled = false;
    let cleanupDom = () => {};

    loadApi().then((YT) => {
      if (cancelled) return;
      injectStyleOnce();

      // Build the floating window once.
      const win = document.createElement("div");
      win.className = "pit-ytwin";
      win.id = "pit-yt-window";
      const w = WIN_W(), vh = VID_H(w);
      win.style.width = w + "px";
      win.innerHTML =
        '<div class="pit-ytwin-head" id="pit-ytwin-head">' +
          '<span class="pit-ytwin-dot"></span>' +
          '<span class="pit-ytwin-title" id="pit-ytwin-title">Now playing</span>' +
          '<button class="pit-ytwin-btn" id="pit-ytwin-min" title="Minimize to audio" aria-label="Minimize video">' + SVG.min + '</button>' +
          '<button class="pit-ytwin-btn" id="pit-ytwin-close" title="Hide video" aria-label="Hide video">' + SVG.close + '</button>' +
        '</div>' +
        '<div class="pit-ytwin-video" id="pit-ytwin-video" style="height:' + vh + 'px"><div id="pit-yt-player"></div></div>' +
        '<div class="pit-ytwin-ctrls">' +
          '<button class="pit-ytwin-c" id="pit-ytwin-prev" aria-label="Previous">' + SVG.prev + '</button>' +
          '<button class="pit-ytwin-c pit-ytwin-play" id="pit-ytwin-play" aria-label="Play or pause">' + SVG.pause + '</button>' +
          '<button class="pit-ytwin-c" id="pit-ytwin-next" aria-label="Next">' + SVG.next + '</button>' +
        '</div>';
      document.body.appendChild(win);

      const $ = (id) => win.querySelector("#" + id);
      const head = $("pit-ytwin-head"), video = $("pit-ytwin-video"), minBtn = $("pit-ytwin-min");
      if (metaRef.current.title) $("pit-ytwin-title").textContent = metaRef.current.title; // apply any title set before the window existed

      // Position: restored or default bottom-right.
      const winH = () => head.offsetHeight + (collapsedRef.current ? 0 : vh + 50);
      const startPos = loadPos() || { x: window.innerWidth - w - 16, y: window.innerHeight - vh - 130 };
      let pos = clampPos(startPos.x, startPos.y, w, winH());

      const apply = () => {
        win.classList.toggle("on", shownRef.current);
        win.classList.toggle("collapsed", collapsedRef.current);
        win.setAttribute("aria-hidden", shownRef.current ? "false" : "true");
        if ("inert" in win) win.inert = !shownRef.current;
        // Collapse by shrinking the WINDOW to its header (its overflow:hidden clips
        // the video + controls). The iframe stays rendered underneath, so audio keeps
        // playing while minimized. (Setting the video wrapper's own height is ignored
        // under react-native-web's global styles, so we clip at the window instead.)
        win.style.height = collapsedRef.current ? head.offsetHeight + "px" : "";
        minBtn.innerHTML = collapsedRef.current ? SVG.expand : SVG.min;
        minBtn.title = collapsedRef.current ? "Show video" : "Minimize to audio";
        pos = clampPos(pos.x, pos.y, w, winH());
        win.style.left = pos.x + "px";
        win.style.top = pos.y + "px";
      };
      applyRef.current = apply;
      apply();

      // Drag by the header (but not when clicking a header button).
      let dragging = false, dx = 0, dy = 0;
      const onDown = (ev) => {
        if (ev.target.closest("button")) return;
        if (collapsedRef.current) return; // header acts as expand toggle when collapsed
        dragging = true; dx = ev.clientX - pos.x; dy = ev.clientY - pos.y;
        video.style.pointerEvents = "none"; // let the drag cross over the iframe
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        ev.preventDefault();
      };
      const onMove = (ev) => { if (!dragging) return; pos = clampPos(ev.clientX - dx, ev.clientY - dy, w, winH()); win.style.left = pos.x + "px"; win.style.top = pos.y + "px"; };
      const onUp = () => { dragging = false; video.style.pointerEvents = ""; savePos(pos); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
      head.addEventListener("mousedown", onDown);
      // Tapping the header while collapsed expands it back.
      head.addEventListener("click", (ev) => { if (collapsedRef.current && !ev.target.closest("button")) { collapsedRef.current = false; apply(); } });

      const toggleCollapse = () => { collapsedRef.current = !collapsedRef.current; apply(); };
      minBtn.addEventListener("click", toggleCollapse);
      $("pit-ytwin-close").addEventListener("click", () => { (handlersRef.current.onClose || (() => { shownRef.current = false; apply(); }))(); });
      $("pit-ytwin-prev").addEventListener("click", () => handlersRef.current.onPrev && handlersRef.current.onPrev());
      $("pit-ytwin-next").addEventListener("click", () => handlersRef.current.onNext && handlersRef.current.onNext());
      $("pit-ytwin-play").addEventListener("click", () => { const p = playerRef.current; if (!p || !p.getPlayerState) return; try { (p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo()); } catch {} });

      const reclamp = () => { pos = clampPos(pos.x, pos.y, w, winH()); win.style.left = pos.x + "px"; win.style.top = pos.y + "px"; };
      window.addEventListener("resize", reclamp);

      let playerInitFailed = false;
      const playerReadyTimeout = setTimeout(() => {
        playerInitFailed = true;
        setError({ kind: "init", message: "YouTube player failed to initialize." });
      }, 12000);
      cleanupDom = () => {
        clearTimeout(playerReadyTimeout);
        window.removeEventListener("resize", reclamp);
        head.removeEventListener("mousedown", onDown);
        onUp();
        try { win.remove(); } catch {}
      };
      const player = new YT.Player("pit-yt-player", {
        width: String(w), height: String(vh),
        playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            clearTimeout(playerReadyTimeout);
            if (playerInitFailed) return;
            setReady(true); setError(null);
          },
          onError: (e) => {
            clearTimeout(playerReadyTimeout);
            if (playerInitFailed) return;
            const kind = e?.data === 101 || e?.data === 150 ? "embed" : "playback";
            setError({ kind, code: e?.data, videoId: videoIdRef.current, message: kind === "embed" ? "This video can't be embedded; playing a preview." : "Video unavailable." });
          },
          onStateChange: (e) => {
            if (playerInitFailed) return;
            if (e.data === 0) { endedCbRef.current && endedCbRef.current(); }
            if (e.data === 1) { setError(null); }
            const pb = $("pit-ytwin-play"); if (pb) pb.innerHTML = e.data === 1 ? SVG.pause : SVG.play;
          },
        },
      });
      playerRef.current = player;
    }).catch(() => {
      cleanupDom();
      setError({ kind: "init", message: "YouTube player failed to load." });
    });

    return () => {
      cancelled = true;
      try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
      cleanupDom();
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
    videoIdRef.current = videoId;
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
  const setVisible = useCallback((visible) => { shownRef.current = !!visible; applyRef.current(); }, []);
  const setMeta = useCallback(({ title } = {}) => { if (title) metaRef.current.title = title; const el = web && document.getElementById("pit-ytwin-title"); if (el && metaRef.current.title) el.textContent = metaRef.current.title; }, []);
  const setControls = useCallback((h) => { handlersRef.current = h || {}; }, []);
  const onEnded = useCallback((cb) => { endedCbRef.current = cb; }, []);

  return { ready, state, error, load, play, pause, toggle, seek, setVolume, setVisible, setMeta, setControls, onEnded };
}
