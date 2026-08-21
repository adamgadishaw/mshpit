import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, FlatList, useWindowDimensions } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors, mono, radius, shadow } from "../theme";
import { analyticsDurationBucket } from "../domain/analyticsPolicy.mjs";
import { shouldWarmClipPoster } from "../domain/clipPoster.mjs";
import { clipKeyboardTarget, clipPageIndex, clipPageNeedsMore, clipRenderWindow } from "../domain/clipPaging.mjs";
import { mediaDescriptorForUri, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import { pendingVideoMilestones } from "../domain/mediaAnalytics.mjs";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import ClipPoster from "../components/ClipPoster";
import { useStore } from "../store";

const web = Platform.OS === "web";

// One clip page: a horizontal (16:9-ish) concert video that fills the width,
// centered vertically, with its own play/pause + mute. Only the ACTIVE page
// mounts a real player (mounting every video at once would hammer the network
// and the decoder), so `active` gates the heavy VideoView.
function ClipPage({ post, uri, posterUri, altText, height, active, posterEnabled, muted, onToggleMute, onLike, onOpenPost, onOpenProfile, onOpenArtist, onTrack }) {
  const [attempt, setAttempt] = useState(0);
  const source = active
    ? { uri, useCaching: !web, metadata: { title: `PIT clip ${post?.id || "video"} ${attempt}` } }
    : null;
  const player = useVideoPlayer(source, (p) => {
    if (!p) return;
    p.loop = true;
    p.muted = muted;
  });
  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
    error: null,
  });
  const [paused, setPaused] = useState(false);
  const [firstFrameSession, setFirstFrameSession] = useState(null);
  const activationRef = useRef({ active: false, count: 0 });
  if (active && !activationRef.current.active) activationRef.current.count += 1;
  activationRef.current.active = active;
  const playbackSession = `${uri}:${attempt}:${activationRef.current.count}`;
  const hasFirstFrame = active && firstFrameSession === playbackSession;
  const mountedAtRef = useRef(Date.now());
  const trackedFirstFrameRef = useRef(false);
  const trackedErrorRef = useRef(false);
  const trackRef = useRef(onTrack);
  trackRef.current = onTrack;
  const phase = error || status === "error" ? "error" : hasFirstFrame ? "ready" : "loading";

  useEffect(() => {
    if (!active) return;
    setPaused(false);
    mountedAtRef.current = Date.now();
    trackedFirstFrameRef.current = false;
    trackedErrorRef.current = false;
  }, [active, attempt, uri]);

  useEffect(() => {
    if (!player) return;
    try { player.muted = muted; } catch {}
  }, [muted, player]);

  // Record actual playback, not merely that the reel rendered. Milestones are
  // emitted once per active viewing session and carry only the internal post id.
  useEffect(() => {
    if (!active || !player || !post?.id) return;
    const milestones = new Set();
    let started = false;
    try { player.timeUpdateEventInterval = 1; } catch {}
    const recordStart = (isPlaying) => {
      if (!isPlaying || started) return;
      started = true;
      trackRef.current?.("video_start", { postId: post.id, surface: "clips", muted: !!player.muted });
    };
    const recordMilestone = (milestone) => {
      if (milestones.has(milestone)) return;
      milestones.add(milestone);
      trackRef.current?.("video_progress", { postId: post.id, surface: "clips", milestone });
    };
    const playingSubscription = player.addListener?.("playingChange", ({ isPlaying }) => recordStart(isPlaying));
    const timeSubscription = player.addListener?.("timeUpdate", ({ currentTime }) => {
      for (const milestone of pendingVideoMilestones({ currentTime, duration: player.duration, seen: milestones })) recordMilestone(milestone);
    });
    const endSubscription = player.addListener?.("playToEnd", () => {
      for (const milestone of pendingVideoMilestones({ seen: milestones, ended: true })) recordMilestone(milestone);
    });
    recordStart(player.playing);
    return () => {
      playingSubscription?.remove?.();
      timeSubscription?.remove?.();
      endSubscription?.remove?.();
    };
  }, [active, player, post?.id]);

  useEffect(() => {
    if (!player) return;
    try {
      if (active && !paused) player.play();
      else player.pause();
    } catch {}
  }, [active, paused, player]);

  useEffect(() => {
    if (!active || phase !== "error" || trackedErrorRef.current) return;
    trackedErrorRef.current = true;
    trackRef.current?.("product_error", { code: "video_load_failed", surface: "clips", retryable: true });
  }, [active, phase]);

  const recordFirstFrame = () => {
    setFirstFrameSession(playbackSession);
    setPaused(!player.playing);
    if (trackedFirstFrameRef.current) return;
    trackedFirstFrameRef.current = true;
    trackRef.current?.("performance", {
      metric: "video_first_frame",
      durationBucket: analyticsDurationBucket(Date.now() - mountedAtRef.current),
      surface: "clips",
      outcome: "ok",
    });
  };

  const retry = () => {
    setPaused(false);
    setAttempt((value) => value + 1);
  };

  const tapToggle = () => {
    setPaused((v) => {
      const next = !v;
      try { next ? player?.pause() : player?.play(); } catch {}
      return next;
    });
  };

  const author = post.user || {};
  const clipDescription = altText || `Concert clip from ${post.artist || "a PIT artist"}`;
  return (
    <View style={[styles.page, { height }]}>
      <View style={[styles.pageFrame, web && styles.pageFrameWeb]}>
      {active ? (
        <Pressable
          style={styles.stage}
          onPress={tapToggle}
          accessibilityRole="button"
          accessibilityLabel={`${paused ? "Play" : "Pause"} clip. ${clipDescription}`}
        >
          <VideoView
            key={playbackSession}
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
            playsInline
            useExoShutter={false}
            onFirstFrameRender={recordFirstFrame}
            accessible={false}
          />
          {phase !== "ready" ? (
            <ClipPoster uri={uri} posterUri={posterUri} style={StyleSheet.absoluteFill} enabled={posterEnabled} viewable={active} contain showPlayBadge={false} accessibilityLabel={clipDescription} accessible={false} />
          ) : null}
          {phase === "error" ? (
            <View style={styles.playbackError} accessibilityLiveRegion="assertive">
              <Icon name="shield" size={24} color={colors.amber} />
              <Text style={styles.playbackErrorTitle}>This clip could not play</Text>
              <Text style={styles.playbackErrorCopy}>Its format may not be supported, or the connection was interrupted.</Text>
              <Pressable style={styles.retryBtn} onPress={retry} accessibilityRole="button" accessibilityLabel="Try loading this clip again">
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {paused && phase === "ready" && (
            <View style={styles.pausedGlyph} pointerEvents="none">
              <Icon name="play" size={30} color="#fff" />
            </View>
          )}
        </Pressable>
      ) : (
        <View style={[styles.stage, styles.stageIdle]}>
          <ClipPoster uri={uri} posterUri={posterUri} style={StyleSheet.absoluteFill} enabled={posterEnabled} contain accessibilityLabel={clipDescription} />
        </View>
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
  const { session, loadClips, toggleLike, track } = useStore();
  const { height: winH } = useWindowDimensions();
  const [pages, setPages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [reelHeight, setReelHeight] = useState(0);
  const [active, setActive] = useState(0);
  // Audible autoplay is blocked by desktop browsers. Begin muted there so the
  // first clip actually starts; the visible volume control restores sound with
  // a user gesture. Native retains the existing sound-on entry behaviour.
  const [muted, setMuted] = useState(web);
  const scrollRef = useRef(null);
  const loadingMoreRef = useRef(false);

  // The reel owns the viewport height minus the slim top bar.
  const pageH = Math.max(240, reelHeight || winH - 52);

  const flatten = (clipPosts) => clipPosts.flatMap((p) => (p.clips || []).slice(0, 1).map((uri) => {
    const descriptor = mediaDescriptorForUri(p, uri);
    return {
      post: p,
      uri,
      posterUri: mediaPosterUri(descriptor),
      altText: descriptor?.altText || "",
    };
  }));

  useEffect(() => {
    let ok = true;
    setLoading(true);
    setLoadError("");
    (async () => {
      const result = await loadClips();
      if (!ok) return;
      if (!result?.ok) {
        setPages([]);
        setLoadError("PIT could not load clips. Check your connection and try again.");
        setLoading(false);
        return;
      }
      setPages(flatten(result.clips));
      setCursor(result.nextCursor);
      setDone(!result.nextCursor);
      setLoading(false);
    })();
    return () => { ok = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const loadMore = async () => {
    if (loadingMoreRef.current || done || !cursor) return;
    loadingMoreRef.current = true;
    setLoadError("");
    try {
      const result = await loadClips({ before: cursor });
      if (!result?.ok) {
        setLoadError("More clips missed the beat. Tap to retry.");
        return;
      }
      setPages((prev) => {
        const known = new Set(prev.map((page) => `${page.post.id}:${page.uri}`));
        return [...prev, ...flatten(result.clips).filter((page) => !known.has(`${page.post.id}:${page.uri}`))];
      });
      setCursor(result.nextCursor);
      setDone(!result.nextCursor);
    } finally {
      loadingMoreRef.current = false;
    }
  };

  // Snap paging: each page is exactly pageH tall; the active index is whichever
  // page is centered. Prefetch the next batch as the user nears the end.
  const onOffset = (y) => {
    const idx = clipPageIndex(y, pageH, pages.length);
    if (idx !== active) setActive(idx);
    if (clipPageNeedsMore(idx, pages.length)) loadMore();
  };
  const onScroll = (event) => onOffset(event?.nativeEvent?.contentOffset?.y || 0);

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

      <View
        style={styles.reelHost}
        onLayout={(event) => {
          const next = Math.max(0, Math.round(event.nativeEvent.layout.height));
          if (next && next !== reelHeight) setReelHeight(next);
        }}
      >
      {loading ? (
        <View style={styles.center}><Text style={styles.emptyTxt}>Loading clips…</Text></View>
      ) : loadError && pages.length === 0 ? (
        <View style={styles.center}>
          <Icon name="flag" size={28} color={colors.danger} />
          <Text style={styles.emptyTitle}>Clips could not load</Text>
          <Text style={styles.emptyTxt}>{loadError}</Text>
          <Pressable style={styles.retryBtn} onPress={() => setReloadKey((value) => value + 1)} accessibilityRole="button" accessibilityLabel="Retry loading clips">
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : pages.length === 0 ? (
        <View style={styles.center}>
          <Icon name="play" size={30} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>No clips yet</Text>
          <Text style={styles.emptyTxt}>Post a video on a review and it shows up here. Swipe through concert clips from everyone.</Text>
        </View>
      ) : (
        <ClipReel
          reelRef={scrollRef}
          pages={pages}
          pageH={pageH}
          active={active}
          muted={muted}
          onScroll={onScroll}
          onOffset={onOffset}
          onToggleMute={() => setMuted((m) => !m)}
          onLike={likeClip}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
          onOpenArtist={onOpenArtist}
          onTrack={track}
        />
      )}
      {!loading && pages.length > 0 && loadError ? (
        <Pressable style={styles.loadMoreError} onPress={loadMore} accessibilityRole="button" accessibilityLabel="Retry loading more clips">
          <Text style={styles.loadMoreErrorText}>{loadError}</Text>
        </Pressable>
      ) : null}
      </View>
    </View>
  );
}

function ClipReel(props) {
  return web ? <WebReel {...props} /> : <NativeReel {...props} />;
}

function ClipReelPage({ pg, index, pageH, active, muted, onToggleMute, onLike, onOpenPost, onOpenProfile, onOpenArtist, onTrack }) {
  return (
    <ClipPage
      post={pg.post}
      uri={pg.uri}
      posterUri={pg.posterUri}
      altText={pg.altText}
      height={pageH}
      active={index === active}
      posterEnabled={shouldWarmClipPoster({ index, activeIndex: active })}
      muted={muted}
      onToggleMute={onToggleMute}
      onLike={() => onLike(pg.post)}
      onOpenPost={onOpenPost}
      onOpenProfile={onOpenProfile}
      onOpenArtist={onOpenArtist}
      onTrack={onTrack}
    />
  );
}

// Native uses a virtualized, paged list. A plain View cannot receive vertical
// scroll gestures, which previously stranded iOS and Android on the first clip.
// Only the active page mounts a decoder; the adjacent pages retain lightweight
// durable posters so swipes never reveal a black rectangle.
function NativeReel({ reelRef, pages, pageH, active, muted, onScroll, onToggleMute, onLike, onOpenPost, onOpenProfile, onOpenArtist, onTrack }) {
  return (
    <FlatList
      ref={reelRef}
      data={pages}
      style={styles.reelInner}
      keyExtractor={(pg, index) => `${pg.post.id}:${index}`}
      renderItem={({ item, index }) => (
        <ClipReelPage
          pg={item}
          index={index}
          pageH={pageH}
          active={active}
          muted={muted}
          onToggleMute={onToggleMute}
          onLike={onLike}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
          onOpenArtist={onOpenArtist}
          onTrack={onTrack}
        />
      )}
      getItemLayout={(_, index) => ({ length: pageH, offset: pageH * index, index })}
      pagingEnabled
      snapToInterval={pageH}
      snapToAlignment="start"
      disableIntervalMomentum
      decelerationRate="fast"
      bounces={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={onScroll}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      removeClippedSubviews
      extraData={`${active}:${muted}:${pageH}`}
      contentInsetAdjustmentBehavior="never"
      accessibilityLabel="Concert clips"
    />
  );
}

// Web reel uses CSS scroll-snap because React Native Web's FlatList does not
// provide native-style paging and expo-video renders a real HTML video element.
function WebReel({ reelRef, pages, pageH, active, muted, onOffset, onToggleMute, onLike, onOpenPost, onOpenProfile, onOpenArtist, onTrack }) {
  const localRef = useRef(null);
  const ref = reelRef || localRef;
  const previousPageHeightRef = useRef(pageH);
  useEffect(() => {
    if (!web) return;
    const el = ref.current;
    if (!el || !el.addEventListener) return;
    const adaptScroll = (event) => onOffset?.(event.currentTarget?.scrollTop || event.target?.scrollTop || 0);
    el.addEventListener("scroll", adaptScroll, { passive: true });
    return () => el.removeEventListener("scroll", adaptScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOffset]);

  useEffect(() => {
    const el = ref.current;
    const previous = previousPageHeightRef.current;
    previousPageHeightRef.current = pageH;
    if (!el || previous === pageH) return;
    el.scrollTo?.({ top: active * pageH, behavior: "auto" });
  }, [active, pageH, ref]);

  useEffect(() => {
    if (!web || typeof globalThis.window === "undefined") return undefined;
    const onKeyDown = (event) => {
      const target = clipKeyboardTarget({
        key: event.key,
        activeIndex: active,
        pageCount: pages.length,
        tagName: event.target?.tagName,
        isContentEditable: !!event.target?.isContentEditable,
      });
      if (target == null) return;
      event.preventDefault?.();
      if (target === active) return;
      ref.current?.scrollTo?.({ top: target * pageH, behavior: "smooth" });
    };
    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [active, pageH, pages.length, ref]);

  const renderWindow = clipRenderWindow(active, pages.length);
  const visiblePages = pages.slice(renderWindow.start, renderWindow.end);
  return (
    <View
      ref={ref}
      style={styles.reelInner}
      // scroll-snap keeps every swipe on one clip.
      {...(web ? { dataSet: { pitReel: "1" } } : {})}
      accessible
      accessibilityLabel="Concert clips. Use the up and down arrow keys to change clips."
    >
      {renderWindow.start > 0 ? <View style={{ height: renderWindow.start * pageH, flexShrink: 0 }} /> : null}
      {visiblePages.map((pg, offset) => {
        const i = renderWindow.start + offset;
        return (
        <View key={`${pg.post.id}:${i}`} style={{ scrollSnapAlign: "start", flexShrink: 0 }}>
          <ClipReelPage
            pg={pg}
            index={i}
            pageH={pageH}
            active={active}
            muted={muted}
            onToggleMute={onToggleMute}
            onLike={onLike}
            onOpenPost={onOpenPost}
            onOpenProfile={onOpenProfile}
            onOpenArtist={onOpenArtist}
            onTrack={onTrack}
          />
        </View>
      );})}
      {renderWindow.end < pages.length ? <View style={{ height: (pages.length - renderWindow.end) * pageH, flexShrink: 0 }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#04050a" },
  reelHost: { flex: 1, minHeight: 0 },
  topBar: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  topBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { color: "#fff", fontFamily: mono, fontSize: 13, fontWeight: "800", letterSpacing: 3 },

  reelWeb: { overflowY: "scroll", scrollSnapType: "y mandatory" },
  reelInner: { flex: 1, ...(web ? { overflowY: "scroll", scrollSnapType: "y mandatory", height: "100%" } : null) },

  page: { width: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#04050a", position: "relative" },
  pageFrame: { flex: 1, width: "100%", position: "relative" },
  pageFrameWeb: { maxWidth: 1100 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  stageIdle: { backgroundColor: "#07080e" },
  video: { width: "100%", height: "100%", backgroundColor: "#000" },
  pausedGlyph: { position: "absolute", width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  playbackError: { ...StyleSheet.absoluteFillObject, zIndex: 3, alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 28, backgroundColor: "rgba(5,7,12,0.9)" },
  playbackErrorTitle: { color: "#fff", fontSize: 17, fontWeight: "800", textAlign: "center" },
  playbackErrorCopy: { maxWidth: 360, color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 19, textAlign: "center" },
  retryBtn: { minHeight: 44, justifyContent: "center", marginTop: 3, paddingHorizontal: 18, borderRadius: 22, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(242,166,90,0.65)", backgroundColor: "rgba(242,166,90,0.12)" },
  retryText: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
  loadMoreError: { position: "absolute", left: 16, right: 16, bottom: 18, zIndex: 8, minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(242,166,90,0.72)", backgroundColor: "rgba(5,7,12,0.92)" },
  loadMoreErrorText: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "800", textAlign: "center" },

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
