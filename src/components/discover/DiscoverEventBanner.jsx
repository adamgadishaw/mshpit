import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, displayFont, focusRing, font, mono, radius, shadow } from "../../theme";
import useReducedMotion from "../../hooks/useReducedMotion";
import { calendarDateKey } from "../../domain/dataPolicy.mjs";
import Icon from "../Icon";

const AUTO_ADVANCE_MS = 6_500;
const LICENSED_SOURCES = new Set(["licensed", "commons", "openverse"]);
const PROVIDER_SOURCES = new Set(["ticketmaster"]);

const safeAttributionUrl = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const licensedMediaAttribution = (media) => {
  const source = String(media?.source || "").trim().toLocaleLowerCase();
  if (!LICENSED_SOURCES.has(source)) return null;
  const creator = typeof media?.by === "string" ? media.by.trim() : "";
  const license = typeof media?.license === "string" ? media.license.trim() : "";
  const sourcePage = safeAttributionUrl(media?.sourcePage);
  const licenseUrl = safeAttributionUrl(media?.licenseUrl);
  return creator && license && sourcePage && licenseUrl ? { creator, license, sourcePage, licenseUrl } : null;
};

const providerMediaAttribution = (media) => {
  const source = String(media?.source || "").trim().toLocaleLowerCase();
  const provider = String(media?.provider || "").trim().toLocaleLowerCase();
  if (source !== "provider" || !PROVIDER_SOURCES.has(provider)) return null;
  const creator = typeof media?.by === "string" ? media.by.trim() : "";
  const sourcePage = safeAttributionUrl(media?.sourcePage);
  return creator && sourcePage ? { creator, sourcePage, provider } : null;
};

const dateLabel = (start, end) => {
  const format = (value) => {
    const key = calendarDateKey(value);
    if (key == null) return "Date to be announced";
    const year = Math.floor(key / 10_000);
    const month = Math.floor((key % 10_000) / 100);
    const day = key % 100;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, day, 12)));
  };
  const first = format(start);
  if (!end || end === start) return first;
  return `${first} – ${format(end)}`;
};

