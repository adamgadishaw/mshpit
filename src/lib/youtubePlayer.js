import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { captureAppError } from "./diagnostics";
import { loadYouTubeIframeApi } from "./youtubeIframeApi.mjs";
import {
  createYouTubePlayerLoadLease,
  createYouTubePlayerDisposer,
  youtubePlayerCanReceiveCommands,
  youtubePlayerEventBelongsToLoad,
} from "../domain/youtubePlayerLifecycle.mjs";

// Web-only YouTube IFrame Player adapter. The React player surface owns the host
// element and this hook owns exactly one iframe inside it. It deliberately does
// not append a second window to document.body or render competing controls.
//
// On swallowed errors: the IFrame API throws on ordinary races (calling a method
// on a player that is mid-teardown, resizing an element that just unmounted), so
// most `catch {}` here are correct and stay silent on purpose. The exception is
// anything the PERSON just did — pressing play, toggling, dragging the scrubber.
// If one of those throws we would otherwise show them nothing happening, with no
// trace anywhere, which is exactly the "it just won't play" report that cannot be
// diagnosed after the fact. Those three are recorded; the rest are not, so the
// signal stays readable.
function noteMediaFailure(error, context) {
  // Diagnostics must never be the reason playback breaks.
  try {
    captureAppError(error, { code: "PIT-MEDIA-001", context, source: "youtube-player", toast: false });
  } catch { /* ignore */ }
}
const web = Platform.OS === "web" && typeof window !== "undefined";
const DEFAULT_HOST_ID = "pit-youtube-player-host";
const HOST_WAIT_ATTEMPTS = 20;
const HOST_WAIT_INTERVAL_MS = 100;
const MIN_PLAYER_PX = 200;
const MIN_VISIBLE_RATIO = 0.5;
const LOAD_START_TIMEOUT_MS = 15_000;
// Player progress is decorative UI state, not an audio clock. Updating it once
// a second keeps the scrubber useful without re-rendering the persistent player
// shell twice a second for the entire time a listener has PIT open.
const PROGRESS_UPDATE_INTERVAL_MS = 1_000;

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
  const activeLoadRef = useRef(null);
  const rebuildLoadRef = useRef(null);
  const loadSequenceRef = useRef(0);
  const engineLoadCountRef = useRef(0);
  const loadWatchdogRef = useRef(null);
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
  const lifecycleRef = useRef(0);
  const mediaKeyRef = useRef("");
  const enabledRef = useRef(!!enabled);
  const hostRecoveryRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [state, setState] = useState({ position: 0, duration: 0, playing: false, mediaKey: "", videoId: null });
  const stateRef = useRef(state);
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
  enabledRef.current = !!enabled;
  mediaKeyRef.current = mediaKey;
  stateRef.current = state;

  const canPlayNow = useCallback(() => {
    const host = hostRef.current;
    if (!web || !host || !shownRef.current) return false;
    if (!validPlayerSize(host)) return false;
    // A backgrounded browser tab keeps playing, exactly like youtube.com: the
    // tab is not closed, the player still exists, and its ads still run. We only
    // require the player be genuinely on-screen when the tab IS visible; a hidden
    // tab reports no intersection, so demanding it here would force the pause the
    // owner is removing. The minimize case (shownRef / size) still pauses.
    if (!documentVisibleRef.current) return true;
    const observerState = intersectionObserverRef.current;
    const ratio = observerState.enabled
      ? (observerState.observed ? intersectionRatioRef.current : 0)
      : visibleViewportRatio(host);
    return ratio > MIN_VISIBLE_RATIO;
  }, []);

  const commandPlayer = useCallback(() => {
    const player = playerRef.current;
    return youtubePlayerCanReceiveCommands({ ready: readyRef.current, host: hostRef.current, player })
      ? player
      : null;
  }, []);

  const pauseImmediately = useCallback(({ cancelPending = true } = {}) => {
    if (cancelPending) {
      pendingPlayRef.current = false;
      if (pendingLoadRef.current) pendingLoadRef.current.autoplay = false;
    }
    try { commandPlayer()?.pauseVideo?.(); } catch {}
    setState((current) => (current.playing ? { ...current, playing: false } : current));
  }, [commandPlayer]);

  // Each track/account identity gets a fresh iframe generation. Pause the old
  // lease before paint as well, so a rapid A -> B switch cannot flash, count,
  // or report track A while React is still tearing that generation down.
  useLayoutEffect(() => {
    const active = activeLoadRef.current;
    if (!active || active.mediaKey === mediaKey) return;
    pendingLoadRef.current = null;
    pendingPlayRef.current = false;
    try { commandPlayer()?.pauseVideo?.(); } catch {}
    setState({ position: 0, duration: 0, playing: false, mediaKey, videoId: null });
  }, [mediaKey, commandPlayer]);

  const flushPlaybackIntent = useCallback(() => {
    const player = commandPlayer();
    if (!player || !canPlayNow()) return;

    const pending = pendingLoadRef.current;
    if (pending) {
      pendingLoadRef.current = null;
      setError(null);
      const shouldAutoplay = pending.autoplay || pendingPlayRef.current;
      const activeLoad = createYouTubePlayerLoadLease({
        token: ++loadSequenceRef.current,
        videoId: pending.videoId,
        mediaKey: pending.mediaKey,
        loadNumber: ++engineLoadCountRef.current,
      });
      activeLoadRef.current = activeLoad;
      clearTimeout(loadWatchdogRef.current);
      loadWatchdogRef.current = setTimeout(() => {
        if (activeLoadRef.current !== activeLoad || activeLoad.started) return;
        setError({
          kind: "playback",
          videoId: activeLoad.videoId,
          mediaKey: activeLoad.mediaKey,
          message: "The video did not become ready. Retry the video or use the preview.",
        });
      }, LOAD_START_TIMEOUT_MS);
      setState({
        position: pending.startSec * 1000,
        duration: 0,
        playing: false,
        mediaKey: pending.mediaKey,
        videoId: pending.videoId,
      });
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
        clearTimeout(loadWatchdogRef.current);
        loadWatchdogRef.current = null;
        setError({ kind: "playback", videoId: pending.videoId, mediaKey: pending.mediaKey, message: "Video unavailable." });
      }
      pendingPlayRef.current = false;
      return;
    }

    if (pendingPlayRef.current) {
      pendingPlayRef.current = false;
      try { player.playVideo?.(); } catch (error) { noteMediaFailure(error, "Starting the selected track"); }
    }
  }, [canPlayNow, commandPlayer]);

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

  useLayoutEffect(() => {
    if (!web || !enabled) {
      readyRef.current = false;
      hostWaitRef.current = 0;
      hostRecoveryRef.current = false;
      rebuildLoadRef.current = null;
      setReady(false);
      return;
    }

    const lifecycle = ++lifecycleRef.current;
    let cancelled = false;
    const isCurrent = () => !cancelled && lifecycleRef.current === lifecycle;

    readyRef.current = false;
    hostRecoveryRef.current = false;
    engineLoadCountRef.current = 0;
    setReady(false);
    setState((current) => (current.playing ? { ...current, playing: false } : current));
    setError(null);

    let player = null;
    let mount = null;
    let observer = null;
    let resizeObserver = null;
    let readyTimeout = null;
    const disposePlayer = createYouTubePlayerDisposer();
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
        setError({ kind: "init", mediaKey: mediaKeyRef.current, message: `YouTube player host #${hostId} was not found.` });
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
      // Switching browser tabs no longer pauses: a hidden tab keeps playing like
      // youtube.com. Coming back re-evaluates and resumes any pending intent.
      // (pagehide below still pauses on a real unload/navigation-away.)
      if (documentVisibleRef.current) flushRef.current();
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
        // A backgrounded tab reports ratio 0. That is not the player being
        // scrolled off-screen, so ignore it here — otherwise it would re-create
        // the tab-switch pause we just removed. Real off-screen scrolling only
        // happens while the tab is visible.
        if (!documentVisibleRef.current) return;
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

    loadYouTubeIframeApi().then((YT) => {
      if (!isCurrent()) return;

      // A prior host may have been detached before its cleanup ran. Remove only
      // Pit-owned orphan mounts before claiming this host generation.
      try {
        host.querySelectorAll?.("[data-pit-youtube-player-mount]").forEach((node) => node.remove?.());
      } catch {}
      mount = document.createElement("div");
      mount.dataset.pitYoutubePlayerMount = "true";
      mount.dataset.pitYoutubePlayerGeneration = String(lifecycle);
      mount.style.width = "100%";
      mount.style.height = "100%";
      host.appendChild(mount);
      mountRef.current = mount;

      const rect = host.getBoundingClientRect();
      const width = Math.max(MIN_PLAYER_PX, Math.round(rect.width || MIN_PLAYER_PX));
      const height = Math.max(MIN_PLAYER_PX, Math.round(rect.height || MIN_PLAYER_PX));
      let initializationFailed = false;

      readyTimeout = setTimeout(() => {
        if (!isCurrent()) return;
        initializationFailed = true;
        setError({ kind: "init", mediaKey: mediaKeyRef.current, message: "YouTube player failed to initialize." });
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
              if (!isCurrent() || initializationFailed) return;
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
              hostRecoveryRef.current = false;
              try { player.setVolume(Math.round(volumeRef.current * 100)); } catch {}
              setReady(true);
              setError(null);
              if (metaRef.current.title) host.setAttribute("aria-label", `YouTube player: ${metaRef.current.title}`);
              const rebuild = rebuildLoadRef.current;
              if (rebuild?.mediaKey === mediaKeyRef.current) {
                pendingLoadRef.current = rebuild;
                rebuildLoadRef.current = null;
              }
              flushRef.current();
            },
            onError: (event) => {
              clearTimeout(readyTimeout);
              if (!isCurrent() || initializationFailed) return;
              const activeLoad = activeLoadRef.current;
              if (!youtubePlayerEventBelongsToLoad({ event, player, load: activeLoad })) return;
              // A load is armed by its documented UNSTARTED/CUED boundary. Any
              // earlier callback can be residue from the superseded command.
              if (!activeLoad.armed) return;
              clearTimeout(loadWatchdogRef.current);
              loadWatchdogRef.current = null;
              const code = Number(event?.data) || 0;
              const kind = code === 101 || code === 150 || code === 153 ? "embed" : "playback";
              pendingPlayRef.current = false;
              setError({
                kind,
                code,
                videoId: activeLoad.videoId,
                mediaKey: activeLoad.mediaKey,
                message: kind === "embed" ? "This video cannot be embedded; playing a preview." : "Video unavailable.",
              });
            },
            onStateChange: (event) => {
              if (!isCurrent() || initializationFailed) return;
              const activeLoad = activeLoadRef.current;
              if (!youtubePlayerEventBelongsToLoad({ event, player, load: activeLoad })) return;
              if (event.data === -1 || event.data === 5) {
                activeLoad.armed = true;
                if (event.data === 5) {
                  clearTimeout(loadWatchdogRef.current);
                  loadWatchdogRef.current = null;
                }
                setState((current) => ({ ...current, playing: false, mediaKey: activeLoad.mediaKey }));
                return;
              }
              if (!activeLoad.armed) return;
              if (event.data === 1) {
                if (!canPlayNow()) {
                  pauseImmediately();
                  return;
                }
                activeLoad.started = true;
                clearTimeout(loadWatchdogRef.current);
                loadWatchdogRef.current = null;
                pendingPlayRef.current = false;
                setError(null);
              }
              // ENDED from the superseded video can arrive immediately after a
              // new load command. Only a lease that reached PLAYING may advance,
              // and it may do so once.
              if (event.data === 0 && activeLoad.started && !activeLoad.ended) {
                activeLoad.ended = true;
                endedCbRef.current?.({ mediaKey: activeLoad.mediaKey, videoId: activeLoad.videoId });
              }
              setState((current) => ({
                ...current,
                playing: event.data === 1,
                mediaKey: activeLoad.mediaKey,
              }));
            },
            onAutoplayBlocked: (event) => {
              if (!isCurrent() || initializationFailed) return;
              const activeLoad = activeLoadRef.current;
              if (!youtubePlayerEventBelongsToLoad({ event, player, load: activeLoad })) return;
              if (!activeLoad.armed) return;
              clearTimeout(loadWatchdogRef.current);
              loadWatchdogRef.current = null;
              pendingPlayRef.current = false;
              setState((current) => ({ ...current, playing: false, mediaKey: activeLoad.mediaKey }));
              setError({
                kind: "autoplay",
                videoId: activeLoad.videoId,
                mediaKey: activeLoad.mediaKey,
                message: "Your browser paused autoplay. Press Play to start the video.",
              });
            },
          },
        });
        if (isCurrent()) playerRef.current = player;
      } catch {
        clearTimeout(readyTimeout);
        if (isCurrent()) setError({ kind: "init", mediaKey: mediaKeyRef.current, message: "YouTube player failed to load." });
      }
    }).catch(() => {
      if (isCurrent()) setError({ kind: "init", mediaKey: mediaKeyRef.current, message: "YouTube player failed to load." });
    });

    return () => {
      cancelled = true;
      if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1;
      clearTimeout(readyTimeout);
      clearTimeout(loadWatchdogRef.current);
      loadWatchdogRef.current = null;
      observer?.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      readyRef.current = false;
      const ownedPlayer = player;
      const ownedMount = mount;
      const requestedRebuild = rebuildLoadRef.current;
      const pendingLoad = pendingLoadRef.current;
      const activeLoad = activeLoadRef.current;
      if (enabledRef.current && requestedRebuild?.mediaKey === mediaKeyRef.current) {
        // retry() supplied an explicit autoplay/resume intent; do not replace it
        // with the paused state produced by teardown.
      } else if (enabledRef.current && pendingLoad?.mediaKey === mediaKeyRef.current) {
        rebuildLoadRef.current = { ...pendingLoad };
      } else if (enabledRef.current && activeLoad?.mediaKey === mediaKeyRef.current) {
        let startSec = Math.max(0, Number(stateRef.current.position || 0) / 1000);
        let wasPlaying = !!stateRef.current.playing;
        try { startSec = Math.max(startSec, Number(ownedPlayer?.getCurrentTime?.()) || 0); } catch {}
        try { wasPlaying = ownedPlayer?.getPlayerState?.() === 1; } catch {}
        rebuildLoadRef.current = {
          videoId: activeLoad.videoId,
          mediaKey: activeLoad.mediaKey,
          startSec,
          autoplay: wasPlaying && shownRef.current,
        };
      } else if (!enabledRef.current) {
        rebuildLoadRef.current = null;
        activeLoadRef.current = null;
      } else if (activeLoad?.mediaKey !== mediaKeyRef.current) {
        rebuildLoadRef.current = null;
        activeLoadRef.current = null;
      }
      disposePlayer({ player: ownedPlayer, mount: ownedMount });
      if (playerRef.current === ownedPlayer) playerRef.current = null;
      if (mountRef.current === ownedMount) mountRef.current = null;
      if (hostRef.current === host) hostRef.current = null;
      pendingLoadRef.current = null;
      pendingPlayRef.current = false;
      intersectionObserverRef.current = { enabled: false, observed: false };
    };
    // The host and media identity must be stable for one player generation.
    // Changing either intentionally destroys that generation and builds one
    // whose callbacks cannot be mistaken for the prior track/account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hostId, mediaKey, engineGeneration]);

  // Position and duration are polled because the iframe state events are discrete.
  useEffect(() => {
    if (!web || !enabled) return;
    const timer = setInterval(() => {
      const player = commandPlayer();
      if (!player?.getCurrentTime) {
        if (readyRef.current && !hostRecoveryRef.current) {
          // React can replace a host node without changing its id (responsive
          // shell swaps, Fast Refresh, or error recovery). Rebuild once instead
          // of leaving a ready-but-orphaned player that ignores every command.
          hostRecoveryRef.current = true;
          readyRef.current = false;
          setReady(false);
          setEngineGeneration((generation) => generation + 1);
        }
        return;
      }
      // setVisible(false) pauses minimized/obscured players synchronously. Do
      // not keep waking React to publish an unchanged clock while the persistent
      // iframe is intentionally retained for a quick restore.
      if (!shownRef.current) return;
      try {
        const playerState = player.getPlayerState?.() ?? -1;
        if ((playerState === 1 || playerState === 3) && !canPlayNow()) {
          pauseImmediately();
          return;
        }
        const activeLoad = activeLoadRef.current;
        if (!activeLoad) return;
        const next = {
          position: Math.round((player.getCurrentTime() || 0) * 10) * 100,
          duration: Math.round((player.getDuration() || 0) * 1000),
          playing: playerState === 1,
          mediaKey: activeLoad.mediaKey,
          videoId: activeLoad.videoId,
        };
        setState((current) => (
          current.position === next.position
          && current.duration === next.duration
          && current.playing === next.playing
          && current.mediaKey === next.mediaKey
          && current.videoId === next.videoId
            ? current
            : next
        ));
      } catch { /* progress polling is best-effort; recording it would bury the real signal */ }
    }, PROGRESS_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, canPlayNow, commandPlayer, pauseImmediately]);

  const load = useCallback((videoId, { startSec = 0 } = {}) => {
    if (!videoId) return;
    pendingLoadRef.current = {
      videoId,
      mediaKey: mediaKeyRef.current,
      startSec: Math.max(0, Number(startSec) || 0),
      autoplay: true,
    };
    pendingPlayRef.current = false;
    setError(null);
    flushRef.current();
  }, []);

  const play = useCallback(() => {
    pendingPlayRef.current = true;
    setError((current) => (current?.kind === "autoplay" ? null : current));
    flushRef.current();
  }, []);

  const pause = useCallback(() => pauseImmediately(), [pauseImmediately]);

  const toggle = useCallback(() => {
    const player = commandPlayer();
    try {
      if (player?.getPlayerState?.() === 1) pauseImmediately();
      else {
        pendingPlayRef.current = true;
        flushRef.current();
      }
    } catch (error) { noteMediaFailure(error, "Play/pause from the player controls"); }
  }, [commandPlayer, pauseImmediately]);

  const seek = useCallback((ms) => {
    try { commandPlayer()?.seekTo?.(Math.max(0, Number(ms) || 0) / 1000, true); } catch (error) { noteMediaFailure(error, "Seeking within the track"); }
  }, [commandPlayer]);

  const setVolume = useCallback((value) => {
    const volume = Math.max(0, Math.min(1, Number(value) || 0));
    volumeRef.current = volume;
    try { commandPlayer()?.setVolume?.(Math.round(volume * 100)); } catch {}
  }, [commandPlayer]);

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
  const retry = useCallback((options = {}) => {
    if (!enabledRef.current) return;
    const activeLoad = activeLoadRef.current;
    const videoId = options.videoId || activeLoad?.videoId || null;
    if (videoId) {
      rebuildLoadRef.current = {
        videoId,
        mediaKey: mediaKeyRef.current,
        startSec: Math.max(0, Number(options.startSec ?? (stateRef.current.position / 1000)) || 0),
        autoplay: options.autoplay !== false,
      };
    }
    hostWaitRef.current = 0;
    hostRecoveryRef.current = false;
    readyRef.current = false;
    setReady(false);
    setError(null);
    setEngineGeneration((generation) => generation + 1);
  }, []);

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
    retry,
  };
}
