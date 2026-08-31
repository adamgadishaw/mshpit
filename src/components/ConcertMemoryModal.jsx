import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, displayFont, mono, radius, shadow } from "../theme";
import { formatDate } from "../domain/dates.mjs";
import { mediaDisplayItems, mediaDisplayKind, mediaDisplayUri, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import Icon from "./Icon";
import SmartImage from "./SmartImage";
import Stars from "./Stars";
import RatingBreakdown from "./RatingBreakdown";
import RatingSplit from "./RatingSplit";

const text = (value) => typeof value === "string" ? value.trim() : "";

export default function ConcertMemoryModal({
  memory,
  gallery = null,
  galleryLoading = false,
  onClose,
  onShare,
  onOpenFull,
  onOpenPost,
}) {
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === "web" && width >= 900;
  const [mediaIndex, setMediaIndex] = useState(0);

  useEffect(() => setMediaIndex(0), [memory?.id]);
  if (!memory) return null;
  const log = memory.log || {};
  const mediaItems = Array.isArray(gallery) ? gallery : mediaDisplayItems(log);
  const mediaCount = mediaItems.length;
  const activeMediaIndex = mediaCount ? Math.min(mediaIndex, mediaCount - 1) : 0;
  const media = mediaItems[activeMediaIndex] || null;
  const mediaKind = mediaDisplayKind(media);
  const mediaUri = mediaKind === "video" ? mediaPosterUri(media) : mediaDisplayUri(media);
  const rating = Number.isFinite(Number(memory.rating)) && Number(memory.rating) > 0
    ? Number(memory.rating)
    : Number.isFinite(Number(log.overall)) && Number(log.overall) > 0 ? Number(log.overall) : null;
  const review = text(log.review) || text(log.caption) || text(log.text);
  const place = [memory.venue, memory.city].filter(Boolean).join(" · ");
  const mediaLabel = (mediaKind === "video" ? "Video" : "Photo") + " "
    + (activeMediaIndex + 1) + " of " + mediaCount + " from " + memory.artist;
  const ratingDims = log.dims && typeof log.dims === "object"
    ? Object.fromEntries(Object.entries(log.dims).map(([key, value]) => {
      const score = Number(value);
      return [key, Number.isFinite(score) ? Math.max(0, Math.min(5, score)) : 0];
    }))
    : {};
  const hasDetailedRatings = Object.values(ratingDims).some((value) => Number(value) > 0);
  const bandRating = Number(log.band) > 0 ? Number(log.band) : 0;
  const roomRating = Number(log.room) > 0 ? Number(log.room) : 0;
  const tags = Array.isArray(log.tags) ? log.tags.map(text).filter(Boolean).slice(0, 5) : [];
  const previousMedia = () => setMediaIndex((current) => (current - 1 + mediaCount) % mediaCount);
  const nextMedia = () => setMediaIndex((current) => (current + 1) % mediaCount);

  return (
    <Modal animationType={Platform.OS === "web" ? "fade" : "slide"} onRequestClose={onClose}
      presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <View style={[styles.overlay, desktop && styles.overlayDesktop]}>
        <Pressable accessibilityLabel="Close concert memory" accessibilityRole="button"
          onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView accessibilityLabel={`Concert memory for ${memory.artist}`} accessibilityViewIsModal edges={["bottom"]}
          onAccessibilityEscape={onClose} style={[styles.sheet, desktop && styles.sheetDesktop]}>
          <View style={[styles.handle, desktop && styles.handleDesktop]} />
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
              {media ? (
                <View style={styles.mediaStage}>
                  {mediaUri ? (
                    <SmartImage accessibilityLabel={mediaLabel} contain={mediaKind !== "image"}
                      mediaKind="image" style={styles.media} uri={mediaUri} />
                  ) : (
                    <View accessible accessibilityLabel={mediaLabel} accessibilityRole="image" style={styles.videoMemory}>
                      <View style={styles.videoMemoryIcon}><Icon name="play" size={20} color={colors.amber} /></View>
                      <Text style={styles.videoMemoryText}>VIDEO FROM THIS NIGHT</Text>
                    </View>
                  )}
                  {mediaCount > 1 ? (
                    <View style={styles.mediaControls}>
                      <Pressable accessibilityLabel="Previous event photo" accessibilityRole="button"
                        hitSlop={6} onPress={previousMedia} style={({ pressed }) => [styles.mediaButton, pressed && styles.pressed]}>
                        <Icon name="chevron-left" size={19} color={colors.text} />
                      </Pressable>
                      <Text accessibilityLiveRegion="polite" style={styles.mediaCount}>
                        {activeMediaIndex + 1} / {mediaCount}
                      </Text>
                      <Pressable accessibilityLabel="Next event photo" accessibilityRole="button"
                        hitSlop={6} onPress={nextMedia} style={({ pressed }) => [styles.mediaButton, pressed && styles.pressed]}>
                        <Icon name="chevron-right" size={19} color={colors.text} />
                      </Pressable>
                    </View>
                  ) : null}
                  {text(media.by) ? (
                    <Text style={styles.mediaCredit}>{media.ownerMedia ? "From your post" : "Photo by " + text(media.by)}</Text>
                  ) : null}
                </View>
              ) : galleryLoading ? (
                <View style={styles.galleryLoading}>
                  <Text style={styles.galleryLoadingText}>Loading public photos from this event...</Text>
                </View>
              ) : null}
              <View style={styles.ticketBody}>
                <Text style={styles.artist}>{memory.artist}</Text>
                <Text style={styles.venue}>{place}</Text>
                {rating ? <View style={styles.ratingRow}>
                  <Stars value={rating} size={18} gap={3} />
                  <Text style={styles.ratingValue}>{rating.toFixed(1)}</Text>
                </View> : null}
                <View style={styles.reviewBlock}>
                  <Text style={styles.reviewLabel}>YOUR POST</Text>
                  {text(log.tour) ? <Text style={styles.tourName}>{text(log.tour)}</Text> : null}
                  {review
                    ? <Text style={styles.review}>{review}</Text>
                    : <Text style={styles.quietNote}>You logged this show without a written review.</Text>}
                  {tags.length ? (
                    <View style={styles.tagRow}>
                      {tags.map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>)}
                    </View>
                  ) : null}
                  <Text style={styles.postSignals}>
                    {Math.max(0, Number(log.likes) || 0)} likes · {Math.max(0, Number(log.comments) || 0)} comments
                  </Text>
                  {onOpenPost && log.id ? (
                    <Pressable accessibilityLabel="Open your original post and comments" accessibilityRole="button"
                      onPress={() => onOpenPost(log)} style={({ pressed }) => [styles.openPost, pressed && styles.pressed]}>
                      <Text style={styles.openPostText}>Open your post</Text>
                      <Icon name="chevron-right" size={15} color={colors.amber} />
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.breakdown}>
                  <Text style={styles.reviewLabel}>YOUR RATING BREAKDOWN</Text>
                  {hasDetailedRatings
                    ? <RatingBreakdown dims={ratingDims} />
                    : (bandRating > 0 || roomRating > 0)
                      ? <RatingSplit band={bandRating} room={roomRating} />
                      : <Text style={styles.quietNote}>No detailed ratings were saved for this memory.</Text>}
                </View>
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
  overlayDesktop: { justifyContent: "center", paddingHorizontal: 24, paddingVertical: 32 },
  sheet: { width: "100%", maxWidth: 680, maxHeight: "92%", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderBottomWidth: 0, borderColor: colors.line, backgroundColor: colors.bgElev, overflow: "hidden", ...shadow.sheet },
  sheetDesktop: { maxHeight: "88%", borderRadius: radius.lg, borderBottomWidth: 1 },
  handle: { width: 42, height: 4, alignSelf: "center", marginTop: 9, borderRadius: 2, backgroundColor: colors.line },
  handleDesktop: { height: 0, marginTop: 0, opacity: 0 },
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
  mediaStage: { backgroundColor: colors.bg },
  media: { width: "100%", height: 210, backgroundColor: colors.surfaceAlt },
  videoMemory: { height: 150, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: colors.bg },
  videoMemoryIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  videoMemoryText: { color: colors.textFaint, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  mediaControls: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.surfaceAlt },
  mediaButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  mediaCount: { minWidth: 54, color: colors.textDim, fontFamily: mono, fontSize: 11, fontWeight: "900", textAlign: "center" },
  mediaCredit: { color: colors.textFaint, fontSize: 10.5, lineHeight: 16, paddingHorizontal: 14, paddingBottom: 10, textAlign: "center", backgroundColor: colors.surfaceAlt },
  galleryLoading: { minHeight: 86, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: colors.bg },
  galleryLoadingText: { color: colors.textDim, fontSize: 12, textAlign: "center" },
  ticketBody: { padding: 20 },
  artist: { color: colors.text, fontFamily: displayFont, fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  venue: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 5 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 14 },
  ratingValue: { color: colors.gold, fontFamily: mono, fontSize: 15, fontWeight: "900" },
  reviewBlock: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  reviewLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  tourName: { color: colors.amber, fontSize: 12.5, fontWeight: "800", marginTop: 7 },
  review: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 7 },
  quietNote: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 18 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  tag: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.surfaceAlt },
  tagText: { color: colors.textDim, fontSize: 10.5, fontWeight: "700" },
  postSignals: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, marginTop: 12 },
  openPost: { minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  openPostText: { color: colors.amber, fontSize: 12.5, fontWeight: "900" },
  breakdown: { gap: 13, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  actions: { flexDirection: "row", gap: 10, padding: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bgElev },
  secondaryAction: { minHeight: 48, minWidth: 108, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface },
  secondaryActionText: { color: colors.amber, fontSize: 13, fontWeight: "900" },
  primaryAction: { minHeight: 48, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.amberStrong },
  primaryActionText: { color: "#1A1206", fontSize: 13, fontWeight: "900" },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.45 },
});
