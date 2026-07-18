import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, useWindowDimensions } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors, mono, radius, shadow } from "../theme";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import { useStore } from "../store";

const web = Platform.OS === "web";

// One clip page: a horizontal (16:9-ish) concert video that fills the width,
// centered vertically, with its own play/pause + mute. Only the ACTIVE page
// mounts a real player (mounting every video at once would hammer the network
// and the decoder), so `active` gates the heavy VideoView.
function ClipPage({ post, uri, height, active, muted, onToggleMute, onLike, onOpenPost, onOpenProfile, onOpenArtist }) {
  const player = useVideoPlayer(active ? uri : null, (p) => {
    if (!p) return;
    p.loop = true;
    p.muted = muted;
  });
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!player) return;
    try { player.muted = muted; } catch {}
  }, [muted, player]);

  useEffect(() => {
    if (!player) return;
    try {
      if (active && !paused) player.play();
      else player.pause();
    } catch {}
  }, [active, paused, player]);

  const tapToggle = () => {
    setPaused((v) => {
      const next = !v;
      try { next ? player?.pause() : player?.play(); } catch {}
      return next;
    });
  };

  const author = post.user || {};
  return (
    <View style={[styles.page, { height }]}>
      {active ? (
        <Pressable style={styles.stage} onPress={tapToggle} accessibilityRole="button" accessibilityLabel={paused ? "Play clip" : "Pause clip"}>
          <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} accessibilityLabel={`Clip from ${post.artist}`} />
          {paused && (
            <View style={styles.pausedGlyph} pointerEvents="none">
              <Icon name="play" size={30} color="#fff" />
            </View>
          )}
        </Pressable>
      ) : (
        <View style={[styles.stage, styles.stageIdle]}><Icon name="play" size={26} color={colors.textFaint} /></View>
      )}

      {/* Left: who + what. Right: the action rail (like / comment / mute). */}
      <View style={styles.overlayBottom} pointerEvents="box-none">
        <View style={styles.metaCol} pointerEvents="box-none">
          <Pressable style={styles.authorRow} onPress={() => post.userId && onOpenProfile?.(post.userId)}>
            <Avatar user={author} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={styles.authorName} numberOfLines={1}>{author.name || "A fan"}</Text>
              <Text style={styles.authorHandle} numberOfLines={1}>@{author.handle}</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => onOpenArtist?.(post.artist)}>
            <Text style={styles.clipArtist} numberOfLines={1}>
              <Icon name="music" size={12} color={colors.amber} /> {post.artist}
            </Text>
          </Pressable>
          {!!post.review && <Text style={styles.clipReview} numberOfLines={2}>{post.review}</Text>}
          <Text style={styles.clipVenue} numberOfLines={1}>{[post.venue, post.city].filter(Boolean).join(" · ")}</Text>
        </View>

        <View style={styles.rail}>
          <RailBtn icon="heart" filled={post.liked} tint={post.liked ? colors.magenta : "#fff"} label={String(post.likes ?? 0)} onPress={onLike} a11y={`${post.liked ? "Unlike" : "Like"}, ${post.likes ?? 0} likes`} />
          <RailBtn icon="comment" tint="#fff" label={String(post.comments ?? 0)} onPress={() => onOpenPost?.(post)} a11y={`Comments, ${post.comments ?? 0}`} />
          <RailBtn icon={muted ? "volume-x" : "volume"} tint={muted ? colors.textDim : "#fff"} onPress={onToggleMute} a11y={muted ? "Unmute clips" : "Mute clips"} />
        </View>
      </View>
    </View>
  );
}

function RailBtn({ icon, filled, tint, label, onPress, a11y }) {
  return (
    <Pressable style={styles.railBtn} onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={a11y}>
      <View style={styles.railIcon}><Icon name={icon} size={24} color={tint} filled={filled} /></View>
      {label != null && <Text style={styles.railLabel}>{label}</Text>}
    </Pressable>
  );
}

