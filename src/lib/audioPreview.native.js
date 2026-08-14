import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import {
  clampNativeAudioVolume,
  nativeAudioCompletion,
  nativeAudioOperationError,
  nativeAudioSnapshot,
  nativeAudioSource,
} from "../domain/nativeAudioPreview.mjs";

let audioModePromise = null;

function configureNativeAudioMode() {
  if (!audioModePromise) {
    audioModePromise = setAudioModeAsync({
      allowsRecording: false,
      allowsBackgroundRecording: false,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch((error) => {
      audioModePromise = null;
      throw error;
    });
  }
  return audioModePromise;
}

const controlError = (error) => ({
  kind: "playback",
  message: error instanceof Error && error.message ? error.message : "Native audio playback failed.",
});

// Native counterpart to audioPreview.js. Metro selects this file on iOS and
// Android while web keeps the existing HTMLAudioElement implementation.
export function useAudioPreview(src, {
  enabled = true,
  onEnded,
  onStarted,
  startAt = 0,
  volume = 1,
} = {}) {
  const source = nativeAudioSource(src, enabled);
  const sourceKey = source?.uri || null;
  const player = useAudioPlayer(source, { updateInterval: 280 });
  const status = useAudioPlayerStatus(player);
  const [operationError, setOperationError] = useState(null);
  const activeRef = useRef(AppState.currentState == null || AppState.currentState === "active");
  const [forcedPaused, setForcedPaused] = useState(!activeRef.current);
  const onEndedRef = useRef(onEnded);
  const onStartedRef = useRef(onStarted);
  const startedKeyRef = useRef(null);
  const endedKeyRef = useRef(null);
  const startKeyRef = useRef(null);

  onEndedRef.current = onEnded;
  onStartedRef.current = onStarted;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      activeRef.current = state === "active";
      if (!activeRef.current) {
        setForcedPaused(true);
        try { player.pause(); } catch {}
      }
    });
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    try { player.volume = clampNativeAudioVolume(volume); } catch {}
  }, [player, volume]);

  // Reset imperative failures on every track transition, including when the
  // queue advances to an item without a native preview URL.
  useEffect(() => {
    setOperationError(null);
    setForcedPaused(true);
    startKeyRef.current = null;
    startedKeyRef.current = null;
    endedKeyRef.current = null;
  }, [sourceKey]);

  // The SDK hook owns/replaces/releases the native player when source changes.
  // Wait until the source is loaded so an optional resume seek cannot race the
  // decoder, then autoplay only while this app is foreground-active.
  useEffect(() => {
    const startKey = status?.id && sourceKey ? `${status.id}:${sourceKey}` : null;
    if (!startKey || !status?.isLoaded || startKeyRef.current === startKey) return undefined;
    startKeyRef.current = startKey;
    startedKeyRef.current = null;
    endedKeyRef.current = null;
    setOperationError(null);
    let cancelled = false;
    const begin = async () => {
      try {
        await configureNativeAudioMode();
        const resumeAt = Number(startAt);
        if (Number.isFinite(resumeAt) && resumeAt > 0.5) {
          const duration = Number(status.duration);
          const target = Number.isFinite(duration) && duration > 0.3
            ? Math.min(resumeAt, duration - 0.3)
            : resumeAt;
          await player.seekTo(target);
        }
        if (!cancelled && activeRef.current && enabled) {
          setForcedPaused(false);
          player.play();
        }
      } catch (error) {
        if (!cancelled) setOperationError({ sourceKey, error: controlError(error) });
      }
    };
    void begin();
    return () => { cancelled = true; };
  }, [player, status?.id, status?.isLoaded, status?.duration, sourceKey, enabled, startAt]);

  useEffect(() => {
    const key = status?.id && sourceKey ? `${status.id}:${sourceKey}` : null;
    if (!key || !status?.playing || forcedPaused || startedKeyRef.current === key) return;
    startedKeyRef.current = key;
    setOperationError(null);
    onStartedRef.current?.();
  }, [status?.id, status?.playing, sourceKey, forcedPaused]);

  useEffect(() => {
    const completion = nativeAudioCompletion(status, sourceKey, endedKeyRef.current);
    if (!completion.notify) return;
    endedKeyRef.current = completion.key;
    onEndedRef.current?.();
  }, [status?.id, status?.didJustFinish, sourceKey]);

  const toggle = () => {
    try {
      if (status?.playing && !forcedPaused) {
        setForcedPaused(true);
        player.pause();
        return;
      }
      void configureNativeAudioMode()
        .then(() => {
          if (activeRef.current && enabled && sourceKey) {
            setForcedPaused(false);
            player.play();
          }
        })
        .catch((error) => setOperationError({ sourceKey, error: controlError(error) }));
    } catch (error) {
      setOperationError({ sourceKey, error: controlError(error) });
    }
  };
  const pause = () => {
    setForcedPaused(true);
    try { player.pause(); } catch {}
  };
  const seek = (seconds) => {
    const target = Number(seconds);
    if (!Number.isFinite(target)) return;
    const duration = Number(status?.duration) || target;
    void player.seekTo(Math.max(0, Math.min(target, duration)))
      .catch((error) => setOperationError({ sourceKey, error: controlError(error) }));
  };

  const snapshot = nativeAudioSnapshot(status);
  return {
    ...snapshot,
    playing: snapshot.playing && !forcedPaused,
    error: snapshot.error || nativeAudioOperationError(operationError, sourceKey),
    toggle,
    pause,
    seek,
  };
}
