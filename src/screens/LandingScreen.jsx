import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing, useWindowDimensions, Platform, ScrollView, AccessibilityInfo } from "react-native";
import { Image as ExpoImage } from "expo-image";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { displayFont, focusRing, mono, radius } from "../theme";
import Icon from "../components/Icon";
import { api } from "../lib/api";
import { useStore } from "../store";
import { ENABLE_DEMO_DATA } from "../config/runtime.mjs";
import { landingSlideUri, landingVisibleSlideIndices } from "../domain/menuJourney.mjs";
import {
  LANDING_IDENTITY_COPY,
  landingKicker,
  landingLayoutMode,
  landingProofItems,
} from "../domain/landingPresentation.mjs";
import {
  buildLandingSlideDeck,
  landingCommunityAdvanceDelay,
  landingCommunityFrameReady,
  landingSlideFrame,
  landingStockStartIndex,
  rotateLandingFallbacks,
} from "../domain/landingShowcase.mjs";
import { liveEventTitle } from "../domain/liveDiscovery.mjs";

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

function WebPublicNav({ hidden = false, compact = false }) {
  if (Platform.OS !== "web" || hidden) return null;
  return (
    <View style={[styles.publicNav, compact && styles.publicNavCompact]} accessibilityLabel="Public music directories">
      <Text href="/artists" accessibilityRole="link" style={styles.publicNavLink}>Artists</Text>
      <Text href="/events" accessibilityRole="link" style={styles.publicNavLink}>Events</Text>
      <Text href="/about" accessibilityRole="link" style={styles.publicNavLink}>About</Text>
    </View>
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
      <Text style={styles.credit}>{frame?.credit || "MSHPIT"}</Text>
    </View>
  );
}

function landingDateLabel(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(value + "T12:00:00");
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function LandingLiveRow({ item, onPress }) {
  const title = liveEventTitle(item);
  const location = [item?.venue, item?.city || item?.place?.split?.(",")?.[0]].filter(Boolean).join(" · ");
  const signal = [landingDateLabel(item?.date), location].filter(Boolean).join(" · ");
  const eventLabel = "Open " + title + (location ? " at " + location : "") + (item?.date ? ", " + item.date : "");
  return (
    <Pressable
      style={({ pressed, hovered, focused }) => [
        styles.liveRow,
        hovered && styles.liveRowHovered,
        pressed && styles.actionPressed,
        focused && styles.liveRowFocused,
      ]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !onPress }}
      accessibilityLabel={eventLabel}
    >
      <View style={styles.liveRowIcon}>
        <Icon name="calendar" size={15} color="#F2A65A" />
      </View>
      <View style={styles.liveRowCopy}>
        <Text style={styles.liveRowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.liveRowDetail} numberOfLines={1}>{signal || "Details coming soon"}</Text>
      </View>
      <Icon name="chevron-right" size={14} color="rgba(244,239,231,0.5)" />
    </Pressable>
  );
}

