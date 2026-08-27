const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function sharedYouTubeUrl(song) {
  const videoId = typeof song?.videoId === "string" ? song.videoId.trim() : "";
  return YOUTUBE_VIDEO_ID.test(videoId)
    ? `https://www.youtube.com/watch?v=${videoId}`
    : null;
}
