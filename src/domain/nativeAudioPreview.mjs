const finiteNonNegative = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function nativeAudioSource(src, enabled = true) {
  const uri = typeof src === "string" ? src.trim() : "";
  return enabled && uri ? { uri } : null;
}

export function nativeAudioSnapshot(status) {
  const message = typeof status?.error === "string" ? status.error.trim() : "";
  return {
    pos: finiteNonNegative(status?.currentTime),
    dur: finiteNonNegative(status?.duration),
    playing: status?.playing === true,
    error: message ? { kind: "playback", message } : null,
  };
}

export function nativeAudioCompletion(status, sourceKey, previousKey = null) {
  const key = status?.id && sourceKey ? `${status.id}:${sourceKey}` : null;
  return {
    key,
    notify: !!key && status?.didJustFinish === true && key !== previousKey,
  };
}

export function nativeAudioOperationError(operation, sourceKey) {
  if (!sourceKey || operation?.sourceKey !== sourceKey) return null;
  return operation.error || null;
}

export function clampNativeAudioVolume(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 1;
}
