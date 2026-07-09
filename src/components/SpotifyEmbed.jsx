import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Linking, Platform } from "react-native";
import { colors, radius } from "../theme";
import Icon from "./Icon";

// Real in-app playback — Spotify's official embed iframe (plays a preview for
// everyone, full tracks for logged-in Spotify users) WITHOUT sending anyone off
// the app. Web mounts the iframe into the View's DOM node; native (no webview
// dependency) shows a tap-to-open fallback.
const web = Platform.OS === "web" && typeof window !== "undefined";

// Pull a Spotify id out of an open.spotify.com/{kind}/{id} url (or accept a raw id).
export function spotifyId(urlOrId, kind = "track") {
  if (!urlOrId) return null;
  const m = String(urlOrId).match(new RegExp(`${kind}/([a-zA-Z0-9]+)`));
  return m ? m[1] : /^[a-zA-Z0-9]{16,}$/.test(urlOrId) ? urlOrId : null;
}

export default function SpotifyEmbed({ kind = "track", id, url, height = 152, fallbackLabel = "Open in Spotify" }) {
  const ref = useRef(null);
  const sid = id || spotifyId(url, kind);

  useEffect(() => {
    if (!web || !ref.current) return;
    if (sid) {
      ref.current.innerHTML =
        `<iframe style="border-radius:12px;display:block" ` +
        `src="https://open.spotify.com/embed/${kind}/${sid}?utm_source=mshpit&theme=0" ` +
        `width="100%" height="${height}" frameBorder="0" loading="lazy" ` +
        `allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
    }
    const node = ref.current;
    return () => { if (node) node.innerHTML = ""; };
  }, [kind, sid, height]);

  if (!sid) return null;

  if (!web) {
    return (
      <Pressable style={[styles.fallback, { height }]} onPress={() => Linking.openURL(url || `https://open.spotify.com/${kind}/${sid}`)}>
        <Icon name="play" size={18} color={colors.amber} />
        <Text style={styles.fallbackTxt}>{fallbackLabel}</Text>
      </Pressable>
    );
  }
  return <View ref={ref} style={[styles.embed, { height }]} />;
}

const styles = StyleSheet.create({
  embed: { width: "100%", borderRadius: 12, overflow: "hidden", backgroundColor: colors.surfaceAlt },
  fallback: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  fallbackTxt: { color: colors.text, fontSize: 14, fontWeight: "700" },
});
