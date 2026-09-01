import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing, useWindowDimensions, Platform, ScrollView, AccessibilityInfo } from "react-native";
import { Image as ExpoImage } from "expo-image";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { displayFont, focusRing, mono, radius } from "../theme";
import BrandMark from "../components/BrandMark";
import Icon from "../components/Icon";
import { useStore } from "../store";
import {
  LANDING_IDENTITY_COPY,
  landingKicker,
  landingLayoutMode,
  landingProofItems,
} from "../domain/landingPresentation.mjs";
import { liveEventTitle } from "../domain/liveDiscovery.mjs";
import {
  landingPhotoAfterFailure,
  normalizeLandingCommunityMedia,
} from "../domain/landingShowcase.mjs";
import { HOME_JOURNEY_LINE } from "../domain/homeJourney.mjs";
import { resolveLandingMediaPath } from "../features/landing/landingMediaService";
import useAppActive from "../lib/useAppActive";

// ----------------------------------------------------------------------------
// The opening art is made from explicitly opted-in, safety-filtered member
// photos. The server supplies at most six stable derivatives through the same
// startup payload already needed by the landing page; the client mounts one
// frame and warms only the next so a phone never decodes the whole reel at once.
// ----------------------------------------------------------------------------

function LandingAction({ kind = "ghost", title, icon, onPress, accessibilityHint, fullWidth = false, compact = false }) {
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
        compact && styles.actionTextCompact,
      ]}>{title}</Text>
    </Pressable>
  );
}

