import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, displayFont, mono, radius, shadow } from "../theme";
import { formatDate } from "../domain/dates.mjs";
import { mediaDisplayItems, mediaDisplayKind, mediaDisplayUri, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import Icon from "./Icon";
import SmartImage from "./SmartImage";
import Stars from "./Stars";

const text = (value) => typeof value === "string" ? value.trim() : "";

export default function ConcertMemoryModal({ memory, onClose, onShare, onOpenFull }) {
  if (!memory) return null;
  const log = memory.log || {};
  const media = mediaDisplayItems(log)[0] || null;
  const mediaKind = mediaDisplayKind(media);
  const mediaUri = mediaKind === "video" ? mediaPosterUri(media) : mediaDisplayUri(media);
  const rating = Number.isFinite(Number(memory.rating)) && Number(memory.rating) > 0
    ? Number(memory.rating)
    : Number.isFinite(Number(log.overall)) && Number(log.overall) > 0 ? Number(log.overall) : null;
  const review = text(log.review) || text(log.caption) || text(log.text);
  const place = [memory.venue, memory.city].filter(Boolean).join(" · ");
  const mediaLabel = `${mediaKind === "video" ? "Video" : "Photo"} from ${memory.artist}`;

  return (
    <Modal animationType={Platform.OS === "web" ? "fade" : "slide"} onRequestClose={onClose}
      presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="Close concert memory" accessibilityRole="button"
          onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView accessibilityLabel={`Concert memory for ${memory.artist}`} accessibilityViewIsModal edges={["bottom"]}
          onAccessibilityEscape={onClose} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.topbar}>
            <View style={styles.topbarCopy}>
              <Text style={styles.kicker}>{memory.kind === "anniversary" ? "ANNIVERSARY" : "CONCERT MEMORY"}</Text>
              <Text style={styles.detail}>{memory.detail}</Text>
            </View>
            <Pressable accessibilityLabel="Close concert memory" accessibilityRole="button" hitSlop={10}
              onPress={onClose} style={styles.closeButton}>
              <Icon name="x" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.ticket}>
              <View style={styles.ticketHead}>
                <View style={styles.ticketMark}><Icon name="ticket" size={17} color="#1A1206" /></View>
                <Text style={styles.ticketBrand}>MSHPIT MEMORY</Text>
                <Text numberOfLines={2} style={styles.ticketDate}>{formatDate(memory.date, memory.date)}</Text>
              </View>
              {media ? mediaUri ? (
                <SmartImage accessibilityLabel={mediaLabel} contain={mediaKind !== "image"}
                  mediaKind="image" style={styles.media} uri={mediaUri} />
              ) : (
                <View accessible accessibilityLabel={mediaLabel} accessibilityRole="image" style={styles.videoMemory}>
                  <View style={styles.videoMemoryIcon}><Icon name="play" size={20} color={colors.amber} /></View>
                  <Text style={styles.videoMemoryText}>VIDEO FROM THIS NIGHT</Text>
                </View>
              ) : null}
              <View style={styles.ticketBody}>
                <Text style={styles.artist}>{memory.artist}</Text>
                <Text style={styles.venue}>{place}</Text>
                {rating ? <View style={styles.ratingRow}>
                  <Stars value={rating} size={18} gap={3} />
                  <Text style={styles.ratingValue}>{rating.toFixed(1)}</Text>
                </View> : null}
                {review ? <View style={styles.reviewBlock}>
                  <Text style={styles.reviewLabel}>WHAT YOU REMEMBERED</Text>
                  <Text style={styles.review}>{review}</Text>
                </View> : <Text style={styles.quietNote}>The show details are still part of your live-music history.</Text>}
              </View>
            </View>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable accessibilityLabel={`Share concert memory for ${memory.artist}`} accessibilityRole="button"
              accessibilityState={{ disabled: !onShare }} disabled={!onShare} onPress={() => onShare?.(memory)}
              style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed, !onShare && styles.disabled]}>
              <Icon name="share" size={16} color={colors.amber} /><Text style={styles.secondaryActionText}>Share</Text>
            </Pressable>
            <Pressable accessibilityLabel={`Open the full show breakdown for ${memory.artist}`} accessibilityRole="button"
              accessibilityState={{ disabled: !onOpenFull }} disabled={!onOpenFull} onPress={() => onOpenFull?.(memory.log)}
              style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed, !onOpenFull && styles.disabled]}>
              <Text style={styles.primaryActionText}>Full show breakdown</Text><Icon name="chevron-right" size={16} color="#1A1206" />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", alignItems: "center", paddingTop: 28, backgroundColor: "rgba(4,5,8,0.72)" },
  sheet: { width: "100%", maxWidth: 680, maxHeight: "92%", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderBottomWidth: 0, borderColor: colors.line, backgroundColor: colors.bgElev, overflow: "hidden", ...shadow.sheet },
  handle: { width: 42, height: 4, alignSelf: "center", marginTop: 9, borderRadius: 2, backgroundColor: colors.line },
  topbar: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  topbarCopy: { flex: 1, minWidth: 0 },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  detail: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  content: { padding: 16 },
  ticket: { borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface, overflow: "hidden", ...shadow.card },
  ticketHead: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  ticketMark: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong },
  ticketBrand: { flex: 1, color: colors.text, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  ticketDate: { maxWidth: "42%", color: colors.textDim, fontFamily: mono, fontSize: 10, fontWeight: "800", textAlign: "right", textTransform: "uppercase" },
  media: { width: "100%", height: 210, backgroundColor: colors.surfaceAlt },
  videoMemory: { height: 150, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: colors.bg },
  videoMemoryIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  videoMemoryText: { color: colors.textFaint, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  ticketBody: { padding: 20 },
  artist: { color: colors.text, fontFamily: displayFont, fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  venue: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 5 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 14 },
  ratingValue: { color: colors.gold, fontFamily: mono, fontSize: 15, fontWeight: "900" },
  reviewBlock: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  reviewLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  review: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 7 },
  quietNote: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 18 },
  actions: { flexDirection: "row", gap: 10, padding: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bgElev },
  secondaryAction: { minHeight: 48, minWidth: 108, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface },
  secondaryActionText: { color: colors.amber, fontSize: 13, fontWeight: "900" },
  primaryAction: { minHeight: 48, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.amberStrong },
  primaryActionText: { color: "#1A1206", fontSize: 13, fontWeight: "900" },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.45 },
});
