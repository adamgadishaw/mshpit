import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing, useWindowDimensions, Platform, ScrollView, AccessibilityInfo } from "react-native";
import { Image as ExpoImage } from "expo-image";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { mono, radius } from "../theme";
import Icon from "../components/Icon";
import { catalogVenues, catalogArtists } from "../seed/catalog";
import { api } from "../lib/api";
import { JOURNEY_TAGLINE, landingSlideUri, landingVisibleSlideIndices } from "../domain/menuJourney.mjs";
import {
  buildLandingSlideDeck,
  landingCommunityAdvanceDelay,
  landingCommunityFrameReady,
  landingSlideFrame,
  landingStockStartIndex,
  rotateLandingFallbacks,
} from "../domain/landingShowcase.mjs";

// ----------------------------------------------------------------------------
// The opening act, the way real music apps do it: full-bleed live-show
// photography with a slow cinematic drift, layered scrims for legibility, and
// editorial type. Explicitly opted-in, safety-filtered community photos join the reel
// after a dependable credited Unsplash first frame and fallback set.
// ----------------------------------------------------------------------------

const STOCK_SLIDES = [
  {
    id: "danny-howe-crowd",
    uri: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=2000&q=85",
    credit: "Danny Howe · Unsplash",
  },
  {
    id: "anthony-delanoix-stage",
    uri: "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?auto=format&fit=crop&w=2000&q=85",
    credit: "Anthony Delanoix · Unsplash",
  },
  {
    id: "yvette-de-wit-festival",
    uri: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=2000&q=85",
    credit: "Yvette de Wit · Unsplash",
  },
  {
    id: "nicholas-green-concert",
    uri: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1920&q=80",
    credit: "Nicholas Green · Unsplash",
  },
  {
    id: "aditya-chinchure-lights",
    uri: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1920&q=80",
    credit: "Aditya Chinchure · Unsplash",
  },
  {
    id: "vishnu-nair-stage",
    uri: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=1920&q=80",
    credit: "Vishnu R Nair · Unsplash",
  },
  {
    id: "aranxa-esteve-crowd",
    uri: "https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=1920&q=80",
    credit: "Aranxa Esteve · Unsplash",
  },
  {
    id: "yvette-de-wit-arena",
    uri: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=1920&q=80",
    credit: "Yvette de Wit · Unsplash",
  },
];
const LANDING_SLIDE_COUNT = 8;
const LANDING_SESSION_SEED = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const SESSION_STOCK_SLIDES = rotateLandingFallbacks(STOCK_SLIDES, landingStockStartIndex({
  at: Date.now(),
  sessionSeed: LANDING_SESSION_SEED,
  total: STOCK_SLIDES.length,
}));
const SLIDE_MS = 7000;
const FADE_MS = 1600;
const AnimatedExpoImage = Animated.createAnimatedComponent(ExpoImage);
// Web-only GPU hints so the zoom is buttery (no-op on native).
const WEB_SMOOTH = Platform.OS === "web" ? { willChange: "transform, opacity", backfaceVisibility: "hidden" } : null;

