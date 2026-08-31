import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  ARTIST_MEMORIAL_SPOTLIGHT_MS,
  parseArtistMemorialAdminPayload,
} from "../../domain/artistMemorial.mjs";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../../theme";
import Button from "../Button";
import Icon from "../Icon";
import { claimArtistMemorialSpotlight } from "./artistMemorialSession.mjs";

function formatDeathDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return value;
  }
}

function memorialProjection(memorial, at) {
  if (!memorial || memorial.deceased !== true) return null;
  const parsed = parseArtistMemorialAdminPayload({
    status: "published",
    deathDate: memorial.deathDate,
    summary: memorial.summary,
    thankYou: memorial.thankYou,
    accomplishments: memorial.accomplishments,
    sourceUrl: memorial.citation?.url,
    sourceTitle: memorial.citation?.title,
    confirmedIndividual: true,
    restartSpotlight: false,
  }, { at });
  if (!parsed.valid) return null;

  const startedAt = Number(memorial.spotlight?.startedAt);
  const endsAt = Number(memorial.spotlight?.endsAt);
  const validWindow = Number.isSafeInteger(startedAt)
    && Number.isSafeInteger(endsAt)
    && startedAt >= 0
    && endsAt === startedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS;
  const {
    sourceUrl,
    sourceTitle,
    status: _status,
    confirmedIndividual: _confirmation,
    restartSpotlight: _restart,
    ...content
  } = parsed.payload;
  return {
    ...content,
    citation: { url: sourceUrl, title: sourceTitle },
    spotlightActive: validWindow && at >= startedAt && at < endsAt,
  };
}

function TributeCopy({ tribute, artistName, expanded = false, onOpenSource, sourceError }) {
  const shownAccomplishments = expanded ? tribute.accomplishments : tribute.accomplishments.slice(0, 3);
  return (
    <View style={styles.copy}>
      <View style={styles.eyebrowRow}>
        <Icon name="dove" size={20} color={colors.gold} strokeWidth={1.8} />
        <Text style={styles.eyebrow}>IN TRIBUTE</Text>
      </View>
      <Text accessibilityRole="header" style={[styles.title, expanded && styles.modalTitle]}>
        Remembering {artistName}
      </Text>
      <Text style={styles.date}>Died {formatDeathDate(tribute.deathDate)}</Text>
      <Text selectable style={styles.summary}>{tribute.summary}</Text>

      {expanded ? <Text style={styles.sectionLabel}>A LIFE IN MUSIC</Text> : null}
      <View style={styles.accomplishments}>
        {shownAccomplishments.map((item) => (
          <View key={item} style={styles.accomplishmentRow}>
            <View style={styles.accomplishmentDot} />
            <Text selectable style={styles.accomplishment}>{item}</Text>
          </View>
        ))}
      </View>

      {expanded ? (
        <View style={styles.thankYouCard}>
          <Text style={styles.sectionLabel}>TRIBUTE MESSAGE</Text>
          <Text selectable style={styles.thankYou}>{tribute.thankYou}</Text>
        </View>
      ) : null}

      {expanded ? (
        <Pressable
          onPress={onOpenSource}
          accessibilityRole="link"
          accessibilityLabel={`Open memorial source${tribute.citation.title ? `: ${tribute.citation.title}` : ""}`}
          accessibilityHint="Opens the verified source outside Mshpit"
          style={({ pressed, focused }) => [styles.source, pressed && styles.pressed, focused && focusRing]}
        >
          <Icon name="external" size={16} color={colors.cool} />
          <Text style={styles.sourceText}>{tribute.citation.title || "Verified source"}</Text>
        </Pressable>
      ) : null}
      {expanded && sourceError ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.sourceError}>{sourceError}</Text>
      ) : null}
    </View>
  );
}

