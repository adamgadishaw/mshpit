// expo-video's web play() currently discards HTMLMediaElement.play()'s
// Promise. Invoke the DOM method during the original gesture so rejections
// become an inline retry state, never an unhandled client-fatal error.
export function startVideoPlayback({ player, element, web = false } = {}) {
  try {
    if (web) {
      if (typeof element?.play !== "function") throw new Error("Video is not ready to play yet.");
      return Promise.resolve(element.play());
    }
    if (typeof player?.play !== "function") throw new Error("Video player is unavailable.");
    return Promise.resolve(player.play());
  } catch (error) { return Promise.reject(error); }
}
