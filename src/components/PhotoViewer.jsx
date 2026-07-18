import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Modal } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors, mono, radius } from "../theme";
import Icon from "./Icon";
import SmartImage from "./SmartImage";
import { isVideoUrl } from "../lib/img";
import { useStore } from "../store";

const web = Platform.OS === "web";

// A clip inside the viewer: expo-video with the platform's own controls (a
// <video> element on web). Mounted keyed by URL, so moving through the set
// releases the old player and the audio stops with it. No autoplay: browsers
// block un-gestured sound, so the user's tap on the controls starts it.
function ClipStage({ uri }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={styles.img} contentFit="contain" accessibilityLabel="Video clip player" />;
}

// Facebook-style full-screen media viewer: every photo set on the app (review
// photos, fan galleries, venue shots) opens here. Arrows / keyboard to move,
// backdrop or Esc to close, and each photo carries its OWN like - reactions
// key on the photo's durable URL, so a like given from a post follows the same
// photo into the artist's rolling gallery.
export default function PhotoViewer({ photos = [], index = 0, postId = null, onClose }) {
  const { session, mediaReactions, loadMediaReactions, toggleMediaReaction } = useStore();
  const [i, setI] = useState(index);
  const p = photos[i] || photos[0];
  const uri = typeof p === "string" ? p : p?.uri;
  const by = typeof p === "object" && p ? p.by : null;
  const urls = photos.map((x) => (typeof x === "string" ? x : x?.uri)).filter(Boolean);
  const prev = () => setI((x) => (x - 1 + photos.length) % photos.length);
  const next = () => setI((x) => (x + 1) % photos.length);

  // One batch read when the set opens; likes render instantly after.
  useEffect(() => { loadMediaReactions(urls); }, [urls.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: arrows navigate, Escape closes (web).
  useEffect(() => {
    if (!web || typeof window === "undefined") return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowLeft" && photos.length > 1) prev();
      else if (e.key === "ArrowRight" && photos.length > 1) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length, onClose]);

  if (!photos.length) return null;
  const r = (uri && mediaReactions[uri]) || { count: 0, mine: false };
  const video = isVideoUrl(uri);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
    >
    <View style={styles.wrap} accessibilityViewIsModal>
      {/* Backdrop closes, like every photo lightbox people already know. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close photo viewer" />

      <View style={styles.top} pointerEvents="box-none">
        <Text style={styles.count}>{i + 1} / {photos.length}</Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="x" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.stage} pointerEvents="box-none">
        {/* SmartImage = HEIC transcode + proxy-rescue ladder, so an iPhone photo
            renders here instead of a black void. Clips get a real player. */}
        {video ? <ClipStage key={uri} uri={uri} /> : <SmartImage uri={uri} style={styles.img} contain />}
        {photos.length > 1 && (
          <>
            <Pressable style={[styles.arrow, { left: 10 }]} onPress={prev} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous photo">
              <Icon name="chevron-left" size={26} color="#fff" />
            </Pressable>
            <Pressable style={[styles.arrow, { right: 10 }]} onPress={next} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next photo">
              <Icon name="chevron-right" size={26} color="#fff" />
            </Pressable>
          </>
        )}
      </View>

      {/* The photo's own footer: who shot it + its own like. */}
      <View style={styles.footer} pointerEvents="box-none">
        {!!by && <Text style={styles.by}>{video ? "Shared" : "Photo"} by {by}</Text>}
        <Pressable
          style={[styles.likeBtn, r.mine && styles.likeBtnOn, !session && styles.likeBtnDisabled]}
          onPress={() => toggleMediaReaction(uri, postId)}
          disabled={!session}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${r.mine ? "Unlike" : "Like"} this photo, ${r.count} ${r.count === 1 ? "like" : "likes"}`}
        >
          <Icon name="heart" size={18} color={r.mine ? colors.magenta : "#fff"} filled={r.mine} />
          <Text style={[styles.likeTxt, r.mine && { color: colors.magenta }]}>{r.count}</Text>
        </Pressable>
        {photos.length > 1 && (
          <View style={styles.dots}>
            {photos.slice(0, 12).map((_, d) => (
              <View key={d} style={[styles.dot, d === i && styles.dotOn]} />
            ))}
          </View>
        )}
      </View>
    </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(6,7,11,0.98)" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  count: { color: "#fff", fontFamily: mono, fontSize: 13, opacity: 0.85 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  stage: { flex: 1 },
  img: { flex: 1, backgroundColor: "transparent" },
  arrow: { position: "absolute", top: "50%", marginTop: -24, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  footer: { alignItems: "center", gap: 8, paddingBottom: 22, paddingTop: 8 },
  by: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center" },
  likeBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.10)", borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 9 },
  likeBtnOn: { backgroundColor: "rgba(217,70,160,0.16)" },
  likeBtnDisabled: { opacity: 0.55 },
  likeTxt: { color: "#fff", fontFamily: mono, fontSize: 14, fontWeight: "800" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotOn: { backgroundColor: colors.amber, width: 16 },
});