export default function ArtistMemorialTribute({
  artistKey,
  artistName,
  memorial,
  autoOpen = true,
  onOpenChange,
  style,
}) {
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const closeRef = useRef(null);
  const modalRef = useRef(null);
  const tribute = useMemo(() => memorialProjection(memorial, Date.now()), [memorial]);
  const identity = String(artistKey || artistName || "").trim();
  const displayName = String(artistName || artistKey || "this artist").trim();

  const setModalOpen = useCallback((next) => {
    setOpen(next);
    setSourceError("");
    onOpenChange?.(next);
  }, [onOpenChange]);

  useEffect(() => {
    if (!tribute || !autoOpen || !tribute.spotlightActive) return;
    if (claimArtistMemorialSpotlight(identity)) setModalOpen(true);
  }, [autoOpen, identity, setModalOpen, tribute]);

  useEffect(() => {
    if (!tribute && open) setModalOpen(false);
  }, [open, setModalOpen, tribute]);

  // RN Web's modal portal does not consistently keep keyboard focus inside the
  // dialog or return it to the opener. Native platforms use their accessibility
  // modal semantics; this small web-only bridge completes the same contract.
  useEffect(() => {
    if (!open || typeof document === "undefined" || typeof window === "undefined") return undefined;
    const root = modalRef.current;
    if (!root?.querySelectorAll) return undefined;
    const previous = document.activeElement;
    const focusable = () => Array.from(root.querySelectorAll(
      'button,[href],[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      !element.hasAttribute?.("disabled")
      && element.getAttribute?.("aria-disabled") !== "true"
      && element.getAttribute?.("aria-hidden") !== "true"
      && element.getClientRects?.().length > 0
    ));
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus?.());
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) return;
      const index = elements.indexOf(document.activeElement);
      const target = event.shiftKey
        ? (index <= 0 ? elements.length - 1 : index - 1)
        : (index < 0 || index >= elements.length - 1 ? 0 : index + 1);
      event.preventDefault();
      elements[target]?.focus?.();
    };
    root.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      root.removeEventListener("keydown", trapFocus);
      window.setTimeout(() => {
        if (previous?.isConnected) previous.focus?.();
      }, 0);
    };
  }, [open]);

  const openSource = useCallback(async () => {
    if (!tribute?.citation.url) return;
    setSourceError("");
    try {
      await Linking.openURL(tribute.citation.url);
    } catch {
      setSourceError("That source could not be opened right now. Please try again.");
    }
  }, [tribute]);

  if (!tribute) return null;

  return (
    <>
      <View style={[styles.card, shadow.card, style]}>
        <View style={styles.cardAccent} />
        <View style={styles.cardBody}>
          <TributeCopy tribute={tribute} artistName={displayName} />
          <Button
            title="Read the tribute"
            variant="secondary"
            icon="dove"
            small
            onPress={() => setModalOpen(true)}
            accessibilityHint={`Opens the full tribute to ${displayName}`}
            style={styles.readButton}
          />
        </View>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setModalOpen(false)}
        onShow={() => closeRef.current?.focus?.()}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            onPress={() => setModalOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            ref={modalRef}
            accessibilityViewIsModal
            onAccessibilityEscape={() => setModalOpen(false)}
            style={[styles.modalCard, shadow.sheet, { width: Math.min(620, Math.max(280, width - 32)) }]}
          >
            <Pressable
              ref={closeRef}
              onPress={() => setModalOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close artist tribute"
              style={({ pressed, focused }) => [styles.close, pressed && styles.pressed, focused && focusRing]}
            >
              <Icon name="x" size={20} color={colors.text} />
            </Pressable>
            <ScrollView
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <TributeCopy
                expanded
                tribute={tribute}
                artistName={displayName}
                onOpenSource={openSource}
                sourceError={sourceError}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.gold },
  cardBody: { padding: space(5), paddingLeft: space(6), gap: space(4), alignItems: "flex-start" },
  copy: { width: "100%", gap: space(2.5) },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  eyebrow: { color: colors.gold, fontFamily: mono, fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 1.6 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 22, lineHeight: 28, fontWeight: "900" },
  modalTitle: { fontSize: 30, lineHeight: 36, paddingRight: space(8) },
  date: { color: colors.textFaint, fontFamily: mono, fontSize: 11, lineHeight: 16, letterSpacing: 0.4 },
  summary: { color: colors.text, fontSize: 14.5, lineHeight: 22 },
  sectionLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, lineHeight: 14, fontWeight: "900", letterSpacing: 1.3, paddingTop: space(1) },
  accomplishments: { gap: space(2) },
  accomplishmentRow: { flexDirection: "row", alignItems: "flex-start", gap: space(2.5) },
  accomplishmentDot: { width: 5, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: colors.gold },
  accomplishment: { flex: 1, minWidth: 0, color: colors.textDim, fontSize: 13, lineHeight: 20 },
  thankYouCard: { gap: space(2), padding: space(4), borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surfaceAlt },
  thankYou: { color: colors.text, fontFamily: displayFont, fontSize: 17, lineHeight: 25, fontWeight: "700" },
  readButton: { alignSelf: "flex-start" },
  source: { minHeight: 44, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: space(2), borderRadius: radius.sm, paddingHorizontal: space(2), marginHorizontal: -space(2) },
  sourceText: { color: colors.cool, fontSize: 12.5, lineHeight: 18, fontWeight: "800", textDecorationLine: "underline" },
  sourceError: { color: colors.danger, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  modalRoot: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(4), backgroundColor: "rgba(0,0,0,0.72)" },
  modalCard: { maxHeight: "88%", overflow: "hidden", borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  modalContent: { padding: space(6), paddingTop: space(7), paddingBottom: space(7) },
  close: { position: "absolute", zIndex: 2, top: space(3), right: space(3), width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pressed: { opacity: 0.76 },
});
