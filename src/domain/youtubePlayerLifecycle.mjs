export function youtubePlayerCanReceiveCommands({ ready, host, player } = {}) {
  if (!ready || !host?.isConnected || !player) return false;
  try {
    const iframe = player.getIframe?.();
    return !!iframe?.isConnected;
  } catch {
    return false;
  }
}