// Clips mode: a full-screen vertical swipe-through of the concert videos people
// have posted (traditional horizontal video, not vertical). Its own volume +
// swipe-to-skip; music and clips can play at once, so opening this pauses the
// app's music player (App handles that via onEnter/onExit) rather than fighting
// it for audio. One clip per post (its first video); the rest live on the post.
export default function ClipsScreen({ onClose, onOpenPost, onOpenProfile, onOpenArtist, onRequireAuth }) {
  const { session, loadClips, toggleLike } = useStore();
  const { height: winH } = useWindowDimensions();
  const [pages, setPages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(false);
  const scrollRef = useRef(null);
  const loadingMoreRef = useRef(false);

  // The reel owns the viewport height minus the slim top bar.
  const pageH = Math.max(320, winH - 52);

  const flatten = (clipPosts) => clipPosts.flatMap((p) => (p.clips || []).slice(0, 1).map((uri) => ({ post: p, uri })));

  useEffect(() => {
    let ok = true;
    (async () => {
      const { clips, nextCursor } = await loadClips();
      if (!ok) return;
      setPages(flatten(clips));
      setCursor(nextCursor);
      setDone(!nextCursor);
      setLoading(false);
    })();
    return () => { ok = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    if (loadingMoreRef.current || done || !cursor) return;
    loadingMoreRef.current = true;
    const { clips, nextCursor } = await loadClips({ before: cursor });
    setPages((prev) => [...prev, ...flatten(clips)]);
    setCursor(nextCursor);
    setDone(!nextCursor);
    loadingMoreRef.current = false;
  };

  // Snap paging: each page is exactly pageH tall; the active index is whichever
  // page is centered. Prefetch the next batch as the user nears the end.
  const onScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / pageH);
    if (idx !== active) setActive(idx);
    if (idx >= pages.length - 2) loadMore();
  };

  const likeClip = (post) => {
    if (!session) return onRequireAuth?.();
    toggleLike(post.id, post.likes || 0);
    // Optimistic flip on the page's own rail (the store is the source of truth;
    // this just mirrors it instantly on the overlay).
    setPages((prev) => prev.map((pg) => {
      if (pg.post.id !== post.id) return pg;
      const liked = !pg.post.liked;
      return { ...pg, post: { ...pg.post, liked, likes: Math.max(0, (pg.post.likes || 0) + (liked ? 1 : -1)) } };
    }));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.topBar}>
        <Pressable style={styles.topBtn} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to feed">
          <Icon name="chevron-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topTitle}>CLIPS</Text>
        <View style={styles.topBtn} />
      </View>

      {loading ? (
        <View style={styles.center}><Text style={styles.emptyTxt}>Loading clips…</Text></View>
      ) : pages.length === 0 ? (
        <View style={styles.center}>
          <Icon name="play" size={30} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>No clips yet</Text>
          <Text style={styles.emptyTxt}>Post a video on a review and it shows up here. Swipe through concert clips from everyone.</Text>
        </View>
      ) : (
        <WebReel
          reelRef={scrollRef}
          pages={pages}
          pageH={pageH}
          active={active}
          muted={muted}
          onScroll={onScroll}
          onToggleMute={() => setMuted((m) => !m)}
          onLike={likeClip}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
          onOpenArtist={onOpenArtist}
        />
      )}
    </View>
  );
}

// Web reel: a native scroll container with scroll-snap so each swipe/scroll
// lands on one clip. (Native paging would use a ScrollView with pagingEnabled;
// this app is web-first, and expo-video's web player is a real <video>.)
function WebReel({ reelRef, pages, pageH, active, muted, onScroll, onToggleMute, onLike, onOpenPost, onOpenProfile, onOpenArtist }) {
  const localRef = useRef(null);
  const ref = reelRef || localRef;
  useEffect(() => {
    if (!web) return;
    const el = ref.current;
    if (!el || !el.addEventListener) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScroll]);
  return (
    <View
      ref={ref}
      style={styles.reelInner}
      // scroll-snap keeps every swipe on one clip.
      {...(web ? { dataSet: { pitReel: "1" } } : {})}
    >
      {pages.map((pg, i) => (
        <View key={`${pg.post.id}:${i}`} style={web ? { scrollSnapAlign: "start" } : null}>
          <ClipPage
            post={pg.post}
            uri={pg.uri}
            height={pageH}
            active={i === active}
            muted={muted}
            onToggleMute={onToggleMute}
            onLike={() => onLike(pg.post)}
            onOpenPost={onOpenPost}
            onOpenProfile={onOpenProfile}
            onOpenArtist={onOpenArtist}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#04050a" },
  topBar: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  topBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { color: "#fff", fontFamily: mono, fontSize: 13, fontWeight: "800", letterSpacing: 3 },

  reelWeb: { overflowY: "scroll", scrollSnapType: "y mandatory" },
  reelInner: { flex: 1, ...(web ? { overflowY: "scroll", scrollSnapType: "y mandatory", height: "100%" } : null) },

  page: { width: "100%", justifyContent: "center", backgroundColor: "#04050a", position: "relative" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  stageIdle: { backgroundColor: "#07080e" },
  video: { width: "100%", height: "100%", backgroundColor: "#000" },
  pausedGlyph: { position: "absolute", width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },

  overlayBottom: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", padding: 16, gap: 12 },
  metaCol: { flex: 1, gap: 6 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  authorName: { color: "#fff", fontSize: 14, fontWeight: "800" },
  authorHandle: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  clipArtist: { color: colors.amber, fontSize: 13, fontWeight: "800" },
  clipReview: { color: "#fff", fontSize: 13, lineHeight: 18, opacity: 0.94 },
  clipVenue: { color: "rgba(255,255,255,0.66)", fontFamily: mono, fontSize: 11 },

  rail: { alignItems: "center", gap: 18, paddingBottom: 4 },
  railBtn: { alignItems: "center", gap: 4 },
  railIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  railLabel: { color: "#fff", fontFamily: mono, fontSize: 11, fontWeight: "800" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptyTxt: { color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 19, textAlign: "center" },
});
