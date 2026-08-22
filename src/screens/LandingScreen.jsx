import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing, useWindowDimensions, Platform, ScrollView, AccessibilityInfo } from "react-native";
import { Image as ExpoImage } from "expo-image";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { displayFont, focusRing, mono, radius } from "../theme";
import Icon from "../components/Icon";
import { catalogVenues, catalogArtists } from "../seed/catalog";
import { api } from "../lib/api";
import { JOURNEY_TAGLINE, landingSlideUri, landingVisibleSlideIndices } from "../domain/menuJourney.mjs";
import { landingLayoutMode, landingProofItems } from "../domain/landingPresentation.mjs";
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

function LandingAction({ kind = "ghost", title, icon, onPress, accessibilityHint, fullWidth = false }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const primary = kind === "primary";
  const login = kind === "login";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hitSlop={login ? 4 : 0}
      style={({ pressed }) => [
        styles.action,
        primary ? styles.actionPrimary : login ? styles.actionLogin : styles.actionGhost,
        fullWidth && styles.actionFull,
        hovered && !pressed && styles.actionHovered,
        focused && focusRing,
        pressed && styles.actionPressed,
      ]}
    >
      {!!icon && <Icon name={icon} size={login ? 15 : 18} color={primary ? "#1A1206" : "#F4EFE7"} strokeWidth={2.4} />}
      <Text style={[
        styles.actionText,
        primary ? styles.actionPrimaryText : styles.actionGhostText,
        login && styles.actionLoginText,
      ]}>{title}</Text>
    </Pressable>
  );
}

function LandingAttribution({ frame, caption, inline = false }) {
  const community = frame?.source === "community";
  return (
    <View style={[styles.creditBlock, inline && styles.creditBlockInline]}>
      {community && (
        <View style={styles.communitySource}>
          <View style={styles.communitySourceDot} />
          <Text style={styles.communitySourceText}>FROM THE PIT</Text>
        </View>
      )}
      {!!caption && <Text style={[styles.communityCaption, inline && styles.communityCaptionInline]} numberOfLines={2}>{caption}</Text>}
      <Text style={styles.credit}>{frame?.credit || "PIT"}</Text>
    </View>
  );
}

