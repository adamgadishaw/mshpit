import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, useWindowDimensions, Platform, ScrollView, AccessibilityInfo, PixelRatio } from "react-native";
import { Image as ExpoImage } from "expo-image";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { displayFont, focusRing, mono, radius } from "../theme";
import BrandMark from "../components/BrandMark";
import { PublicPressableLink } from "../components/PublicWebLinks";
import { useStore } from "../store";
import {
  LANDING_IDENTITY_COPY,
  LANDING_BROWSE_LINKS,
  landingLayoutMode,
} from "../domain/landingPresentation.mjs";
import {
  landingPhotoAfterFailure,
  normalizeLandingCommunityMedia,
} from "../domain/landingShowcase.mjs";
import { resolveLandingMediaPath } from "../features/landing/landingMediaService";
import useAppActive from "../lib/useAppActive";
import { previewSrc } from "../lib/img";

// ----------------------------------------------------------------------------
// The landing page says one thing and offers two ways in. Its only artwork is
// explicitly opted-in, safety-filtered member photos. The server supplies at
// most six stable derivatives through the startup payload already needed by
// the app; the client mounts one frame and warms only the next, so a phone
// never decodes the whole reel at once.
// ----------------------------------------------------------------------------

function LandingAction({ kind = "ghost", title, onPress, href, accessibilityHint, fullWidth = false, compact = false }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const primary = kind === "primary";
  const login = kind === "login";
  return (
    <PublicPressableLink
      href={href}
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      onNavigate={onPress}
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
      <Text style={[
        styles.actionText,
        primary ? styles.actionPrimaryText : styles.actionGhostText,
        login && styles.actionLoginText,
        compact && styles.actionTextCompact,
      ]}>{title}</Text>
    </PublicPressableLink>
  );
}

function WebPublicNav({ hidden = false }) {
  if (Platform.OS !== "web" || hidden) return null;
  return (
    <View style={styles.publicNav} accessibilityLabel="Public information">
      <Text href="/about" accessibilityRole="link" style={styles.publicNavLink}>About</Text>
    </View>
  );
}

// One quiet line: whose photo this is and which night it came from.
function LandingPhotoCredit({ frame, compact = false, floating = false }) {
  if (!frame) return null;
  const night = frame.artist && frame.venue ? `${frame.artist} at ${frame.venue}` : frame.artist || frame.venue || "";
  const label = [frame.credit, night].filter(Boolean).join(" \u00b7 ");
  return (
    <Text
      style={[styles.photoCredit, compact && styles.photoCreditCompact, floating && styles.photoCreditFloating]}
      numberOfLines={2}
      accessibilityLabel={`Photo: ${label}`}
    >
      {label}
    </Text>
  );
}