function WebPublicNav({ hidden = false, compact = false }) {
  if (Platform.OS !== "web" || hidden) return null;
  return (
    <View style={[styles.publicNav, compact && styles.publicNavCompact]} accessibilityLabel="Public information">
      <Text href="/about" accessibilityRole="link" style={styles.publicNavLink}>About</Text>
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

function LandingPhotoCredit({ frame, compact = false }) {
  if (!frame) return null;
  const context = [frame.artist, frame.venue].filter(Boolean).join(" · ");
  return (
    <View style={[styles.photoCredit, compact && styles.photoCreditCompact]} accessibilityLabel={[frame.credit, context].filter(Boolean).join(". ")}>
      <View style={styles.photoCreditSource}>
        <View style={styles.photoCreditDot} />
        <Text style={styles.photoCreditSourceText}>FROM MSHPIT MEMBERS</Text>
      </View>
      <Text style={styles.photoCreditText} numberOfLines={1}>{frame.credit}</Text>
      {!!context && <Text style={styles.photoCreditContext} numberOfLines={1}>{context}</Text>}
    </View>
  );
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
  const { discoverySidebar } = useStore();
  const { width, height, fontScale } = useWindowDimensions();
  const { wide, compact, scrollPitch } = landingLayoutMode({ width, height, fontScale });
  const [reduceMotion, setReduceMotion] = useState(false);
  const appActive = useAppActive();

  useEffect(() => {
    let mounted = true;
    const preference = AccessibilityInfo.isReduceMotionEnabled?.();
    if (preference?.then) void preference.then((enabled) => {
      if (mounted) setReduceMotion(!!enabled);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (enabled) => setReduceMotion(!!enabled));
    return () => { mounted = false; subscription?.remove?.(); };
  }, []);

  const pulse = useRef(new Animated.Value(0)).current;
  const [photoIndex, setPhotoIndex] = useState(0);
  const [failedPhotoIds, setFailedPhotoIds] = useState(() => new Set());
  const landingMedia = useMemo(
    () => normalizeLandingCommunityMedia(discoverySidebar?.landingMedia, 6, { resolvePath: resolveLandingMediaPath }),
    [discoverySidebar?.landingMedia],
  );
  const landingMediaRevision = useMemo(
    () => landingMedia.map((item) => item.id).join("|"),
    [landingMedia],
  );
  const visibleLandingMedia = useMemo(
    () => landingPhotoAfterFailure(landingMedia, failedPhotoIds),
    [failedPhotoIds, landingMedia],
  );
  const currentLandingPhoto = visibleLandingMedia.length
    ? visibleLandingMedia[photoIndex % visibleLandingMedia.length]
    : null;

  useEffect(() => {
    setPhotoIndex((current) => visibleLandingMedia.length ? current % visibleLandingMedia.length : 0);
  }, [visibleLandingMedia.length]);

  useEffect(() => {
    if (!appActive) return;
    setFailedPhotoIds((current) => current.size ? new Set() : current);
  }, [appActive, landingMediaRevision]);

  useEffect(() => {
    if (!appActive || failedPhotoIds.size === 0) return undefined;
    const retry = setTimeout(() => setFailedPhotoIds(new Set()), 30_000);
    return () => clearTimeout(retry);
  }, [appActive, failedPhotoIds.size]);

  useEffect(() => {
    if (!appActive || reduceMotion || visibleLandingMedia.length < 2) return undefined;
    const timer = setTimeout(() => {
      setPhotoIndex((current) => (current + 1) % visibleLandingMedia.length);
    }, 7000);
    return () => clearTimeout(timer);
  }, [appActive, photoIndex, reduceMotion, visibleLandingMedia.length]);

  useEffect(() => {
    if (!appActive || reduceMotion || !wide || visibleLandingMedia.length < 2) return undefined;
    const next = visibleLandingMedia[(photoIndex + 1) % visibleLandingMedia.length];
    const timer = setTimeout(() => {
      if (next?.uri) void ExpoImage.prefetch(next.uri, "disk").catch(() => {
        // architecture: allow-empty-catch -- warming the next optional photo is best-effort and must not interrupt the landing page.
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [appActive, photoIndex, reduceMotion, visibleLandingMedia, wide]);

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

  const glowOp = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.58, 1] });
  // Reuse the StoreProvider's already-loaded, bounded public projection. The
  // landing screen itself performs no showcase or remote-media startup request.
  const catalogTotals = discoverySidebar?.catalogTotals;
  const proofItems = landingProofItems({
    artists: catalogTotals?.artists ?? null,
    venues: catalogTotals?.venues ?? null,
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
    : [styles.scrollNarrow, compact && styles.scrollNarrowCompact];

  return (
    <View style={styles.wrap}>
      {/* ---- member photography, then owned readability scrims ---- */}
      {!!currentLandingPhoto && (
        <ExpoImage
          source={{ uri: currentLandingPhoto.uri }}
          contentFit="cover"
          cachePolicy="memory-disk"
          priority="high"
          recyclingKey={currentLandingPhoto.id}
          transition={reduceMotion ? 0 : 450}
          accessible={false}
          onError={() => setFailedPhotoIds((current) => current.has(currentLandingPhoto.id)
            ? current
            : new Set([...current, currentLandingPhoto.id]))}
          style={[StyleSheet.absoluteFill, styles.photoLayer]}
        />
      )}
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
          <BrandMark size={34} />
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
        style={styles.content}
        contentContainerStyle={pitchContentStyle}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustsScrollIndicatorInsets
      >
        <View style={[wide ? styles.blockWide : styles.blockNarrow, compact && styles.blockNarrowCompact]}>
          <View style={[styles.kickerRow, !wide && styles.kickerRowNarrow, compact && styles.kickerRowCompact]}>
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
          <Text style={[styles.sub, !wide && { textAlign: "center" }, compact && styles.subCompact]}>
            {LANDING_IDENTITY_COPY.body}
          </Text>

          <View style={[styles.ctas, !wide && styles.ctasNarrow, compact && styles.ctasCompact]}>
            <LandingAction
              kind="primary"
              title={LANDING_IDENTITY_COPY.signupAction}
              icon="ticket"
              onPress={onSignup}
              fullWidth={compact}
              compact={compact}
              accessibilityHint="Creates a Mshpit account"
            />
            <LandingAction
              title={compact ? "Browse shows" : LANDING_IDENTITY_COPY.browseAction}
              icon="discover"
              onPress={onBrowse}
              fullWidth={compact}
              compact={compact}
              accessibilityHint="Opens Mshpit without creating an account"
            />
          </View>

          {!compact && <View
            style={[styles.journeyRail, compact && styles.journeyRailCompact]}
            accessibilityLabel={HOME_JOURNEY_LINE}
          >
            <Text style={styles.journeyEyebrow}>HOW MSHPIT WORKS</Text>
            <Text style={[styles.journeyLine, compact && styles.journeyLineCompact]}>{HOME_JOURNEY_LINE}</Text>
            <Text style={styles.journeyDetail}>Artist and venue ratings stay separate, so your recommendations are clearer.</Text>
          </View>}

          <View style={[styles.proofRail, compact && styles.proofRailCompact]} accessibilityLabel="Mshpit artist, venue, and rating features">
            {proofItems.map((item, index) => (
              <View
                key={item.key}
                style={[
                  styles.proofItem,
                  compact && styles.proofItemCompact,
                  index > 0 && (compact
                    ? styles.proofItemDividerCompact
                    : styles.proofItemDivider),
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

          <LandingPhotoCredit frame={currentLandingPhoto} compact={compact} />

          {!compact && hasLandingLive ? (
            <View style={[styles.liveRail, compact && styles.liveRailCompact]} accessibilityLabel="Worldwide live discovery on Mshpit">
              <View style={styles.liveRailHead}>
                <View style={styles.liveRailHeadCopy}>
                  <Text style={styles.liveRailEyebrow}>HAPPENING ON MSHPIT</Text>
                  <Text style={styles.liveRailTitle}>Upcoming concerts and show discussions</Text>
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

          {!compact && !!onSuggestion && (
            <Pressable
              style={({ pressed, hovered, focused }) => [
                styles.feedbackLink,
                (pressed || hovered) && styles.feedbackLinkActive,
                focused && styles.feedbackLinkFocused,
              ]}
              onPress={onSuggestion}
              accessibilityRole="button"
              accessibilityLabel="Tell Mshpit what would make you come back"
              accessibilityHint="Opens the anonymous suggestion box"
            >
              <Icon name="comment" size={14} color="#F2A65A" />
              <Text style={styles.feedbackLinkText}>What would make you come back?</Text>
              <Icon name="chevron-right" size={14} color="#F2A65A" />
            </Pressable>
          )}

        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, backgroundColor: "#05060B" },
  photoLayer: { backgroundColor: "#05060B" },

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
  brand: {
    color: "#F4EFE7", fontFamily: mono, fontSize: 22, lineHeight: 23, fontWeight: "900", letterSpacing: 5,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 12px rgba(0,0,0,0.7)" } : { textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 12 }),
  },
  brandSub: { color: "rgba(244,239,231,0.58)", fontFamily: mono, fontSize: 8, lineHeight: 12, letterSpacing: 1.8, fontWeight: "800" },

  content: { flex: 1, minHeight: 0, zIndex: 4 },
  // grows to center the pitch when it fits, scrolls when large text makes it tall;
  // top padding always clears the brand/login bar.
  scrollNarrow: { flexGrow: 1, justifyContent: "flex-start", alignItems: "center", paddingHorizontal: 20, paddingTop: 96, paddingBottom: 64 },
  scrollNarrowCompact: { justifyContent: "center", paddingHorizontal: 16, paddingTop: 72, paddingBottom: 14 },
  scrollWideShort: { flexGrow: 1, justifyContent: "center", alignItems: "flex-start", paddingHorizontal: 72, paddingTop: 102, paddingBottom: 30 },
  scrollWideHero: { flexGrow: 1, justifyContent: "flex-end", alignItems: "flex-start", paddingHorizontal: 72, paddingTop: 102, paddingBottom: 30 },
  blockWide: { width: "100%", maxWidth: 720 },
  blockNarrow: { width: "100%", maxWidth: 580, alignItems: "center" },
  blockNarrowCompact: { maxWidth: 380 },

  kickerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 15 },
  kickerRowNarrow: { justifyContent: "center" },
  kickerRowCompact: { gap: 8, marginBottom: 6 },
  kickerLine: { width: 36, height: 2, borderRadius: 2, backgroundColor: "#FF8C42", ...Platform.select({ web: { boxShadow: "0 0 14px rgba(255,140,66,0.85)" } }) },
  kicker: { color: "#F2A65A", fontFamily: mono, fontSize: 11, letterSpacing: 3.2, fontWeight: "900" },
  kickerCompact: { fontSize: 9, lineHeight: 12, letterSpacing: 1.8 },
  headline: {
    color: "#FFFFFF", fontFamily: displayFont, fontSize: 60, lineHeight: 62, fontWeight: "900", letterSpacing: -1.4,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 18px rgba(0,0,0,0.55)" } : { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 18 }),
  },
  headlineNarrow: { fontSize: 44, lineHeight: 47, textAlign: "center" },
  headlineCompact: { fontSize: 34, lineHeight: 36, letterSpacing: -0.6 },
  headlineAccent: { color: "#FF9A4F" },
  sub: { color: "rgba(244,239,231,0.84)", fontSize: 16, lineHeight: 24, maxWidth: 550, marginTop: 16 },
  subCompact: { fontSize: 13.5, lineHeight: 19, marginTop: 8, maxWidth: 360 },

  ctas: { flexDirection: "row", gap: 12, marginTop: 26, flexWrap: "wrap" },
  ctasNarrow: { justifyContent: "center" },
  ctasCompact: { width: "100%", maxWidth: 360, flexDirection: "column", flexWrap: "nowrap", gap: 7, marginTop: 14 },
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
  actionTextCompact: { fontSize: 13.5, lineHeight: 18 },

  journeyRail: {
    width: "100%",
    maxWidth: 700,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(242,166,90,0.38)",
    backgroundColor: "rgba(5,6,11,0.62)",
    gap: 3,
  },
  journeyRailCompact: { maxWidth: 360, paddingHorizontal: 14, paddingVertical: 12 },
  journeyEyebrow: { color: "#F2A65A", fontFamily: mono, fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.35 },
  journeyLine: { color: "#FFFFFF", fontFamily: displayFont, fontSize: 17, lineHeight: 22, fontWeight: "900", letterSpacing: -0.2 },
  journeyLineCompact: { fontSize: 14.5, lineHeight: 20, letterSpacing: -0.1 },
  journeyDetail: { color: "rgba(244,239,231,0.72)", fontSize: 12, lineHeight: 17 },

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
  proofRailCompact: { maxWidth: 360, flexDirection: "row", flexWrap: "nowrap", marginTop: 14 },
  proofItem: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 15, paddingVertical: 14 },
  proofItemCompact: { flex: 1, flexBasis: 0, minWidth: 0, minHeight: 78, flexDirection: "column", alignItems: "flex-start", gap: 5, paddingHorizontal: 8, paddingVertical: 8 },
  proofItemDivider: { borderLeftWidth: 1, borderLeftColor: "rgba(244,239,231,0.11)" },
  proofItemDividerCompact: { borderLeftWidth: 1, borderLeftColor: "rgba(244,239,231,0.11)" },
  proofIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(242,166,90,0.12)" },
  proofCopy: { flex: 1, minWidth: 0 },
  proofTitle: { color: "#F4EFE7", fontFamily: mono, fontSize: 10, lineHeight: 14, letterSpacing: 1.15, fontWeight: "900" },
  proofDetail: { color: "rgba(244,239,231,0.62)", fontSize: 11, lineHeight: 15, fontWeight: "600", marginTop: 1 },

  photoCredit: { width: "100%", maxWidth: 700, marginTop: 12, alignItems: "flex-start", gap: 1 },
  photoCreditCompact: { maxWidth: 360, marginTop: 9, alignItems: "center" },
  photoCreditSource: { flexDirection: "row", alignItems: "center", gap: 6 },
  photoCreditDot: { width: 5, height: 5, borderRadius: 5, backgroundColor: "#F2A65A" },
  photoCreditSourceText: { color: "#F2A65A", fontFamily: mono, fontSize: 8, lineHeight: 11, letterSpacing: 1.2, fontWeight: "900" },
  photoCreditText: { color: "rgba(244,239,231,0.82)", fontFamily: mono, fontSize: 9, lineHeight: 13 },
  photoCreditContext: { color: "rgba(244,239,231,0.58)", fontSize: 9, lineHeight: 13 },

  liveRail: {
    width: "100%", maxWidth: 700, marginTop: 14, padding: 14, gap: 12,
    borderWidth: 1, borderColor: "rgba(244,239,231,0.15)", borderRadius: radius.md,
    backgroundColor: "rgba(5,6,11,0.68)",
    ...Platform.select({ web: { backdropFilter: "blur(14px)", boxShadow: "0 12px 30px rgba(0,0,0,0.24)" } }),
  },
  liveRailCompact: { maxWidth: 360, padding: 11 },
  liveRailHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  liveRailHeadCopy: { flex: 1, minWidth: 0 },
  liveRailEyebrow: { color: "#F2A65A", fontFamily: mono, fontSize: 8, lineHeight: 12, letterSpacing: 1.4, fontWeight: "900" },
  liveRailTitle: { color: "#F4EFE7", fontFamily: displayFont, fontSize: 16, lineHeight: 21, fontWeight: "900" },
  worldPill: { flexShrink: 0, minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(242,166,90,0.38)", backgroundColor: "rgba(242,166,90,0.09)" },
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

  noPointerEvents: { pointerEvents: "none" },
  boxNonePointerEvents: { pointerEvents: "box-none" },
});