export default function LandingScreen({ onLogin, onSignup, onBrowse }) {
  const { width, height, fontScale } = useWindowDimensions();
  const { wide, compact, scrollPitch, overlayCredit } = landingLayoutMode({ width, height, fontScale });
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

  const glowOp = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.58, 1] });
  // The live artist total reflects saved catalogue growth and falls back to the
  // bundled catalogue offline. Account totals are intentionally not requested
  // or presented as landing-page social proof.
  const [liveArtists, setLiveArtists] = useState(null);
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
          reduceMotion: reduceMotionRef.current,
        })) return;
        setHasAdvanced(true);
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
  const proofItems = landingProofItems({ venues: venueCount, artists: artistCount });

  // On phones the pitch SCROLLS (centered when it fits, scrollable when the user
  // has large text) so it can never overlap the top bar or get clipped. On desktop
  // it's a bottom-anchored hero.
  const Pitch = scrollPitch ? ScrollView : View;
  const pitchProps = scrollPitch
    ? {
      style: styles.content,
      contentContainerStyle: wide ? styles.scrollWideShort : styles.scrollNarrow,
      showsVerticalScrollIndicator: false,
      keyboardShouldPersistTaps: "handled",
    }
    : { style: [styles.content, styles.contentWide] };
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
          <LinearGradient id="scrimH" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#05060B" stopOpacity="0.88" />
            <Stop offset="0.46" stopColor="#05060B" stopOpacity="0.52" />
            <Stop offset="0.76" stopColor="#05060B" stopOpacity="0.12" />
            <Stop offset="1" stopColor="#05060B" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="scrimCenter" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#05060B" stopOpacity="0.3" />
            <Stop offset="0.5" stopColor="#05060B" stopOpacity="0.7" />
            <Stop offset="1" stopColor="#05060B" stopOpacity="0.3" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#scrimV)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#scrimAmber)" />
        <Rect x="0" y="0" width="100%" height="100%" fill={wide ? "url(#scrimH)" : "url(#scrimCenter)"} />
      </Svg>

      {/* ---- top bar: brand + login ---- */}
      <View style={[styles.topbar, scrollPitch && styles.topbarScrolled, compact && styles.topbarCompact, styles.boxNonePointerEvents]}>
        <View style={styles.brandLockup} accessibilityRole="text" accessibilityLabel="PIT, live music remembered">
          <ExpoImage source={require("../../assets/pit-favicon-v1.png")} style={styles.brandMark} contentFit="cover" accessible={false} />
          <View>
            <Text style={styles.brand}>PIT</Text>
            {!compact && <Text style={styles.brandSub}>LIVE MUSIC, REMEMBERED</Text>}
          </View>
        </View>
        <LandingAction
          kind="login"
          title="Log in"
          onPress={onLogin}
          accessibilityHint="Opens the PIT sign-in form"
        />
      </View>

      {/* ---- the pitch ---- */}
      <Pitch {...pitchProps} style={[pitchProps.style, styles.boxNonePointerEvents]}>
        <View style={wide ? styles.blockWide : styles.blockNarrow}>
          <View style={[styles.kickerRow, !wide && styles.kickerRowNarrow]}>
            <Animated.View style={[styles.kickerLine, { opacity: glowOp }]} />
            <Text style={[styles.kicker, compact && styles.kickerCompact]}>
              {compact ? "EVERY SHOW. YOUR STORY." : "EVERY SHOW BECOMES PART OF YOUR STORY"}
            </Text>
          </View>
          <Text
            style={[styles.headline, !wide && styles.headlineNarrow, compact && styles.headlineCompact]}
            accessibilityRole="header"
            accessibilityLabel={JOURNEY_TAGLINE}
          >
            Your life's{"\n"}<Text style={styles.headlineAccent}>musical journey.</Text>
          </Text>
          <Text style={[styles.sub, !wide && { textAlign: "center" }]}>
            Log the concerts that shape your story, remember every band and room, and find
            your next unforgettable night through people whose taste you trust.
          </Text>

          <View style={[styles.ctas, !wide && styles.ctasNarrow, compact && styles.ctasCompact]}>
            <LandingAction
              kind="primary"
              title="Start your concert diary"
              icon="ticket"
              onPress={onSignup}
              fullWidth={compact}
              accessibilityHint="Creates a PIT account"
            />
            <LandingAction
              title="Explore as guest"
              icon="discover"
              onPress={onBrowse}
              fullWidth={compact}
              accessibilityHint="Opens PIT without creating an account"
            />
          </View>

          <View style={[styles.proofRail, compact && styles.proofRailCompact]} accessibilityLabel="PIT catalogue and rating features">
            {proofItems.map((item, index) => (
              <View
                key={item.key}
                style={[
                  styles.proofItem,
                  compact && styles.proofItemCompact,
                  index > 0 && (compact ? styles.proofItemDividerCompact : styles.proofItemDivider),
                ]}
              >
                <View style={styles.proofIcon}>
                  <Icon name={item.icon} size={17} color="#F2A65A" strokeWidth={2.2} />
                </View>
                <View style={styles.proofCopy}>
                  <Text style={styles.proofTitle}>{item.title}</Text>
                  <Text style={styles.proofDetail}>{item.detail}</Text>
                </View>
              </View>
            ))}
          </View>

          {!overlayCredit && (
            <View style={styles.inlineFoot}>
              <View style={styles.slideRail} accessible={false}>
                {slides.map((slide, index) => <View key={`${slide.id}:${index}`} style={[styles.slideDot, index === idx && styles.slideDotActive]} />)}
              </View>
              <LandingAttribution frame={currentFrame} caption={currentCaption} inline />
            </View>
          )}
        </View>
      </Pitch>

      {/* Desktop attribution stays cinematic; short and narrow screens keep it
          in normal scroll flow so it can never cover a CTA. */}
      {overlayCredit && (
        <View style={[styles.foot, styles.noPointerEvents]}>
          <View style={styles.slideRail} accessible={false}>
            {slides.map((slide, index) => <View key={`${slide.id}:${index}`} style={[styles.slideDot, index === idx && styles.slideDotActive]} />)}
          </View>
          <LandingAttribution frame={currentFrame} caption={currentCaption} />
        </View>
      )}
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
  topbarScrolled: {
    paddingBottom: 12,
    backgroundColor: "rgba(5,6,11,0.92)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(244,239,231,0.1)",
    ...Platform.select({ web: { backdropFilter: "blur(14px)" } }),
  },
  topbarCompact: { paddingHorizontal: 16, paddingTop: 12 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 34, height: 34, borderRadius: 9 },
  brand: {
    color: "#F4EFE7", fontFamily: mono, fontSize: 22, lineHeight: 23, fontWeight: "900", letterSpacing: 5,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 12px rgba(0,0,0,0.7)" } : { textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 12 }),
  },
  brandSub: { color: "rgba(244,239,231,0.58)", fontFamily: mono, fontSize: 8, lineHeight: 12, letterSpacing: 1.8, fontWeight: "800" },

  content: { flex: 1, zIndex: 4 },
  contentWide: { justifyContent: "flex-end", paddingHorizontal: 72, paddingBottom: 86 },
  // grows to center the pitch when it fits, scrolls when large text makes it tall;
  // top padding always clears the brand/login bar.
  scrollNarrow: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingTop: 96, paddingBottom: 26 },
  scrollWideShort: { flexGrow: 1, justifyContent: "center", alignItems: "flex-start", paddingHorizontal: 72, paddingTop: 102, paddingBottom: 30 },
  blockWide: { width: "100%", maxWidth: 720 },
  blockNarrow: { width: "100%", maxWidth: 580, alignItems: "center" },

  kickerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 15 },
  kickerRowNarrow: { justifyContent: "center" },
  kickerLine: { width: 36, height: 2, borderRadius: 2, backgroundColor: "#FF8C42", ...Platform.select({ web: { boxShadow: "0 0 14px rgba(255,140,66,0.85)" } }) },
  kicker: { color: "#F2A65A", fontFamily: mono, fontSize: 11, letterSpacing: 3.2, fontWeight: "900" },
  kickerCompact: { fontSize: 10, letterSpacing: 2.3 },
  headline: {
    color: "#FFFFFF", fontFamily: displayFont, fontSize: 60, lineHeight: 62, fontWeight: "900", letterSpacing: -1.4,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 18px rgba(0,0,0,0.55)" } : { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 18 }),
  },
  headlineNarrow: { fontSize: 44, lineHeight: 47, textAlign: "center" },
  headlineCompact: { fontSize: 38, lineHeight: 41, letterSpacing: -0.7 },
  headlineAccent: { color: "#FF9A4F" },
  sub: { color: "rgba(244,239,231,0.84)", fontSize: 16, lineHeight: 24, maxWidth: 550, marginTop: 16 },

  ctas: { flexDirection: "row", gap: 12, marginTop: 26, flexWrap: "wrap" },
  ctasNarrow: { justifyContent: "center" },
  ctasCompact: { width: "100%", maxWidth: 360, flexDirection: "column", flexWrap: "nowrap", gap: 10 },
  action: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: 26,
    paddingVertical: 13,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "140ms", transitionProperty: "filter, transform, box-shadow, background-color" } }),
  },
  actionPrimary: {
    backgroundColor: "#FF8C42",
    borderColor: "#FFB05F",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 8px 28px rgba(255,140,66,0.42)" }
      : { shadowColor: "#FF8C42", shadowOpacity: 0.46, shadowRadius: 22, shadowOffset: { width: 0, height: 7 }, elevation: 9 }),
  },
  actionGhost: {
    borderColor: "rgba(244,239,231,0.42)",
    backgroundColor: "rgba(5,6,11,0.48)",
    ...Platform.select({ web: { backdropFilter: "blur(12px)" } }),
  },
  actionLogin: {
    minHeight: 44,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderColor: "rgba(244,239,231,0.45)",
    backgroundColor: "rgba(5,6,11,0.48)",
    ...Platform.select({ web: { backdropFilter: "blur(12px)" } }),
  },
  actionFull: { width: "100%" },
  actionHovered: { transform: [{ translateY: -1 }], ...Platform.select({ web: { filter: "brightness(1.08)" } }) },
  actionPressed: { transform: [{ translateY: 2 }], opacity: 0.92 },
  actionText: { fontFamily: displayFont, fontSize: 15, lineHeight: 20, fontWeight: "900", letterSpacing: 0.1 },
  actionPrimaryText: { color: "#1A1206" },
  actionGhostText: { color: "#F4EFE7" },
  actionLoginText: { fontSize: 14 },

  proofRail: {
    width: "100%",
    maxWidth: 700,
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 28,
    borderWidth: 1,
    borderColor: "rgba(244,239,231,0.15)",
    borderRadius: radius.md,
    backgroundColor: "rgba(5,6,11,0.58)",
    overflow: "hidden",
    ...Platform.select({ web: { backdropFilter: "blur(14px)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 30px rgba(0,0,0,0.24)" } }),
  },
  proofRailCompact: { maxWidth: 360, flexDirection: "column" },
  proofItem: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 15, paddingVertical: 14 },
  proofItemCompact: { flex: 0, width: "100%", minHeight: 56, paddingHorizontal: 14, paddingVertical: 11 },
  proofItemDivider: { borderLeftWidth: 1, borderLeftColor: "rgba(244,239,231,0.11)" },
  proofItemDividerCompact: { borderTopWidth: 1, borderTopColor: "rgba(244,239,231,0.11)" },
  proofIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(242,166,90,0.12)" },
  proofCopy: { flex: 1, minWidth: 0 },
  proofTitle: { color: "#F4EFE7", fontFamily: mono, fontSize: 10, lineHeight: 14, letterSpacing: 1.15, fontWeight: "900" },
  proofDetail: { color: "rgba(244,239,231,0.62)", fontSize: 11, lineHeight: 15, fontWeight: "600", marginTop: 1 },

  inlineFoot: { width: "100%", maxWidth: 360, alignItems: "center", marginTop: 22, gap: 12 },
  slideRail: { flexDirection: "row", alignItems: "center", gap: 5 },
  slideDot: { width: 4, height: 4, borderRadius: 4, backgroundColor: "rgba(244,239,231,0.27)" },
  slideDotActive: { width: 24, backgroundColor: "#F2A65A" },
  creditBlock: { alignItems: "flex-end", maxWidth: 360, gap: 2 },
  creditBlockInline: { alignItems: "center", maxWidth: "100%" },
  communitySource: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  communitySourceDot: { width: 5, height: 5, borderRadius: 5, backgroundColor: "#F2A65A" },
  communitySourceText: { color: "#F2A65A", fontFamily: mono, fontSize: 9, lineHeight: 12, letterSpacing: 1.5, fontWeight: "900" },
  communityCaption: { color: "rgba(244,239,231,0.88)", fontFamily: displayFont, fontSize: 12, lineHeight: 16, fontWeight: "800", textAlign: "right" },
  communityCaptionInline: { textAlign: "center" },
  credit: { color: "rgba(215,218,228,0.78)", fontFamily: mono, fontSize: 10, lineHeight: 14, letterSpacing: 0.35 },

  noPointerEvents: { pointerEvents: "none" },
  boxNonePointerEvents: { pointerEvents: "box-none" },

  foot: {
    position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5,
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
    paddingHorizontal: 28, paddingBottom: 16,
  },
});