export default function LandingScreen({ session = null, onLogin, onSignup, onOpenFeed, onOpenYou, onBrowse, onBrowseCategory }) {
  const signedIn = !!session?.id;
  const { discoverySidebar } = useStore();
  const { width, height, fontScale } = useWindowDimensions();
  const { wide, compact, scrollPitch, overlayCredit } = landingLayoutMode({ width, height, fontScale });
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

  const [photoIndex, setPhotoIndex] = useState(0);
  const [failedPhotoIds, setFailedPhotoIds] = useState(() => new Set());
  const [displayedPhotoId, setDisplayedPhotoId] = useState(null);
  const [photoSourceState, setPhotoSourceState] = useState({ scope: "", stage: 0 });
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
  const landingPreviewWidth = Math.max(800, Math.min(2000, Math.ceil(width * PixelRatio.get() / 160) * 160));
  const landingSourceScope = `${currentLandingPhoto?.id || "none"}:${landingPreviewWidth}`;
  const landingSourceStage = photoSourceState.scope === landingSourceScope ? photoSourceState.stage : 0;
  const preferredLandingUri = currentLandingPhoto?.uri
    ? previewSrc(currentLandingPhoto.uri, landingPreviewWidth)
    : null;
  const currentLandingUri = landingSourceStage > 0
    ? currentLandingPhoto?.uri
    : preferredLandingUri;

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
    if (!appActive || reduceMotion || visibleLandingMedia.length < 2
      || displayedPhotoId !== currentLandingPhoto?.id) return undefined;
    const next = visibleLandingMedia[(photoIndex + 1) % visibleLandingMedia.length];
    const timer = setTimeout(() => {
      if (next?.uri) void ExpoImage.prefetch(previewSrc(next.uri, landingPreviewWidth), "disk").catch(() => {
        // architecture: allow-empty-catch -- warming the next optional photo is best-effort and must not interrupt the landing page.
      });
    }, wide ? 900 : 1400);
    return () => clearTimeout(timer);
  }, [appActive, currentLandingPhoto?.id, displayedPhotoId, landingPreviewWidth, photoIndex, reduceMotion, visibleLandingMedia, wide]);

  // The landing shell never changes component type when async content arrives.
  // It is always scrollable, while the viewport alone decides its alignment.
  const pitchContentStyle = wide
    ? (scrollPitch ? styles.scrollWideShort : styles.scrollWideHero)
    : [styles.scrollNarrow, compact && styles.scrollNarrowCompact];

  return (
    <View style={styles.wrap}>
      {/* ---- member photography, then neutral readability scrims ---- */}
      {!!currentLandingPhoto && (
        <ExpoImage
          source={{ uri: currentLandingUri }}
          contentFit="cover"
          cachePolicy="memory-disk"
          priority="high"
          loading="eager"
          allowDownscaling
          enforceEarlyResizing
          recyclingKey={`${currentLandingPhoto.id}:${currentLandingUri}`}
          transition={reduceMotion ? 0 : 450}
          accessible={false}
          onLoadStart={() => setDisplayedPhotoId(null)}
          onDisplay={() => setDisplayedPhotoId(currentLandingPhoto.id)}
          onError={() => {
            if (landingSourceStage === 0 && preferredLandingUri !== currentLandingPhoto.uri) {
              setPhotoSourceState({ scope: landingSourceScope, stage: 1 });
              return;
            }
            setFailedPhotoIds((current) => current.has(currentLandingPhoto.id)
              ? current
              : new Set([...current, currentLandingPhoto.id]));
          }}
          style={[StyleSheet.absoluteFill, styles.photoLayer]}
        />
      )}
      <Svg width="100%" height="100%" style={[StyleSheet.absoluteFill, styles.noPointerEvents]}>
        <Defs>
          <LinearGradient id="scrimV" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#05060B" stopOpacity="0.78" />
            <Stop offset="0.3" stopColor="#05060B" stopOpacity="0.2" />
            <Stop offset="0.58" stopColor="#05060B" stopOpacity="0.36" />
            <Stop offset="1" stopColor="#05060B" stopOpacity="0.96" />
          </LinearGradient>
          <LinearGradient id="scrimH" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#05060B" stopOpacity="0.86" />
            <Stop offset="0.48" stopColor="#05060B" stopOpacity="0.5" />
            <Stop offset="0.8" stopColor="#05060B" stopOpacity="0.08" />
            <Stop offset="1" stopColor="#05060B" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="scrimCenter" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#05060B" stopOpacity="0.3" />
            <Stop offset="0.5" stopColor="#05060B" stopOpacity="0.62" />
            <Stop offset="1" stopColor="#05060B" stopOpacity="0.3" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#scrimV)" />
        <Rect x="0" y="0" width="100%" height="100%" fill={wide ? "url(#scrimH)" : "url(#scrimCenter)"} />
      </Svg>

      {/* ---- top bar: brand + account entry ---- */}
      <View style={[styles.topbar, scrollPitch && styles.topbarScrolled, compact && styles.topbarCompact, styles.boxNonePointerEvents]}>
        <View style={styles.brandLockup} accessibilityRole="text" accessibilityLabel="Mshpit, live music remembered">
          <BrandMark size={34} />
          <Text style={styles.brand}>MSHPIT</Text>
        </View>
        <WebPublicNav hidden={compact} />
        <LandingAction
          kind="login"
          title={signedIn ? "You" : "Log in"}
          href={signedIn ? "/you" : "/login"}
          onPress={signedIn ? onOpenYou : onLogin}
          accessibilityHint={signedIn ? "Open your Mshpit profile" : "Opens the Mshpit sign-in form"}
        />
      </View>

      {/* ---- the pitch: one promise, two ways in ---- */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={pitchContentStyle}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustsScrollIndicatorInsets
      >
        <View style={[wide ? styles.blockWide : styles.blockNarrow, compact && styles.blockNarrowCompact]}>
          <Text
            style={[styles.headline, !wide && styles.headlineNarrow, compact && styles.headlineCompact]}
            accessibilityRole="header"
          >
            {compact ? LANDING_IDENTITY_COPY.compactHeadline : LANDING_IDENTITY_COPY.headline}
          </Text>
          <Text style={[styles.sub, !wide && styles.subNarrow, compact && styles.subCompact]}>
            {LANDING_IDENTITY_COPY.body}
          </Text>

          <View style={[styles.ctas, !wide && styles.ctasNarrow, compact && styles.ctasCompact]}>
            <LandingAction
              kind="primary"
              title={signedIn ? "Open your feed" : LANDING_IDENTITY_COPY.signupAction}
              href={signedIn ? "/feed" : "/signup"}
              onPress={signedIn ? onOpenFeed : onSignup}
              fullWidth={compact}
              compact={compact}
              accessibilityHint={signedIn ? "Open your Mshpit feed" : "Create a Mshpit account to log your own shows"}
            />
            <LandingAction
              title={LANDING_IDENTITY_COPY.browseAction}
              href="/events"
              onPress={onBrowse}
              fullWidth={compact}
              compact={compact}
              accessibilityHint="Browse upcoming concerts without creating an account"
            />
          </View>

          <View style={[styles.browseLinks, !wide && styles.browseLinksCentered]} accessibilityLabel="Browse without an account">
            {LANDING_BROWSE_LINKS.map((item) => (
              <PublicPressableLink key={item.key} href={item.href} accessibilityLabel={`Browse ${item.label.toLowerCase()}`} onNavigate={() => onBrowseCategory?.(item.key)}
                style={({ focused, pressed }) => [styles.browseLink, focused && focusRing, pressed && styles.actionPressed]}>
                <Text style={styles.browseLinkText}>{item.label}</Text>
              </PublicPressableLink>
            ))}
          </View>

          {!overlayCredit && <LandingPhotoCredit frame={currentLandingPhoto} compact={compact} />}
        </View>
      </ScrollView>
      {overlayCredit && <LandingPhotoCredit frame={currentLandingPhoto} floating />}
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
  publicNavLink: { color: "rgba(244,239,231,0.86)", fontSize: 14, lineHeight: 20, fontWeight: "700", textDecorationLine: "none" },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 10 },
  brand: {
    color: "#F4EFE7", fontFamily: mono, fontSize: 22, lineHeight: 23, fontWeight: "900", letterSpacing: 5,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 12px rgba(0,0,0,0.7)" } : { textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 12 }),
  },

  content: { flex: 1, minHeight: 0, zIndex: 4 },
  // grows to center the pitch when it fits, scrolls when large text makes it tall;
  // top padding always clears the brand/login bar.
  scrollNarrow: { flexGrow: 1, justifyContent: "flex-start", alignItems: "center", paddingHorizontal: 20, paddingTop: 96, paddingBottom: 64 },
  scrollNarrowCompact: { justifyContent: "center", paddingHorizontal: 16, paddingTop: 72, paddingBottom: 14 },
  scrollWideShort: { flexGrow: 1, justifyContent: "center", alignItems: "flex-start", paddingHorizontal: 72, paddingTop: 102, paddingBottom: 30 },
  scrollWideHero: { flexGrow: 1, justifyContent: "flex-end", alignItems: "flex-start", paddingHorizontal: 72, paddingTop: 102, paddingBottom: 64 },
  blockWide: { width: "100%", maxWidth: 760 },
  blockNarrow: { width: "100%", maxWidth: 560, alignItems: "center" },
  blockNarrowCompact: { maxWidth: 380 },

  headline: {
    color: "#FFFFFF", fontFamily: displayFont, fontSize: 64, lineHeight: 66, fontWeight: "900", letterSpacing: -1.6,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 18px rgba(0,0,0,0.55)" } : { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 18 }),
  },
  headlineNarrow: { fontSize: 46, lineHeight: 49, textAlign: "center" },
  headlineCompact: { fontSize: 36, lineHeight: 39, letterSpacing: -0.8 },
  sub: { color: "rgba(244,239,231,0.88)", fontSize: 18, lineHeight: 27, maxWidth: 540, marginTop: 18 },
  subNarrow: { textAlign: "center" },
  subCompact: { fontSize: 15, lineHeight: 22, marginTop: 12, maxWidth: 360 },

  ctas: { flexDirection: "row", gap: 12, marginTop: 28, flexWrap: "wrap" },
  ctasNarrow: { justifyContent: "center" },
  ctasCompact: { width: "100%", maxWidth: 360, flexDirection: "column", flexWrap: "nowrap", gap: 8, marginTop: 20 },
  action: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: 26,
    paddingVertical: 13,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "140ms", transitionProperty: "filter, transform, background-color" } }),
  },
  actionPrimary: { backgroundColor: "#FF8C42", borderColor: "#FF8C42" },
  actionGhost: { borderColor: "rgba(244,239,231,0.5)", backgroundColor: "rgba(5,6,11,0.42)" },
  actionLogin: {
    minHeight: 44,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderColor: "rgba(244,239,231,0.45)",
    backgroundColor: "rgba(5,6,11,0.48)",
  },
  actionFull: { width: "100%" },
  actionHovered: { transform: [{ translateY: -1 }], ...Platform.select({ web: { filter: "brightness(1.06)" } }) },
  actionPressed: { transform: [{ translateY: 1 }], opacity: 0.92 },
  actionText: { fontFamily: displayFont, fontSize: 16, lineHeight: 21, fontWeight: "900" },
  actionPrimaryText: { color: "#1A1206" },
  actionGhostText: { color: "#F4EFE7" },
  actionLoginText: { fontSize: 14 },
  actionTextCompact: { fontSize: 15, lineHeight: 20 },

  browseLinks: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 14 },
  browseLinksCentered: { justifyContent: "center" },
  browseLink: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: radius.sm },
  browseLinkText: {
    color: "rgba(244,239,231,0.82)", fontSize: 15, lineHeight: 20, fontWeight: "700",
    textDecorationLine: "underline", textDecorationColor: "rgba(244,239,231,0.35)",
  },

  photoCredit: { marginTop: 18, maxWidth: 520, color: "rgba(244,239,231,0.66)", fontSize: 12, lineHeight: 17 },
  photoCreditCompact: { maxWidth: 340, marginTop: 14, textAlign: "center" },
  photoCreditFloating: { position: "absolute", right: 28, bottom: 24, zIndex: 5, marginTop: 0, maxWidth: 360, textAlign: "right" },

  noPointerEvents: { pointerEvents: "none" },
  boxNonePointerEvents: { pointerEvents: "box-none" },
});