export default function LandingScreen({ onLogin, onSignup, onBrowse }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [reduceMotion, setReduceMotion] = useState(false);
  const reduceMotionRef = useRef(reduceMotion);
  const mountedAtRef = useRef(Date.now());
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    let mounted = true;
    const preference = AccessibilityInfo.isReduceMotionEnabled?.();
    if (preference?.then) void preference.then((enabled) => {
      if (mounted) setReduceMotion(!!enabled);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (enabled) => setReduceMotion(!!enabled));
    return () => { mounted = false; subscription?.remove?.(); };
  }, []);

  // ---- slideshow: crossfade + Ken Burns drift ----
  const [idx, setIdx] = useState(0);
  const [hasAdvanced, setHasAdvanced] = useState(false);
  const [slides, setSlides] = useState(() => buildLandingSlideDeck([], SESSION_STOCK_SLIDES, LANDING_SLIDE_COUNT));
  const [failedCommunityIds, setFailedCommunityIds] = useState(() => new Set());
  const idxRef = useRef(idx);
  const hasAdvancedRef = useRef(hasAdvanced);
  idxRef.current = idx;
  hasAdvancedRef.current = hasAdvanced;
  const fades = useRef(Array.from({ length: LANDING_SLIDE_COUNT }, (_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  const zooms = useRef(Array.from({ length: LANDING_SLIDE_COUNT }, () => new Animated.Value(0))).current;
  const pulse = useRef(new Animated.Value(0)).current;

  // Advance one full interval after whichever frame became current. A recursive
  // timeout (rather than a mount-anchored interval) means an early, prefetched
  // community frame cannot be replaced again a few hundred milliseconds later.
  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = setTimeout(() => {
      setHasAdvanced(true);
      setIdx((cur) => (cur + 1) % LANDING_SLIDE_COUNT);
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [idx, reduceMotion]);

  // The headline glow is independent of slide timing, so resetting a slide's
  // deadline never tears down and recreates this animation.
  useEffect(() => {
    if (reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return undefined;
    }
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(pulse, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
    ]));
    glow.start();
    return () => glow.stop();
  }, [pulse, reduceMotion]);

  // Crossfade to the current slide (and slow push-in), reacting to idx AFTER render.
  useEffect(() => {
    if (reduceMotion) {
      zooms[idx].setValue(0);
      fades.forEach((fade, index) => fade.setValue(index === idx ? 1 : 0));
      return;
    }
    zooms[idx].setValue(0);
    Animated.timing(zooms[idx], { toValue: 1, duration: SLIDE_MS + FADE_MS + 600, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }).start();
    fades.forEach((f, i) => {
      Animated.timing(f, { toValue: i === idx ? 1 : 0, duration: FADE_MS + (i === idx ? 0 : 300), useNativeDriver: Platform.OS !== "web" }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, reduceMotion]);

  // Keep only the visible crossfade layers mounted. Once the current frame is
  // settled, warm one correctly-sized next image rather than decoding the
  // entire eight-photo reel on a phone's first render.
  useEffect(() => {
    const next = (idx + 1) % slides.length;
    const frame = landingSlideFrame(slides[next], failedCommunityIds);
    const timer = setTimeout(() => {
      if (frame?.uri) void ExpoImage.prefetch(landingSlideUri(frame.uri, width), "disk").catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [failedCommunityIds, idx, slides, width]);

  const glowOp = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  // Live counts from the DB so the stats reflect real, saved catalog growth (the
  // bundled numbers are a frozen snapshot). Falls back to the bundle if offline.
  const [liveArtists, setLiveArtists] = useState(null);
  const [liveMembers, setLiveMembers] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let earlyAdvanceTimer = null;
    api("/api/landing/media?limit=7", { signal: controller.signal, silent: true, context: "Loading the community spotlight" })
      .then(async ({ media, totals }) => {
        if (controller.signal.aborted) return;
        const nextDeck = buildLandingSlideDeck(media, SESSION_STOCK_SLIDES, LANDING_SLIDE_COUNT);
        setSlides((current) => {
          if (!hasAdvancedRef.current) return nextDeck;
          // A very slow response must not replace the full-screen frame someone
          // is already looking at. Preserve that slot and update the rest.
          const visible = idxRef.current;
          return nextDeck.map((slide, index) => index === visible ? (current[index] || slide) : slide);
        });
        const hasCommunity = nextDeck[1]?.source === "community";
        if (typeof totals?.artists === "number") setLiveArtists(totals.artists);
        if (typeof totals?.members === "number") setLiveMembers(totals.members);

        const delay = landingCommunityAdvanceDelay({
          mountedAt: mountedAtRef.current,
          hasAdvanced: hasAdvancedRef.current,
          hasCommunity,
        });
        if (delay == null) return;

        const frame = nextDeck[1];
        const minimumWindow = new Promise((resolve) => {
          earlyAdvanceTimer = setTimeout(resolve, delay);
          controller.signal.addEventListener("abort", resolve, { once: true });
        });
        const prefetchSucceeded = await ExpoImage
          .prefetch(landingSlideUri(frame.uri, width), "disk")
          .then(Boolean)
          .catch(() => false);
        if (controller.signal.aborted) return;
        if (!prefetchSucceeded) {
          setFailedCommunityIds((current) => current.has(frame.id) ? current : new Set([...current, frame.id]));
          return;
        }
        await minimumWindow;
        if (!landingCommunityFrameReady({
          frame,
          prefetchSucceeded,
          aborted: controller.signal.aborted,
          hasAdvanced: hasAdvancedRef.current,
        })) return;
        if (!reduceMotionRef.current) setHasAdvanced(true);
        setIdx(1);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      if (earlyAdvanceTimer) clearTimeout(earlyAdvanceTimer);
    };
  }, []);
  const venueCount = Object.keys(catalogVenues).length;
  const artistCount = liveArtists ?? Object.keys(catalogArtists).length;

  // On phones the pitch SCROLLS (centered when it fits, scrollable when the user
  // has large text) so it can never overlap the top bar or get clipped. On desktop
  // it's a bottom-anchored hero.
  const Pitch = wide ? View : ScrollView;
  const pitchProps = wide
    ? { style: [styles.content, styles.contentWide] }
    : { style: styles.content, contentContainerStyle: styles.scrollNarrow, showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: "handled" };
  const currentFrame = landingSlideFrame(slides[idx], failedCommunityIds);
  const currentCaption = currentFrame?.source === "community"
    ? [currentFrame.artist, currentFrame.venue].filter(Boolean).join(" · ")
    : "";

  return (
    <View style={styles.wrap}>
      {/* ---- photography ---- */}
      {landingVisibleSlideIndices(idx, slides.length, hasAdvanced).map((i) => {
        const slot = slides[i];
        const s = landingSlideFrame(slot, failedCommunityIds);
        if (!s) return null;
        const scale = reduceMotion ? 1 : zooms[i].interpolate({ inputRange: [0, 1], outputRange: [1.02, 1.12] });
        const drift = reduceMotion ? 0 : zooms[i].interpolate({ inputRange: [0, 1], outputRange: [0, i % 2 ? -18 : 18] });
        return (
          <AnimatedExpoImage
            key={i}
            source={{ uri: landingSlideUri(s.uri, width) }}
            contentFit="cover"
            cachePolicy="memory-disk"
            priority={i === idx ? "high" : "low"}
            recyclingKey={s.id}
            transition={reduceMotion ? 0 : 180}
            accessible={false}
            onError={() => {
              if (slot?.source !== "community") return;
              setFailedCommunityIds((current) => current.has(slot.id) ? current : new Set([...current, slot.id]));
            }}
            // willChange/backfaceVisibility promote the layer to the GPU so the
            // Ken Burns zoom composites smoothly instead of repainting each frame.
            style={[StyleSheet.absoluteFill, WEB_SMOOTH, { opacity: fades[i], transform: [{ perspective: 1000 }, { scale }, { translateX: drift }] }]}
          />
        );
      })}

      {/* ---- scrims: readable type without killing the photo ---- */}
      <Svg width="100%" height="100%" style={[StyleSheet.absoluteFill, styles.noPointerEvents]}>
        <Defs>
          <LinearGradient id="scrimV" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#05060B" stopOpacity="0.82" />
            <Stop offset="0.28" stopColor="#05060B" stopOpacity="0.25" />
            <Stop offset="0.55" stopColor="#05060B" stopOpacity="0.34" />
            <Stop offset="1" stopColor="#05060B" stopOpacity="0.96" />
          </LinearGradient>
          <LinearGradient id="scrimAmber" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#FF8C42" stopOpacity="0.14" />
            <Stop offset="0.4" stopColor="#E0457B" stopOpacity="0.05" />
            <Stop offset="1" stopColor="#000" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#scrimV)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#scrimAmber)" />
      </Svg>

      {/* ---- top bar: brand + login ---- */}
      <View style={[styles.topbar, styles.boxNonePointerEvents]}>
        <Text style={styles.brand}>PIT</Text>
        <Pressable style={styles.topLogin} onPress={onLogin} hitSlop={8}>
          <Text style={styles.topLoginTxt}>Log in</Text>
        </Pressable>
      </View>

      {/* ---- the pitch ---- */}
      <Pitch {...pitchProps} style={[pitchProps.style, styles.boxNonePointerEvents]}>
        <View style={wide ? styles.blockWide : styles.blockNarrow}>
          <Text style={styles.kicker}>EVERY SHOW BECOMES PART OF YOUR STORY</Text>
          <Animated.Text
            style={[styles.headline, { opacity: glowOp }, !wide && styles.headlineNarrow]}
            accessibilityRole="header"
            accessibilityLabel={JOURNEY_TAGLINE}
          >
            Your life's{"\n"}<Text style={styles.headlineAccent}>musical journey.</Text>
          </Animated.Text>
          <Text style={[styles.sub, !wide && { textAlign: "center" }]}>
            Log the concerts that shape your story, remember every band and room, and find
            your next unforgettable night through people whose taste you trust.
          </Text>

          <View style={[styles.ctas, !wide && { justifyContent: "center" }]}>
            <Pressable style={styles.primary} onPress={onSignup}>
              <Icon name="ticket" size={17} color="#1A1206" />
              <Text style={styles.primaryTxt}>Join the pit</Text>
            </Pressable>
            <Pressable style={styles.ghost} onPress={onBrowse}>
              <Text style={styles.ghostTxt}>Browse as guest</Text>
            </Pressable>
          </View>

          <View style={[styles.stats, !wide && { justifyContent: "center" }]}>
            <View style={styles.statChip}>
              <Text style={styles.statNum}>{venueCount.toLocaleString()}</Text>
              <Text style={styles.statLbl}>VENUES</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statNum}>{artistCount.toLocaleString()}</Text>
              <Text style={styles.statLbl}>ARTISTS</Text>
            </View>
            {liveMembers != null && liveMembers > 0 && (
              <View style={styles.statChip}>
              <Text style={styles.statNum}>{liveMembers.toLocaleString()}</Text>
              <Text style={styles.statLbl}>FOUNDING MEMBERS</Text>
              </View>
            )}
            <View style={styles.statChip}>
              <Text style={styles.statNum}>2</Text>
              <Text style={styles.statLbl}>SCORES · BAND & ROOM</Text>
            </View>
          </View>
        </View>
      </Pitch>

      {/* ---- footer strip ---- */}
      <View style={[styles.foot, styles.noPointerEvents]}>
        <Text style={styles.footTxt}>BAND VS ROOM · SPOILER-SAFE SETLISTS · YOUR CITY&apos;S ROOMS</Text>
        <View style={styles.creditBlock}>
          {!!currentCaption && <Text style={styles.communityCaption} numberOfLines={1}>{currentCaption}</Text>}
          <Text style={styles.credit}>{currentFrame?.credit || "PIT"}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#05060B", overflow: "hidden" },

  topbar: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 5,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 28, paddingTop: 22,
  },
  brand: {
    color: "#F4EFE7", fontFamily: mono, fontSize: 24, fontWeight: "900", letterSpacing: 6,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 12px rgba(0,0,0,0.7)" } : { textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 12 }),
  },
  topLogin: {
    borderRadius: radius.pill, borderWidth: 1.5, borderColor: "rgba(244,239,231,0.45)",
    backgroundColor: "rgba(5,6,11,0.35)", paddingHorizontal: 20, paddingVertical: 9,
  },
  topLoginTxt: { color: "#F4EFE7", fontSize: 14, fontWeight: "700" },

  content: { flex: 1, zIndex: 4 },
  contentWide: { justifyContent: "flex-end", paddingHorizontal: 72, paddingBottom: 96 },
  // grows to center the pitch when it fits, scrolls when large text makes it tall;
  // top padding always clears the brand/login bar.
  scrollNarrow: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24, paddingTop: 92, paddingBottom: 64 },
  blockWide: { maxWidth: 640 },
  blockNarrow: { alignItems: "center" },

  kicker: { color: "#F2A65A", fontFamily: mono, fontSize: 12, letterSpacing: 5, fontWeight: "800", marginBottom: 14 },
  headline: {
    color: "#FFFFFF", fontSize: 58, lineHeight: 62, fontWeight: "900", letterSpacing: -1.2,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 18px rgba(0,0,0,0.55)" } : { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 18 }),
  },
  headlineNarrow: { fontSize: 40, lineHeight: 44, textAlign: "center" },
  headlineAccent: { color: "#FF8C42" },
  sub: { color: "rgba(244,239,231,0.82)", fontSize: 16, lineHeight: 24, maxWidth: 520, marginTop: 16 },

  ctas: { flexDirection: "row", gap: 12, marginTop: 26, flexWrap: "wrap" },
  primary: {
    flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#FF8C42",
    borderRadius: radius.pill, paddingHorizontal: 30, paddingVertical: 15,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 6px 24px rgba(255,140,66,0.55)" }
      : { shadowColor: "#FF8C42", shadowOpacity: 0.55, shadowRadius: 24, shadowOffset: { width: 0, height: 6 }, elevation: 10 }),
  },
  noPointerEvents: { pointerEvents: "none" },
  boxNonePointerEvents: { pointerEvents: "box-none" },
  primaryTxt: { color: "#1A1206", fontSize: 16, fontWeight: "900", letterSpacing: 0.3 },
  ghost: {
    borderRadius: radius.pill, paddingHorizontal: 26, paddingVertical: 15,
    borderWidth: 1.5, borderColor: "rgba(244,239,231,0.4)", backgroundColor: "rgba(5,6,11,0.35)",
    ...(Platform.OS === "web" ? { backdropFilter: "blur(10px)" } : null),
  },
  ghostTxt: { color: "#F4EFE7", fontSize: 16, fontWeight: "700" },

  stats: { flexDirection: "row", gap: 10, marginTop: 30, flexWrap: "wrap" },
  statChip: {
    flexDirection: "row", alignItems: "baseline", gap: 8,
    backgroundColor: "rgba(5,6,11,0.5)", borderWidth: 1, borderColor: "rgba(244,239,231,0.14)",
    borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 9,
    ...(Platform.OS === "web" ? { backdropFilter: "blur(10px)" } : null),
  },
  statNum: { color: "#F2A65A", fontFamily: mono, fontSize: 16, fontWeight: "800" },
  statLbl: { color: "rgba(244,239,231,0.6)", fontFamily: mono, fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },

  foot: {
    position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 28, paddingBottom: 16,
  },
  footTxt: { color: "rgba(154,160,182,0.5)", fontFamily: mono, fontSize: 10, letterSpacing: 2.5 },
  creditBlock: { alignItems: "flex-end", maxWidth: "48%", gap: 2 },
  communityCaption: { color: "rgba(244,239,231,0.78)", fontSize: 11, fontWeight: "700" },
  credit: { color: "rgba(154,160,182,0.45)", fontFamily: mono, fontSize: 10, letterSpacing: 0.5 },
});
