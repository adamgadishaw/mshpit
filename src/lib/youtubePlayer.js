import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// Web-only YouTube IFrame Player adapter. The React player surface owns the host
// element and this hook owns exactly one iframe inside it. It deliberately does
// not append a second window to document.body or render competing controls.
const web = Platform.OS === "web" && typeof window !== "undefined";
const DEFAULT_HOST_ID = "pit-youtube-player-host";
const HOST_WAIT_ATTEMPTS = 20;
const HOST_WAIT_INTERVAL_MS = 100;
const MIN_PLAYER_PX = 200;
const MIN_VISIBLE_RATIO = 0.5;

let apiPromise = null;

function loadApi() {
  if (!web) return Promise.reject(new Error("no-dom"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;
    const previousReady = window.onYouTubeIframeAPIReady;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };

    window.onYouTubeIframeAPIReady = () => {
      try { previousReady?.(); } catch {}
      finish(resolve, window.YT);
    };

    let script = document.querySelector("script[data-pit-youtube-iframe-api]");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.pitYoutubeIframeApi = "true";
      document.head.appendChild(script);
    }
    script.addEventListener("error", () => finish(reject, new Error("yt-api-load-failed")), { once: true });

    timeout = setTimeout(() => finish(reject, new Error("yt-api-load-timeout")), 12_000);
  }).catch((error) => {
    // A later mount may retry after a temporary CDN or network failure.
    apiPromise = null;
    throw error;
  });

  return apiPromise;
}

function resolveHost(options) {
  const supplied = options?.hostRef?.current || options?.hostElement || null;
  if (supplied) return supplied;
  return document.getElementById(options?.hostId || DEFAULT_HOST_ID);
}

function visibleViewportRatio(element) {
  if (!element?.getBoundingClientRect) return 0;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  return (visibleWidth * visibleHeight) / (rect.width * rect.height);
}

function validPlayerSize(element) {
  if (!element?.getBoundingClientRect) return false;
  const rect = element.getBoundingClientRect();
  return rect.width >= MIN_PLAYER_PX && rect.height >= MIN_PLAYER_PX;
}

/**
 * Keep the original hook API intact. A caller may optionally pass a second
 * argument with { hostId, hostRef, or hostElement }. With no second argument,
 * the hook binds to #pit-youtube-player-host.
 */
