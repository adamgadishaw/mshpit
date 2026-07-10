import { useEffect, useRef, useState, useCallback } from "react";
import { Platform } from "react-native";
import { api } from "./api";

// Spotify Web Playback SDK wrapper. Streams FULL tracks (Premium accounts only,
// per Spotify) through a player that lives in the page, so our top bar can drive
// real play / pause / next / prev instead of the 30s embed. getOAuthToken pulls a
// fresh token from our server, which holds the refresh token.
const web = Platform.OS === "web" && typeof window !== "undefined";

let sdkPromise = null;
function loadSdk() {
  if (!web) return Promise.reject(new Error("no-dom"));
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify);
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.async = true;
    s.onerror = () => reject(new Error("sdk-load-failed"));
    document.body.appendChild(s);
  });
  return sdkPromise;
}

export function useSpotifyPlayer(enabled) {
  const playerRef = useRef(null);
  const deviceRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState(null); // { paused, position, duration, track }

  useEffect(() => {
    if (!web || !enabled) return;
    let cancelled = false;
    let player;
    loadSdk().then((Spotify) => {
      if (cancelled) return;
      player = new Spotify.Player({
        name: "Pit",
        volume: 0.8,
        getOAuthToken: (cb) => { api("/api/spotify/token").then((d) => cb(d.token)).catch(() => {}); },
      });
      playerRef.current = player;
      player.addListener("ready", ({ device_id }) => { deviceRef.current = device_id; setReady(true); });
      player.addListener("not_ready", () => setReady(false));
      player.addListener("player_state_changed", (s) => {
        if (!s) return;
        const t = s.track_window && s.track_window.current_track;
        setState({
          paused: s.paused,
          position: s.position,
          duration: s.duration,
          track: t ? { name: t.name, artist: (t.artists || []).map((a) => a.name).join(", "), art: t.album && t.album.images && t.album.images[0] && t.album.images[0].url, uri: t.uri } : null,
        });
      });
      player.connect();
    }).catch(() => {});
    return () => {
      cancelled = true;
      try { player && player.disconnect(); } catch {}
      playerRef.current = null; deviceRef.current = null; setReady(false); setState(null);
    };
  }, [enabled]);

  // Start a list of track URIs on our device (transfers playback here).
  const playUris = useCallback(async (uris, offset = 0) => {
    const dev = deviceRef.current;
    if (!dev || !uris || !uris.length) return;
    try {
      const { token } = await api("/api/spotify/token");
      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${dev}`, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ uris, offset: { position: Math.max(0, offset) } }),
      });
    } catch {}
  }, []);

  const toggle = useCallback(() => { playerRef.current && playerRef.current.togglePlay(); }, []);
  const next = useCallback(() => { playerRef.current && playerRef.current.nextTrack(); }, []);
  const prev = useCallback(() => { playerRef.current && playerRef.current.previousTrack(); }, []);

  return { ready, state, playUris, toggle, next, prev };
}
