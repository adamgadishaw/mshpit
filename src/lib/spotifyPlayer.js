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
  const [error, setError] = useState(null); // { kind: 'premium'|'auth'|'init'|'playback', message }

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
      player.addListener("ready", ({ device_id }) => { deviceRef.current = device_id; setReady(true); setError(null); });
      player.addListener("not_ready", () => setReady(false));
      // The SDK stays silent about WHY it will not play unless we listen. account_error
      // is the big one: it means the linked Spotify is not Premium.
      player.addListener("initialization_error", ({ message }) => { console.warn("[spotify] init_error", message); setError({ kind: "init", message: "This browser can't run the Spotify player." }); });
      player.addListener("authentication_error", ({ message }) => { console.warn("[spotify] auth_error", message); setError({ kind: "auth", message: "Spotify session expired. Reconnect in Settings." }); });
      player.addListener("account_error", ({ message }) => { console.warn("[spotify] account_error", message); setError({ kind: "premium", message: "Spotify Premium is needed for full songs. Preview plays instead." }); });
      player.addListener("playback_error", ({ message }) => { console.warn("[spotify] playback_error", message); });
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
    }).catch(() => setError({ kind: "init", message: "Spotify player failed to load." }));
    return () => {
      cancelled = true;
      try { player && player.disconnect(); } catch {}
      playerRef.current = null; deviceRef.current = null; setReady(false); setState(null);
    };
  }, [enabled]);

  // Start a list of track URIs on our device (transfers playback here). Retries
  // once if the device is briefly not found (it re-registers when switching), and
  // reports a clear reason on 403 (usually not Premium) so switching artists never
  // dies silently.
  const playUris = useCallback(async (uris, offset = 0) => {
    const dev = deviceRef.current;
    if (!dev || !uris || !uris.length) return;
    const doPlay = async () => {
      const { token } = await api("/api/spotify/token");
      return fetch(`https://api.spotify.com/v1/me/player/play?device_id=${dev}`, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ uris, offset: { position: Math.max(0, offset) } }),
      });
    };
    try {
      let res = await doPlay();
      if (res.status === 404) { await new Promise((r) => setTimeout(r, 500)); res = await doPlay(); }
      if (!res.ok && res.status !== 202 && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        console.warn("[spotify] play failed", res.status, body?.error?.message);
        if (res.status === 403) setError({ kind: "premium", message: "Spotify Premium is needed for full songs. Preview plays instead." });
      }
    } catch (e) { console.warn("[spotify] play error", e.message); }
  }, []);

  const toggle = useCallback(() => { playerRef.current && playerRef.current.togglePlay(); }, []);
  const next = useCallback(() => { playerRef.current && playerRef.current.nextTrack(); }, []);
  const prev = useCallback(() => { playerRef.current && playerRef.current.previousTrack(); }, []);

  return { ready, state, error, playUris, toggle, next, prev };
}