export function useYouTubePlayer(enabled, options = {}) {
  const playerRef = useRef(null);
  const hostRef = useRef(null);
  const mountRef = useRef(null);
  const videoIdRef = useRef(null);
  const readyRef = useRef(false);
  const shownRef = useRef(false);
  const documentVisibleRef = useRef(!web || document.visibilityState === "visible");
  const intersectionRatioRef = useRef(0);
  const intersectionObserverRef = useRef({ enabled: false, observed: false });
  const pendingLoadRef = useRef(null);
  const pendingPlayRef = useRef(false);
  const endedCbRef = useRef(null);
  const metaRef = useRef({ title: "" });
  const volumeRef = useRef(1);
  const flushRef = useRef(() => {});

  const [ready, setReady] = useState(false);
  const [state, setState] = useState({ position: 0, duration: 0, playing: false });
  const [error, setError] = useState(null);
  const [engineGeneration, setEngineGeneration] = useState(0);
  // How long to wait for the player host to appear before calling it a failure:
  // 20 x 100ms = 2s, comfortably longer than a mount or panel transition, and
  // still short enough that a genuinely missing host does not hang playback.
  const hostWaitRef = useRef(0);

  const hostId = typeof options === "string"
    ? options
    : (options?.hostId || DEFAULT_HOST_ID);
  const mediaKey = typeof options === "object" ? (options?.mediaKey || "") : "";
  const retryMediaRef = useRef(mediaKey);

  // A failed iframe bootstrap should not poison every later track. Reuse the
  // healthy player across songs, but rebuild once when the media identity
  // changes after an initialization failure.
  useEffect(() => {
    const changed = retryMediaRef.current !== mediaKey;
    retryMediaRef.current = mediaKey;
    if (changed && enabled && error?.kind === "init") setEngineGeneration((value) => value + 1);
  }, [mediaKey, enabled, error?.kind]);

  const canPlayNow = useCallback(() => {
    const host = hostRef.current;
    if (!web || !host || !shownRef.current || !documentVisibleRef.current) return false;
    if (!validPlayerSize(host)) return false;
    const observerState = intersectionObserverRef.current;
    const ratio = observerState.enabled
      ? (observerState.observed ? intersectionRatioRef.current : 0)
      : visibleViewportRatio(host);
    return ratio > MIN_VISIBLE_RATIO;
  }, []);

  const pauseImmediately = useCallback(({ cancelPending = true } = {}) => {
    if (cancelPending) {
      pendingPlayRef.current = false;
      if (pendingLoadRef.current) pendingLoadRef.current.autoplay = false;
    }
    try { playerRef.current?.pauseVideo?.(); } catch {}
    setState((current) => (current.playing ? { ...current, playing: false } : current));
  }, []);

  const flushPlaybackIntent = useCallback(() => {
    const player = playerRef.current;
    if (!readyRef.current || !player || !canPlayNow()) return;

    const pending = pendingLoadRef.current;
    if (pending) {
      pendingLoadRef.current = null;
      videoIdRef.current = pending.videoId;
      setError(null);
      const shouldAutoplay = pending.autoplay || pendingPlayRef.current;
      try {
        if (shouldAutoplay) {
          player.loadVideoById({ videoId: pending.videoId, startSeconds: pending.startSec });
        } else if (player.cueVideoById) {
          player.cueVideoById({ videoId: pending.videoId, startSeconds: pending.startSec });
        } else {
          player.loadVideoById({ videoId: pending.videoId, startSeconds: pending.startSec });
          player.pauseVideo?.();
        }
      } catch {
        setError({ kind: "playback", videoId: pending.videoId, message: "Video unavailable." });
      }
      pendingPlayRef.current = false;
      return;
    }

    if (pendingPlayRef.current) {
      pendingPlayRef.current = false;
      try { player.playVideo?.(); } catch {}
    }
  }, [canPlayNow]);

  flushRef.current = flushPlaybackIntent;

  const applyHostVisibility = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const visible = shownRef.current;
    host.style.visibility = visible ? "visible" : "hidden";
    host.style.pointerEvents = visible ? "auto" : "none";
    host.setAttribute("aria-hidden", visible ? "false" : "true");
    if ("inert" in host) host.inert = !visible;
  }, []);

  useEffect(() => {
    if (!web || !enabled) {
      readyRef.current = false;
      setReady(false);
      return;
    }

    readyRef.current = false;
    setReady(false);
    setState((current) => (current.playing ? { ...current, playing: false } : current));
    setError(null);

    let cancelled = false;
    let player = null;
    let observer = null;
    let resizeObserver = null;
    let readyTimeout = null;
    const host = resolveHost(typeof options === "string" ? { hostId: options } : options);

    if (!host) {
      // The host may simply not be in the DOM yet: this effect can run in the
      // same commit that renders it, or while the player panel is still
      // animating in. Failing instantly here is what made a video appear to
      // start and then get dropped for a 30-second preview a moment later —
      // the "flash, then nah" the owner reported. Wait for the host to show up
      // before treating it as a real failure.
      setReady(false);
      if (hostWaitRef.current >= HOST_WAIT_ATTEMPTS) {
        setError({ kind: "init", message: `YouTube player host #${hostId} was not found.` });
        return;
      }
      const attempt = hostWaitRef.current + 1;
      hostWaitRef.current = attempt;
      const retry = setTimeout(() => setEngineGeneration((n) => n + 1), HOST_WAIT_INTERVAL_MS);
      return () => clearTimeout(retry);
    }
    // Found it, so a later remount starts its own patience budget.
    hostWaitRef.current = 0;

    hostRef.current = host;
    intersectionRatioRef.current = visibleViewportRatio(host);
    applyHostVisibility();

    const onVisibilityChange = () => {
      documentVisibleRef.current = document.visibilityState === "visible";
      if (!documentVisibleRef.current) pauseImmediately();
      else flushRef.current();
    };
    const onPageHide = () => {
      documentVisibleRef.current = false;
      pauseImmediately();
    };
    const onPageShow = () => {
      documentVisibleRef.current = document.visibilityState === "visible";
      // Deliberately do not restore a cancelled play intent automatically.
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    if (typeof IntersectionObserver !== "undefined") {
      intersectionObserverRef.current = { enabled: true, observed: false };
      observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        intersectionObserverRef.current.observed = true;
        intersectionRatioRef.current = entry?.intersectionRatio || 0;
        if (entry && entry.intersectionRatio <= MIN_VISIBLE_RATIO) pauseImmediately();
        else flushRef.current();
      }, { threshold: [0, MIN_VISIBLE_RATIO, 1] });
      observer.observe(host);
    }

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        const rect = host.getBoundingClientRect();
        if (player?.setSize && rect.width > 0 && rect.height > 0) {
          try { player.setSize(Math.round(rect.width), Math.round(rect.height)); } catch {}
        }
        if (!validPlayerSize(host)) pauseImmediately();
        else flushRef.current();
      });
      resizeObserver.observe(host);
    }

    loadApi().then((YT) => {
      if (cancelled) return;

      const mount = document.createElement("div");
      mount.dataset.pitYoutubePlayerMount = "true";
      mount.style.width = "100%";
      mount.style.height = "100%";
      host.appendChild(mount);
      mountRef.current = mount;

      const rect = host.getBoundingClientRect();
      const width = Math.max(MIN_PLAYER_PX, Math.round(rect.width || MIN_PLAYER_PX));
      const height = Math.max(MIN_PLAYER_PX, Math.round(rect.height || MIN_PLAYER_PX));
      let initializationFailed = false;

      readyTimeout = setTimeout(() => {
        initializationFailed = true;
        setError({ kind: "init", message: "YouTube player failed to initialize." });
      }, 12_000);

      try {
        player = new YT.Player(mount, {
          width: String(width),
          height: String(height),
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              clearTimeout(readyTimeout);
              if (cancelled || initializationFailed) return;
              playerRef.current = player;
              // Let CSS, not the pixel setSize() dance, own the iframe's size.
              // YouTube writes width/height ATTRIBUTES on the iframe; if they ever
              // lag the host (a resize between mount and this callback, a rounding
              // gap) the frame overflows its overflow:hidden stage and the video
              // looks cropped/zoomed. Pinning the frame to fill the host means it
              // always matches the 16:9 stage and letterboxes internally instead.
              try {
                const frame = player.getIframe?.();
                if (frame) {
                  frame.style.position = "absolute";
                  frame.style.top = "0";
                  frame.style.left = "0";
                  frame.style.width = "100%";
                  frame.style.height = "100%";
                  frame.style.border = "0";
                }
              } catch {}
              readyRef.current = true;
              try { player.setVolume(Math.round(volumeRef.current * 100)); } catch {}
              setReady(true);
              setError(null);
              if (metaRef.current.title) host.setAttribute("aria-label", `YouTube player: ${metaRef.current.title}`);
              flushRef.current();
            },
            onError: (event) => {
              clearTimeout(readyTimeout);
              if (cancelled || initializationFailed) return;
              const code = Number(event?.data) || 0;
              const kind = code === 101 || code === 150 ? "embed" : "playback";
              pendingPlayRef.current = false;
              setError({
                kind,
                code,
                videoId: videoIdRef.current,
                message: kind === "embed" ? "This video cannot be embedded; playing a preview." : "Video unavailable.",
              });
            },
            onStateChange: (event) => {
              if (cancelled || initializationFailed) return;
              if (event.data === 0) endedCbRef.current?.();
              if (event.data === 1) {
                if (!canPlayNow()) {
                  pauseImmediately();
                  return;
                }
                pendingPlayRef.current = false;
                setError(null);
              }
              setState((current) => ({ ...current, playing: event.data === 1 || event.data === 3 }));
            },
          },
        });
        playerRef.current = player;
      } catch {
        clearTimeout(readyTimeout);
        setError({ kind: "init", message: "YouTube player failed to load." });
      }
    }).catch(() => {
      if (!cancelled) setError({ kind: "init", message: "YouTube player failed to load." });
    });

    return () => {
      cancelled = true;
      clearTimeout(readyTimeout);
      observer?.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      try { playerRef.current?.pauseVideo?.(); } catch {}
      try { playerRef.current?.destroy?.(); } catch {}
      try { player?.destroy?.(); } catch {}
      try { mountRef.current?.remove?.(); } catch {}
      playerRef.current = null;
      mountRef.current = null;
      hostRef.current = null;
      readyRef.current = false;
      pendingLoadRef.current = null;
      pendingPlayRef.current = false;
      intersectionObserverRef.current = { enabled: false, observed: false };
    };
    // The host must be stable for the life of the player. Callers that need a
    // different host should change hostId, which intentionally rebuilds it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hostId, engineGeneration]);

  // Position and duration are polled because the iframe state events are discrete.
  useEffect(() => {
    if (!web || !enabled) return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player?.getCurrentTime) return;
      try {
        const playerState = player.getPlayerState?.() ?? -1;
        if ((playerState === 1 || playerState === 3) && !canPlayNow()) {
          pauseImmediately();
          return;
        }
        setState({
          position: (player.getCurrentTime() || 0) * 1000,
          duration: (player.getDuration() || 0) * 1000,
          playing: playerState === 1 || playerState === 3,
        });
      } catch {}
    }, 500);
    return () => clearInterval(timer);
  }, [enabled, canPlayNow, pauseImmediately]);

  const load = useCallback((videoId, { startSec = 0 } = {}) => {
    if (!videoId) return;
    videoIdRef.current = videoId;
    pendingLoadRef.current = {
      videoId,
      startSec: Math.max(0, Number(startSec) || 0),
      autoplay: true,
    };
    pendingPlayRef.current = false;
    setError(null);
    flushRef.current();
  }, []);

  const play = useCallback(() => {
    pendingPlayRef.current = true;
    flushRef.current();
  }, []);

  const pause = useCallback(() => pauseImmediately(), [pauseImmediately]);

  const toggle = useCallback(() => {
    const player = playerRef.current;
    try {
      if (player?.getPlayerState?.() === 1) pauseImmediately();
      else {
        pendingPlayRef.current = true;
        flushRef.current();
      }
    } catch {}
  }, [pauseImmediately]);

  const seek = useCallback((ms) => {
    try { playerRef.current?.seekTo?.(Math.max(0, Number(ms) || 0) / 1000, true); } catch {}
  }, []);

  const setVolume = useCallback((value) => {
    const volume = Math.max(0, Math.min(1, Number(value) || 0));
    volumeRef.current = volume;
    try { playerRef.current?.setVolume?.(Math.round(volume * 100)); } catch {}
  }, []);

  const setVisible = useCallback((visible) => {
    shownRef.current = !!visible;
    if (!shownRef.current) pauseImmediately();
    applyHostVisibility();
    if (shownRef.current) {
      if (!intersectionObserverRef.current.enabled) {
        intersectionRatioRef.current = visibleViewportRatio(hostRef.current);
      }
      requestAnimationFrame(() => flushRef.current());
    }
  }, [applyHostVisibility, pauseImmediately]);

  const setMeta = useCallback(({ title } = {}) => {
    if (title) metaRef.current.title = title;
    const host = hostRef.current;
    if (host && metaRef.current.title) host.setAttribute("aria-label", `YouTube player: ${metaRef.current.title}`);
  }, []);

  // The previous floating window exposed its own transport callbacks. The React
  // player surface now owns those controls, but this no-op preserves the hook API
  // while PlayerBar transitions without creating duplicate buttons.
  const setControls = useCallback(() => {}, []);
  const onEnded = useCallback((callback) => { endedCbRef.current = callback; }, []);

  return {
    ready,
    state,
    error,
    load,
    play,
    pause,
    toggle,
    seek,
    setVolume,
    setVisible,
    setMeta,
    setControls,
    onEnded,
  };
}