export default function LandingScreen({ onLogin, onSignup, onBrowse, onSuggestion, onOpenEvent, onExploreLounges }) {
  const { discoverStats, discoverySidebar } = useStore();
  const { width, height, fontScale } = useWindowDimensions();
  const { wide, compact, scrollPitch } = landingLayoutMode({ width, height, fontScale });
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
  // Production catalogue totals are server-owned. Account totals are
  // intentionally not requested or presented as landing-page social proof.
  const [catalogTotals, setCatalogTotals] = useState({ artists: 0, venues: 0 });
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
        setCatalogTotals({
          artists: typeof totals?.artists === "number" ? totals.artists : 0,
          venues: typeof totals?.venues === "number" ? totals.venues : 0,
        });
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
  const demoTotals = ENABLE_DEMO_DATA ? discoverStats() : null;
  const proofItems = landingProofItems({
    artists: catalogTotals.artists || demoTotals?.artists || 0,
    venues: catalogTotals.venues || demoTotals?.venues || 0,
  });
  // Discovery is already loaded once by StoreProvider. Reusing that bounded,
  // public projection avoids a second event-catalogue query during startup.
  const landingLiveEvents = useMemo(
    () => Array.isArray(discoverySidebar?.upcomingEvents)
      ? discoverySidebar.upcomingEvents.slice(0, 3)
      : [],
    [discoverySidebar?.upcomingEvents],
  );
  const hasLandingLive = landingLiveEvents.length > 0;

  // The landing shell never changes component type when async content arrives.
  // It is always scrollable, while the viewport alone decides its alignment.
  const pitchContentStyle = wide
    ? (scrollPitch ? styles.scrollWideShort : styles.scrollWideHero)
    : styles.scrollNarrow;
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
        <View style={styles.brandLockup} accessibilityRole="text" accessibilityLabel="Mshpit, live music remembered">
          <ExpoImage source={require("../../assets/pit-favicon-v1.png")} style={styles.brandMark} contentFit="cover" accessible={false} />
          <View>
            <Text style={styles.brand}>MSHPIT</Text>
            {!compact && <Text style={styles.brandSub}>LIVE MUSIC, REMEMBERED</Text>}
          </View>
        </View>
        <WebPublicNav hidden={compact} />
        <LandingAction
          kind="login"
          title="Log in"
          onPress={onLogin}
          accessibilityHint="Opens the Mshpit sign-in form"
        />
      </View>

      {/* ---- the pitch ---- */}
      <ScrollView
        style={[styles.content, styles.boxNonePointerEvents]}
        contentContainerStyle={pitchContentStyle}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={wide ? styles.blockWide : styles.blockNarrow}>
          <View style={[styles.kickerRow, !wide && styles.kickerRowNarrow]}>
            <Animated.View style={[styles.kickerLine, { opacity: glowOp }]} />
            <Text style={[styles.kicker, compact && styles.kickerCompact]}>
              {landingKicker(compact)}
            </Text>
          </View>
          <Text
            style={[styles.headline, !wide && styles.headlineNarrow, compact && styles.headlineCompact]}
            accessibilityRole="header"
            accessibilityLabel={`${LANDING_IDENTITY_COPY.headline} ${LANDING_IDENTITY_COPY.headlineAccent}`}
          >
            {LANDING_IDENTITY_COPY.headline}{"\n"}<Text style={styles.headlineAccent}>{LANDING_IDENTITY_COPY.headlineAccent}</Text>
          </Text>
          <Text style={[styles.sub, !wide && { textAlign: "center" }]}>
            {LANDING_IDENTITY_COPY.body}
          </Text>

          <View style={[styles.ctas, !wide && styles.ctasNarrow, compact && styles.ctasCompact]}>
            <LandingAction
              kind="primary"
              title={LANDING_IDENTITY_COPY.signupAction}
              icon="ticket"
              onPress={onSignup}
              fullWidth={compact}
              accessibilityHint="Creates a Mshpit account"
            />
            <LandingAction
              title={LANDING_IDENTITY_COPY.browseAction}
              icon="discover"
              onPress={onBrowse}
              fullWidth={compact}
              accessibilityHint="Opens Mshpit without creating an account"
            />
          </View>

          <View style={[styles.proofRail, compact && styles.proofRailCompact]} accessibilityLabel="Mshpit catalogue and rating features">
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

          {hasLandingLive ? (
            <View style={[styles.liveRail, compact && styles.liveRailCompact]} accessibilityLabel="Worldwide live discovery on Mshpit">
              <View style={styles.liveRailHead}>
                <View>
                  <Text style={styles.liveRailEyebrow}>HAPPENING ON MSHPIT</Text>
                  <Text style={styles.liveRailTitle}>Shows ahead. Rooms waiting.</Text>
                </View>
                <View style={styles.worldPill}>
                  <Icon name="globe" size={12} color="#F2A65A" />
                  <Text style={styles.worldPillText}>WORLDWIDE</Text>
                </View>
              </View>
              <View style={[styles.liveColumns, compact && styles.liveColumnsCompact]}>
                <View style={styles.liveColumn}>
                  <Text style={styles.liveColumnLabel}>UPCOMING LIVE EVENTS</Text>
                  {landingLiveEvents.slice(0, compact ? 2 : 3).map((event) => (
                    <LandingLiveRow
                      key={event.id || [liveEventTitle(event), event.venue, event.date].join("|")}
                      item={event}
                      onPress={() => onOpenEvent?.(event)}
                    />
                  ))}
                </View>
                <View style={styles.liveColumn}>
                  <Text style={styles.liveColumnLabel}>CONCERT LOUNGES</Text>
                  <Pressable
                    style={({ pressed, hovered, focused }) => [
                      styles.loungeExplainer,
                      hovered && styles.liveRowHovered,
                      pressed && styles.actionPressed,
                      focused && styles.liveRowFocused,
                    ]}
                    onPress={onExploreLounges}
                    disabled={!onExploreLounges}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !onExploreLounges }}
                    accessibilityLabel="Explore concert lounges"
                    accessibilityHint="Opens Discover. Specific active rooms are shown after sign in."
                  >
                    <View style={[styles.liveRowIcon, styles.liveRowIconLounge]}><Icon name="comment" size={18} color="#E76A99" /></View>
                    <View style={styles.liveRowCopy}>
                      <Text style={styles.liveRowTitle}>Talk with the people going</Text>
                      <Text style={styles.loungeExplainerDetail}>Each show has a gated room. Sign in to see active lounges and join a conversation.</Text>
                    </View>
                    <Icon name="chevron-right" size={14} color="rgba(244,239,231,0.5)" />
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}

          {compact && <WebPublicNav compact />}

          {!!onSuggestion && (
            <Pressable
              style={({ pressed, hovered, focused }) => [
                styles.feedbackLink,
                (pressed || hovered) && styles.feedbackLinkActive,
                focused && styles.feedbackLinkFocused,
              ]}
              onPress={onSuggestion}
              accessibilityRole="button"
              accessibilityLabel="Tell Pit what would make you come back"
              accessibilityHint="Opens the anonymous suggestion box"
            >
              <Icon name="comment" size={14} color="#F2A65A" />
              <Text style={styles.feedbackLinkText}>What would make you come back?</Text>
              <Icon name="chevron-right" size={14} color="#F2A65A" />
            </Pressable>
          )}

          <View style={styles.inlineFoot}>
            <View style={styles.slideRail} accessible={false}>
              {slides.map((slide, index) => <View key={`${slide.id}:${index}`} style={[styles.slideDot, index === idx && styles.slideDotActive]} />)}
            </View>
            <LandingAttribution frame={currentFrame} caption={currentCaption} inline />
          </View>
        </View>
      </ScrollView>
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
  publicNav: { marginLeft: "auto", marginRight: 18, flexDirection: "row", alignItems: "center", gap: 18 },
  publicNavCompact: { alignSelf: "center", marginLeft: 0, marginRight: 0, marginTop: 2, marginBottom: 2 },
  publicNavLink: { color: "rgba(244,239,231,0.86)", fontFamily: mono, fontSize: 11, lineHeight: 18, fontWeight: "800", letterSpacing: 1.1, textDecorationLine: "none" },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 34, height: 34, borderRadius: 9 },
  brand: {
    color: "#F4EFE7", fontFamily: mono, fontSize: 22, lineHeight: 23, fontWeight: "900", letterSpacing: 5,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 12px rgba(0,0,0,0.7)" } : { textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 12 }),
  },
  brandSub: { color: "rgba(244,239,231,0.58)", fontFamily: mono, fontSize: 8, lineHeight: 12, letterSpacing: 1.8, fontWeight: "800" },

  content: { flex: 1, zIndex: 4 },
  // grows to center the pitch when it fits, scrolls when large text makes it tall;
  // top padding always clears the brand/login bar.
  scrollNarrow: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingTop: 96, paddingBottom: 26 },
  scrollWideShort: { flexGrow: 1, justifyContent: "center", alignItems: "flex-start", paddingHorizontal: 72, paddingTop: 102, paddingBottom: 30 },
  scrollWideHero: { flexGrow: 1, justifyContent: "flex-end", alignItems: "flex-start", paddingHorizontal: 72, paddingTop: 102, paddingBottom: 30 },
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

  liveRail: {
    width: "100%", maxWidth: 700, marginTop: 14, padding: 14, gap: 12,
    borderWidth: 1, borderColor: "rgba(244,239,231,0.15)", borderRadius: radius.md,
    backgroundColor: "rgba(5,6,11,0.68)",
    ...Platform.select({ web: { backdropFilter: "blur(14px)", boxShadow: "0 12px 30px rgba(0,0,0,0.24)" } }),
  },
  liveRailCompact: { maxWidth: 360, padding: 11 },
  liveRailHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  liveRailEyebrow: { color: "#F2A65A", fontFamily: mono, fontSize: 8, lineHeight: 12, letterSpacing: 1.4, fontWeight: "900" },
  liveRailTitle: { color: "#F4EFE7", fontFamily: displayFont, fontSize: 16, lineHeight: 21, fontWeight: "900" },
  worldPill: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(242,166,90,0.38)", backgroundColor: "rgba(242,166,90,0.09)" },
  worldPillText: { color: "#F2A65A", fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  liveColumns: { flexDirection: "row", alignItems: "stretch", gap: 10 },
  liveColumnsCompact: { flexDirection: "column" },
  liveColumn: { flex: 1, minWidth: 0, gap: 6 },
  liveColumnLabel: { color: "rgba(244,239,231,0.52)", fontFamily: mono, fontSize: 7.5, fontWeight: "900", letterSpacing: 1.1 },
  liveRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(244,239,231,0.1)", backgroundColor: "rgba(244,239,231,0.045)", ...Platform.select({ web: { cursor: "pointer" } }) },
  liveRowHovered: { borderColor: "rgba(242,166,90,0.42)", backgroundColor: "rgba(242,166,90,0.08)" },
  liveRowFocused: { borderColor: "#F2A65A", borderWidth: 2 },
  liveRowIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(242,166,90,0.11)" },
  liveRowIconLounge: { backgroundColor: "rgba(231,106,153,0.12)" },
  liveRowCopy: { flex: 1, minWidth: 0 },
  liveRowTitle: { color: "#F4EFE7", fontFamily: displayFont, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  liveRowDetail: { color: "rgba(244,239,231,0.58)", fontSize: 9.5, lineHeight: 14, marginTop: 1 },
  loungeExplainer: { flex: 1, minHeight: 106, flexDirection: "row", alignItems: "center", gap: 9, padding: 11, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(231,106,153,0.25)", backgroundColor: "rgba(231,106,153,0.06)", ...Platform.select({ web: { cursor: "pointer" } }) },
  loungeExplainerDetail: { color: "rgba(244,239,231,0.62)", fontSize: 10, lineHeight: 15, marginTop: 3 },

  feedbackLink: {
    minHeight: 44, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1,
    borderColor: "rgba(242,166,90,0.24)", backgroundColor: "rgba(5,6,11,0.38)",
  },
  feedbackLinkActive: { backgroundColor: "rgba(242,166,90,0.1)", borderColor: "rgba(242,166,90,0.48)" },
  feedbackLinkFocused: { borderColor: "#F2A65A", borderWidth: 2 },
  feedbackLinkText: { color: "rgba(244,239,231,0.76)", fontSize: 12, fontWeight: "800" },

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