export default function DiscoverEventBanner({
  slides = [],
  compact = false,
  active = true,
  autoAdvanceMs = AUTO_ADVANCE_MS,
  onOpenEvent,
}) {
  const reduceMotion = useReducedMotion();
  const safeSlides = useMemo(() => (Array.isArray(slides) ? slides.slice(0, 8) : []), [slides]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(() => new Set());
  const [foreground, setForeground] = useState(() => AppState.currentState === "active");
  const current = safeSlides[index] || null;
  const candidateMedia = current?.media && !failed.has(current.id) ? current.media : null;
  const licensedSource = LICENSED_SOURCES.has(String(candidateMedia?.source || "").trim().toLocaleLowerCase());
  const providerSource = String(candidateMedia?.source || "").trim().toLocaleLowerCase() === "provider";
  const attribution = licensedMediaAttribution(candidateMedia) || providerMediaAttribution(candidateMedia);
  // Attribution is part of the display contract, not optional decoration. If a
  // licensed row somehow bypasses the domain normalizer without a usable source
  // link, fail closed to the branded event card instead of publishing the image.
  const media = (licensedSource || providerSource) && !attribution ? null : candidateMedia;

  useEffect(() => {
    setIndex((value) => safeSlides.length ? value % safeSlides.length : 0);
    setFailed(new Set());
  }, [safeSlides]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!active || !foreground || paused || reduceMotion || safeSlides.length < 2) return undefined;
    const delay = Math.max(4_500, Math.min(15_000, Number(autoAdvanceMs) || AUTO_ADVANCE_MS));
    const timer = setInterval(() => setIndex((value) => (value + 1) % safeSlides.length), delay);
    return () => clearInterval(timer);
  }, [active, autoAdvanceMs, foreground, paused, reduceMotion, safeSlides.length]);

  if (!current) return null;

  const move = (delta) => {
    if (safeSlides.length < 2) return;
    const next = (index + delta + safeSlides.length) % safeSlides.length;
    setPaused(true);
    setIndex(next);
    AccessibilityInfo.announceForAccessibility?.(`${safeSlides[next].title}, event ${next + 1} of ${safeSlides.length}`);
  };
  const photoAlt = media?.altText || `${current.title}${current.venue ? ` at ${current.venue}` : ""}`;
  const detail = [dateLabel(current.date, current.endDate), current.venue, current.place].filter(Boolean).join(" · ");
  const openAttribution = (url) => {
    if (Platform.OS === "web" || !url) return;
    void Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View style={[styles.shell, compact && styles.shellCompact]} accessible={false}>
      <View style={[styles.hero, compact && styles.heroCompact]} accessible={false}>
        <Pressable
          style={({ pressed, focused }) => [styles.eventAction, pressed && styles.heroPressed, focused && focusRing]}
          onPress={() => onOpenEvent?.(current.event)}
          disabled={!onOpenEvent}
          accessibilityRole={onOpenEvent ? "button" : "summary"}
          accessibilityState={{ disabled: !onOpenEvent }}
          accessibilityLabel={`Open ${current.title}. ${detail}`}
        >
          {media ? (
            <Image
              source={{ uri: media.uri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              enforceEarlyResizing
              transition={reduceMotion ? 0 : 220}
              recyclingKey={`${current.id}:${media.uri}`}
              accessibilityLabel={photoAlt}
              accessible={false}
              onError={() => setFailed((value) => new Set(value).add(current.id))}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.fallback]} accessible={false}>
              <View style={styles.fallbackGlowOne} />
              <View style={styles.fallbackGlowTwo} />
              <Icon name="calendar" size={compact ? 42 : 58} color="rgba(255,255,255,0.32)" />
            </View>
          )}
          <View pointerEvents="none" style={styles.scrim} />
          <View pointerEvents="none" style={styles.copy}>
            <Text style={styles.kicker}>{current.phase === "active" ? "HAPPENING NOW" : current.endDate && current.endDate !== current.date ? "FEATURED MULTI-DAY EVENT" : "UPCOMING LIVE"}</Text>
            <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={2}>{current.title}</Text>
            <Text style={styles.detail} numberOfLines={compact ? 2 : 1}>{detail}</Text>
            {media?.by && media.source === "fan" ? <Text style={styles.credit} numberOfLines={1}>{`Fan photo by ${media.by}`}</Text> : null}
          </View>
          {onOpenEvent ? (
            <View pointerEvents="none" style={styles.openPill}>
              <Text style={styles.openText}>VIEW EVENT</Text>
              <Icon name="chevron-right" size={14} color="#FFFFFF" />
            </View>
          ) : null}
        </Pressable>
        {attribution && media ? (
          <View style={styles.attributionGroup} accessible={false}>
            <Pressable
              href={Platform.OS === "web" ? attribution.sourcePage : undefined}
              onPress={() => openAttribution(attribution.sourcePage)}
              style={({ pressed, focused }) => [styles.attributionLink, styles.attributionSource, pressed && styles.attributionPressed, focused && focusRing]}
              accessibilityRole="link"
              accessibilityLabel={`Photo by ${attribution.creator}. Open original source.`}
            >
              <Text style={styles.attributionText} numberOfLines={2}>{attribution.creator} · Source</Text>
              <Icon name="external" size={12} color="rgba(255,255,255,0.82)" />
            </Pressable>
            {attribution.licenseUrl ? (
              <Pressable
                href={Platform.OS === "web" ? attribution.licenseUrl : undefined}
                onPress={() => openAttribution(attribution.licenseUrl)}
                style={({ pressed, focused }) => [styles.attributionLink, pressed && styles.attributionPressed, focused && focusRing]}
                accessibilityRole="link"
                accessibilityLabel={`Open ${attribution.license} license terms`}
              >
                <Text style={styles.attributionText} numberOfLines={1}>{attribution.license}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {safeSlides.length > 1 ? (
        <View style={styles.controls} accessibilityLabel="Featured event controls">
          <Pressable style={({ pressed, focused }) => [styles.control, pressed && styles.controlPressed, focused && focusRing]} onPress={() => move(-1)} accessibilityRole="button" accessibilityLabel="Previous featured event">
            <Icon name="chevron-left" size={18} color={colors.text} />
          </Pressable>
          <Pressable
            style={({ pressed, focused }) => [styles.autoplay, pressed && styles.controlPressed, focused && focusRing, reduceMotion && styles.autoplayDisabled]}
            onPress={() => setPaused((value) => !value)}
            disabled={reduceMotion}
            accessibilityRole="button"
            accessibilityState={{ disabled: reduceMotion }}
            accessibilityLabel={reduceMotion ? "Auto-play disabled by Reduce Motion" : paused ? "Play featured event slideshow" : "Pause featured event slideshow"}
          >
            <Text style={styles.autoplayText}>{reduceMotion ? "AUTO-PLAY OFF" : paused ? "PLAY" : "PAUSE"}</Text>
          </Pressable>
          <View style={styles.counter} accessible accessibilityLabel={`Event ${index + 1} of ${safeSlides.length}`}>
            <Text style={styles.counterText}>{index + 1} / {safeSlides.length}</Text>
          </View>
          <Pressable style={({ pressed, focused }) => [styles.control, pressed && styles.controlPressed, focused && focusRing]} onPress={() => move(1)} accessibilityRole="button" accessibilityLabel="Next featured event">
            <Icon name="chevron-right" size={18} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { gap: 9 },
  shellCompact: { gap: 7 },
  hero: { minHeight: 300, overflow: "hidden", borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surfaceAlt, ...shadow.card },
  heroCompact: { minHeight: 250 },
  eventAction: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  heroPressed: { opacity: 0.94, transform: [{ scale: 0.995 }] },
  fallback: { alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: "#181224" },
  fallbackGlowOne: { position: "absolute", width: 380, height: 380, borderRadius: 190, top: -210, right: -80, backgroundColor: colors.amberStrong, opacity: 0.52 },
  fallbackGlowTwo: { position: "absolute", width: 300, height: 300, borderRadius: 150, bottom: -180, left: -90, backgroundColor: colors.magenta, opacity: 0.46 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(3,5,9,0.48)" },
  copy: { position: "absolute", left: 20, right: 20, bottom: 22, maxWidth: 700 },
  kicker: { color: "#FFB56B", fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 1.8 },
  title: { color: "#FFFFFF", fontFamily: displayFont, fontSize: 31, lineHeight: 36, fontWeight: "900", letterSpacing: -0.8, marginTop: 6 },
  titleCompact: { fontSize: 25, lineHeight: 30 },
  detail: { color: "rgba(255,255,255,0.88)", fontFamily: font, fontSize: 12.5, lineHeight: 18, fontWeight: "700", marginTop: 7, paddingRight: 92 },
  credit: { color: "rgba(255,255,255,0.68)", fontFamily: font, fontSize: 10.5, marginTop: 6, paddingRight: 92 },
  attributionGroup: { position: "absolute", top: 12, left: 12, right: 12, flexDirection: "row", alignItems: "flex-start", gap: 7 },
  attributionLink: { minHeight: 44, maxWidth: "48%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", backgroundColor: "rgba(3,5,9,0.76)" },
  attributionSource: { flexShrink: 1, maxWidth: "68%" },
  attributionPressed: { opacity: 0.78 },
  attributionText: { flexShrink: 1, color: "rgba(255,255,255,0.84)", fontFamily: font, fontSize: 9.5, lineHeight: 13, fontWeight: "700", textDecorationLine: "underline" },
  openPill: { position: "absolute", right: 16, bottom: 18, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.34)", backgroundColor: "rgba(3,5,9,0.7)" },
  openText: { color: "#FFFFFF", fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  controls: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 7 },
  control: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  controlPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  autoplay: { minWidth: 94, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  autoplayDisabled: { opacity: 0.64 },
  autoplayText: { color: colors.text, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.7 },
  counter: { minWidth: 48, minHeight: 32, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: colors.bgElev },
  counterText: { color: colors.textDim, fontFamily: mono, fontSize: 9.5, fontWeight: "900", fontVariant: ["tabular-nums"] },
});
