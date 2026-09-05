import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useStore } from "../store";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import LegacyArtistArchiveGate from "../components/artist/LegacyArtistArchiveGate";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";
import Stars from "../components/Stars";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import {
  archiveCoverMedia,
  archiveDateLabel,
  archiveDateRangeLabel,
  archiveRatingLabel,
  archiveReviewMedia,
  compactArchiveCount,
  findArchiveShowForReview,
  selectArchiveTour,
  showsForArchiveTour,
} from "../domain/artistEventArchive.mjs";
import { mediaDisplayKind, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import { isLegacyArtistMemorial } from "../domain/artistLegacy.mjs";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import { useArtistEventArchive, useArtistEventReviews } from "../features/artistEvents/useArtistEventArchive";
import { useArtistMemorial } from "../features/artistMemorials/useArtistMemorial";
import useScopedRefresh from "../hooks/useScopedRefresh";

function TourHero({ artistName, tour, cover, fallbackName, onOpenPhotos, onOpenProfile }) {
  const media = archiveCoverMedia(cover);
  const ratingCount = Math.max(0, Number(tour?.ratingCount) || 0);
  return (
    <View style={styles.hero}>
      {media ? (
        <SmartImage
          uri={media.uri}
          posterUri={media.posterUri}
          mediaKind={media.kind}
          style={styles.heroImage}
          contain={false}
          previewWidth={640}
          accessibilityLabel={`Open cover media for ${tour?.name || fallbackName || "this tour"}`}
          onPress={() => onOpenPhotos?.([media], 0, media.postId)}
        />
      ) : <View style={[styles.heroImage, styles.heroImageEmpty]}><Icon name="archive" size={29} color={colors.textFaint} /></View>}
      <View style={styles.heroCopy}>
        <Text style={styles.heroKicker}>{artistName} · LIVE ARCHIVE</Text>
        <Text style={styles.heroTitle}>{tour?.name || fallbackName || "Tour archive"}</Text>
        <Text style={styles.heroDates}>{archiveDateRangeLabel(tour?.firstDate, tour?.lastDate)}</Text>
        <View style={styles.heroStats}>
          {[
            [tour?.showCount, "shows"],
            [tour?.reviewCount, "reviews"],
            [archiveRatingLabel(tour?.avgRating, ratingCount), "fan avg"],
          ].map(([value, label]) => <View key={label} style={styles.heroStat}><Text style={styles.heroStatValue}>{value ?? 0}</Text><Text style={styles.heroStatLabel}>{label}</Text></View>)}
        </View>
        {media ? (
          <Pressable
            style={({ pressed, focused }) => [styles.heroCredit, pressed && styles.pressed, focused && focusRing]}
            onPress={() => media.userId && onOpenProfile?.(media.userId)}
            disabled={!media.userId || !onOpenProfile}
            accessibilityRole={media.userId && onOpenProfile ? "button" : "text"}
            accessibilityLabel={`Tour cover by ${media.by}${media.userId && onOpenProfile ? ", open profile" : ""}`}
          >
            <Icon name="camera" size={11} color={colors.textDim} /><Text style={styles.heroCreditText}>Cover by {media.by}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function SectionRow({ eyebrow, title, copy, count }) {
  return (
    <View style={styles.sectionRow} accessibilityRole="header">
      <View style={styles.sectionCopy}>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!copy && <Text style={styles.sectionText}>{copy}</Text>}
      </View>
      {count != null && <Text style={styles.sectionCount}>{compactArchiveCount(count)}</Text>}
    </View>
  );
}

function TourShowRow({ show, wide, onOpenShow, onOpenPhotos, onOpenProfile }) {
  const media = archiveCoverMedia(show?.cover);
  const ratingCount = Math.max(0, Number(show?.ratingCount) || 0);
  return (
    <View style={styles.showCard}>
      {media ? (
        <SmartImage
          uri={media.uri}
          posterUri={media.posterUri}
          mediaKind={media.kind}
          style={[styles.showImage, wide && styles.showImageWide]}
          contain={false}
          previewWidth={360}
          accessibilityLabel={`Open media from ${show?.venue || "this show"}`}
          onPress={() => onOpenPhotos?.([media], 0, media.postId)}
        />
      ) : <View style={[styles.showImage, wide && styles.showImageWide, styles.showImageEmpty]}><Icon name="photo" size={20} color={colors.textFaint} /></View>}
      <Pressable
        style={({ pressed, focused }) => [styles.showAction, pressed && styles.pressed, focused && focusRing]}
        onPress={() => onOpenShow?.(show)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${show?.venue || "show"}, ${archiveDateLabel(show?.date)}, ${archiveRatingLabel(show?.avgRating, ratingCount)} stars`}
      >
        <Text style={styles.showDate}>{archiveDateLabel(show?.date)}</Text>
        <Text style={styles.showVenue} numberOfLines={1}>{show?.venue || "Venue unavailable"}</Text>
        <Text style={styles.showPlace} numberOfLines={1}>{show?.place || "Location unavailable"}</Text>
        <View style={styles.showSignals}>
          <Stars value={show?.avgRating} size={11} />
          <Text style={styles.showSignalText}>{archiveRatingLabel(show?.avgRating, ratingCount)} · {ratingCount} rating{ratingCount === 1 ? "" : "s"}</Text>
        </View>
      </Pressable>
      {media?.userId && onOpenProfile ? (
        <Pressable style={({ pressed, focused }) => [styles.photoOwner, pressed && styles.pressed, focused && focusRing]} onPress={() => onOpenProfile(media.userId)} accessibilityRole="button" accessibilityLabel={`Open ${media.by}'s profile`}>
          <Icon name="camera" size={10} color={colors.textFaint} /><Text style={styles.photoOwnerText} numberOfLines={1}>{media.by}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ReviewRow({ review, shows, wide, onOpenShow, onOpenPost, onOpenPhotos, onOpenProfile }) {
  const author = review?.user?.name || "A Pit fan";
  const handle = review?.user?.handle ? `@${review.user.handle}` : "Pit fan";
  const media = archiveReviewMedia(review);
  const thumbnail = media[0] || null;
  const show = findArchiveShowForReview(shows, review);
  const reviewText = String(review?.review || "").trim();
  return (
    <View style={[styles.reviewCard, wide && styles.reviewCardWide]}>
      <View style={styles.reviewMain}>
        <View style={styles.authorRow}>
          <Avatar user={review?.user || { name: author, initials: "PF" }} size={38} onPress={review?.userId && onOpenProfile ? () => onOpenProfile(review.userId) : undefined} />
          <Pressable
            style={({ pressed, focused }) => [styles.authorCopy, pressed && styles.pressed, focused && focusRing]}
            onPress={() => review?.userId && onOpenProfile?.(review.userId)}
            disabled={!review?.userId || !onOpenProfile}
            accessibilityRole={review?.userId && onOpenProfile ? "button" : "text"}
            accessibilityLabel={`Open ${author}'s profile`}
          >
            <Text style={styles.authorName} numberOfLines={1}>{author}</Text>
            <Text style={styles.authorHandle} numberOfLines={1}>{handle}</Text>
          </Pressable>
          <View style={styles.reviewScore}><Icon name="star" size={11} color={colors.gold} /><Text style={styles.reviewScoreText}>{Number(review?.overall || 0).toFixed(1)}</Text></View>
        </View>
        <Pressable
          style={({ pressed, focused }) => [styles.reviewAction, pressed && styles.pressed, focused && focusRing]}
          onPress={() => onOpenPost?.(review)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${author}'s review of ${review?.artist || "this artist"}`}
        >
          <Text style={[styles.reviewText, !reviewText && styles.reviewTextEmpty]} numberOfLines={wide ? 7 : 5}>{reviewText || "Rated this night without a written review."}</Text>
          <View style={styles.reviewSignals}>
            <View style={styles.reviewSignal}><Icon name="heart" size={11} color={colors.magenta} /><Text style={styles.reviewSignalText}>{compactArchiveCount(review?.likes)}</Text></View>
            <View style={styles.reviewSignal}><Icon name="comment" size={11} color={colors.cool} /><Text style={styles.reviewSignalText}>{compactArchiveCount(review?.comments)}</Text></View>
            <Text style={styles.reviewOpen}>Read post</Text>
          </View>
        </Pressable>
        <Pressable
          style={({ pressed, focused }) => [styles.nightLink, pressed && styles.pressed, focused && focusRing]}
          onPress={() => onOpenShow?.(show || review)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${review?.venue || "the show"}, ${archiveDateLabel(review?.date)}`}
        >
          <Icon name="calendar" size={12} color={colors.amber} />
          <Text style={styles.nightLinkText} numberOfLines={1}>{review?.venue || "Live show"} · {archiveDateLabel(review?.date)}</Text>
          <Icon name="chevron-right" size={13} color={colors.amber} />
        </Pressable>
      </View>
      {thumbnail ? (
        <SmartImage
          uri={thumbnail.uri}
          posterUri={mediaPosterUri(thumbnail)}
          mediaKind={mediaDisplayKind(thumbnail)}
          style={[styles.reviewImage, wide && styles.reviewImageWide]}
          contain={false}
          previewWidth={420}
          accessibilityLabel={`Open ${media.length} media item${media.length === 1 ? "" : "s"} from ${author}'s review`}
          onPress={() => onOpenPhotos?.(media, 0, review.id)}
        />
      ) : null}
    </View>
  );
}

function EmptyRow({ title, copy }) {
  return <View style={styles.emptyCard}><Icon name="comment" size={22} color={colors.textFaint} /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{copy}</Text></View>;
}

function buildRows(shows, reviews, reviewState, total) {
  const rows = [{ type: "section", key: "section-shows", eyebrow: "THE TOUR MAP", title: "Recorded nights", copy: "Each performance combines the crowd’s ratings and public media.", count: shows.length }];
  if (shows.length) shows.forEach((show) => rows.push({ type: "show", key: `show:${show.key}`, show }));
  else rows.push({ type: "empty", key: "empty-shows", title: "No nights found", copy: "This tour does not have a recorded performance in the current archive yet." });
  rows.push({ type: "section", key: "section-reviews", eyebrow: "FROM THE PIT", title: "Every review", copy: "The complete review stream for this tour, newest first.", count: total });
  if (reviews.length) reviews.forEach((review) => rows.push({ type: "review", key: `review:${review.id}`, review }));
  else if (reviewState === "loading") rows.push({ type: "loading", key: "loading-reviews" });
  else if (reviewState !== "error") rows.push({ type: "empty", key: "empty-reviews", title: "No reviews yet", copy: "The first fan to log this tour will start the conversation." });
  return rows;
}

export default function TourArchiveScreen({ artistName, artistKey, tourKey, tourName = null, onClose, onOpenShow, onOpenPost, onOpenPhotos, onOpenProfile }) {
  const { session } = useStore();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const accountId = session?.id || null;
  const { resource: memorialResource, availability: memorialAvailability, reload: retryMemorial } = useArtistMemorial({ accountId, artistKey });
  const legacyMode = isLegacyArtistMemorial(memorialResource.data);
  const archiveAllowed = memorialAvailability === "living" || (memorialAvailability === "deceased" && !legacyMode);
  const { resource: archiveResource, reload: reloadArchive, refresh: refreshArchive } = useArtistEventArchive({ accountId, name: artistName, artistKey, enabled: archiveAllowed });
  const { resource: reviewsResource, reload: reloadReviews, refresh: refreshReviews, loadMore } = useArtistEventReviews({ accountId, name: artistName, artistKey, tourKey, limit: 30, enabled: archiveAllowed });
  const [refreshError, setRefreshError] = useState("");
  const tourArchiveRefreshScope = refreshScope(
    accountId,
    "tour-archive",
    `${artistKey || artistName || "unknown"}:${tourKey || "unknown"}`,
  );
  const { refresh: refreshTourArchive, refreshing } = useScopedRefresh({
    scope: tourArchiveRefreshScope,
    task: async ({ signal }) => {
      setRefreshError("");
      const results = await Promise.allSettled([
        refreshArchive({ signal }),
        refreshReviews({ signal }),
      ]);
      if (signal.aborted) return null;
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      return results.map((result) => result.value);
    },
    onError: () => setRefreshError("The tour could not fully refresh. The last complete details remain on screen."),
  });
  const archive = archiveResource.data;
  const tour = selectArchiveTour(archive, tourKey);
  const shows = useMemo(() => showsForArchiveTour(archive, tourKey), [archive, tourKey]);
  const reviews = Array.isArray(reviewsResource.data?.reviews) ? reviewsResource.data.reviews : [];
  const total = Number(reviewsResource.data?.total) || tour?.reviewCount || 0;
  const rows = useMemo(() => buildRows(shows, reviews, reviewsResource.status, total), [reviews, reviewsResource.status, shows, total]);
  const initialArchiveLoading = archiveResource.status === "loading" && archiveResource.updatedAt == null;
  const initialArchiveError = archiveResource.status === "error" && archiveResource.updatedAt == null;
  const initialReviewError = reviewsResource.status === "error" && reviewsResource.updatedAt == null;
  const loadingMore = reviewsResource.data?.loadingMore === true;
  const nextCursor = reviewsResource.data?.nextCursor || null;

  const renderRow = ({ item }) => {
    if (item.type === "section") return <SectionRow {...item} />;
    if (item.type === "show") return <TourShowRow show={item.show} wide={wide} onOpenShow={onOpenShow} onOpenPhotos={onOpenPhotos} onOpenProfile={onOpenProfile} />;
    if (item.type === "review") return <ReviewRow review={item.review} shows={shows} wide={wide} onOpenShow={onOpenShow} onOpenPost={onOpenPost} onOpenPhotos={onOpenPhotos} onOpenProfile={onOpenProfile} />;
    if (item.type === "loading") return <View style={styles.loadingRow} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.amber} /><Text style={styles.stateText}>Loading every review…</Text></View>;
    if (item.type === "empty") return <EmptyRow title={item.title} copy={item.copy} />;
    return null;
  };

  const footer = initialReviewError ? (
    <View style={styles.errorCard} accessibilityLiveRegion="assertive">
      <Text style={styles.errorTitle}>Reviews could not be loaded</Text>
      <Text style={styles.errorText} selectable>{reviewsResource.error?.message || "Check your connection and try again."}</Text>
      <Pressable style={({ pressed, focused }) => [styles.retry, pressed && styles.pressed, focused && focusRing]} onPress={reloadReviews} accessibilityRole="button" accessibilityLabel="Retry loading tour reviews"><Text style={styles.retryText}>Try again</Text></Pressable>
    </View>
  ) : loadingMore ? (
    <View style={styles.loadingRow} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.amber} /><Text style={styles.stateText}>Loading more reviews…</Text></View>
  ) : reviewsResource.status === "error" && reviews.length ? (
    <View style={styles.errorCard} accessibilityLiveRegion="assertive">
      <Text style={styles.errorText} selectable>More reviews could not be loaded. The reviews already on screen are still available.</Text>
      {!!nextCursor && <Pressable style={({ pressed, focused }) => [styles.retry, pressed && styles.pressed, focused && focusRing]} onPress={loadMore} accessibilityRole="button" accessibilityLabel="Retry loading more tour reviews"><Text style={styles.retryText}>Try again</Text></Pressable>}
    </View>
  ) : nextCursor ? (
    <Pressable style={({ pressed, focused }) => [styles.loadMore, pressed && styles.pressed, focused && focusRing]} onPress={loadMore} accessibilityRole="button" accessibilityLabel="Load more tour reviews">
      <Text style={styles.loadMoreText}>Load more reviews</Text><Icon name="chevron-down" size={15} color={colors.amber} />
    </Pressable>
  ) : reviews.length ? <Text style={styles.complete}>You’ve reached every review currently available for this tour.</Text> : null;

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker={legacyMode ? "LEGACY ARTIST" : "TOUR ARCHIVE"} title={tour?.name || tourName || artistName || "Tour"} onBack={onClose} />
      {!archiveAllowed ? (
        <LegacyArtistArchiveGate
          artistName={artistName}
          state={legacyMode ? "legacy" : memorialAvailability === "checking" ? "checking" : "unavailable"}
          onBack={onClose}
          onRetry={retryMemorial}
        />
      ) : initialArchiveLoading ? (
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.amber} />
          <Text style={styles.stateTitle}>Opening the tour archive…</Text>
          <Text style={styles.stateText}>Gathering recorded nights, fan ratings, and tour media.</Text>
        </View>
      ) : <VinylRefreshBoundary
        refreshing={refreshing}
        onRefresh={refreshTourArchive}
        accessibilityLabel={`Refresh ${tour?.name || tourName || artistName || "tour"} archive`}
        testID="tour-archive-refresh"
      >
      <FlatList
        data={rows}
        renderItem={renderRow}
        keyExtractor={(item) => item.key}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={(
          <>
            <TourHero artistName={artistName} tour={tour} cover={tour?.cover} fallbackName={tourName} onOpenPhotos={onOpenPhotos} onOpenProfile={onOpenProfile} />
            {!!refreshError && (
              <View style={styles.archiveWarning} accessibilityLiveRegion="assertive">
                <Text style={styles.errorText} selectable>{refreshError}</Text>
                <Pressable style={({ pressed, focused }) => [styles.inlineRetry, pressed && styles.pressed, focused && focusRing]} onPress={refreshTourArchive} accessibilityRole="button" accessibilityLabel="Retry refreshing tour archive"><Text style={styles.inlineRetryText}>Retry refresh</Text></Pressable>
              </View>
            )}
            {initialArchiveError && (
              <View style={styles.archiveWarning} accessibilityLiveRegion="assertive">
                <Text style={styles.errorText} selectable>Tour details could not refresh. Reviews may still be available.</Text>
                <Pressable style={({ pressed, focused }) => [styles.inlineRetry, pressed && styles.pressed, focused && focusRing]} onPress={reloadArchive} accessibilityRole="button" accessibilityLabel="Retry loading tour details"><Text style={styles.inlineRetryText}>Retry details</Text></Pressable>
              </View>
            )}
          </>
        )}
        ListFooterComponent={<View style={styles.footer}>{footer}</View>}
        onEndReached={() => { if (nextCursor && !loadingMore && reviewsResource.status !== "error") void loadMore(); }}
        onEndReachedThreshold={0.35}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
      />
      </VinylRefreshBoundary>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { width: "100%", maxWidth: 960, alignSelf: "center", padding: space(4), paddingBottom: space(12) },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 9, padding: 28 },
  pressed: { opacity: 0.76 },
  stateTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900", textAlign: "center" },
  stateText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, textAlign: "center" },
  hero: { overflow: "hidden", flexDirection: "row", minHeight: 230, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, ...shadow.card },
  heroImage: { width: "38%", minWidth: 128, maxWidth: 300, minHeight: 230 },
  heroImageEmpty: { alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderRightColor: colors.lineSoft },
  heroCopy: { flex: 1, minWidth: 0, justifyContent: "center", gap: 6, padding: 19 },
  heroKicker: { color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  heroTitle: { color: colors.text, fontFamily: displayFont, fontSize: 25, lineHeight: 30, fontWeight: "900", letterSpacing: -0.6 },
  heroDates: { color: colors.textDim, fontFamily: mono, fontSize: 10.5, lineHeight: 16 },
  heroStats: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 5 },
  heroStat: { minWidth: 66, gap: 1, paddingVertical: 7, paddingHorizontal: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  heroStatValue: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  heroStatLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  heroCredit: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingRight: 8 },
  heroCreditText: { color: colors.textDim, fontSize: 10.5 },
  archiveWarning: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginTop: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.bgElev },
  inlineRetry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  inlineRetryText: { color: colors.amber, fontSize: 11.5, fontWeight: "900" },
  sectionRow: { flexDirection: "row", alignItems: "flex-end", gap: 14, paddingTop: 29, paddingBottom: 10 },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 1.5 },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 22, fontWeight: "900", letterSpacing: -0.45, marginTop: 3 },
  sectionText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 4, maxWidth: 680 },
  sectionCount: { color: colors.textFaint, fontFamily: mono, fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  showCard: { position: "relative", overflow: "hidden", flexDirection: "row", minHeight: 112, marginBottom: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  showImage: { width: 104, minHeight: 112 },
  showImageWide: { width: 148 },
  showImageEmpty: { alignItems: "center", justifyContent: "center" },
  showAction: { flex: 1, minWidth: 0, justifyContent: "center", gap: 4, padding: 12 },
  showDate: { color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "900" },
  showVenue: { color: colors.text, fontSize: 15, fontWeight: "900" },
  showPlace: { color: colors.textDim, fontSize: 11 },
  showSignals: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 2 },
  showSignalText: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5 },
  photoOwner: { position: "absolute", left: 6, bottom: 6, maxWidth: 136, minHeight: 24, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.7)" },
  photoOwnerText: { flex: 1, color: "#FFFFFF", fontSize: 8.5, fontWeight: "800" },
  reviewCard: { overflow: "hidden", flexDirection: "row", minHeight: 190, marginBottom: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, ...shadow.card },
  reviewCardWide: { minHeight: 204 },
  reviewMain: { flex: 1, minWidth: 0, gap: 9, padding: 14 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  authorCopy: { flex: 1, minWidth: 0, justifyContent: "center" },
  authorName: { color: colors.text, fontSize: 13.5, fontWeight: "900" },
  authorHandle: { color: colors.textFaint, fontSize: 10.5, marginTop: 1 },
  reviewScore: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 5, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: colors.bgElev },
  reviewScoreText: { color: colors.gold, fontFamily: mono, fontSize: 10.5, fontWeight: "900", fontVariant: ["tabular-nums"] },
  reviewAction: { gap: 7 },
  reviewText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  reviewTextEmpty: { color: colors.textDim, fontStyle: "italic" },
  reviewSignals: { flexDirection: "row", alignItems: "center", gap: 10 },
  reviewSignal: { flexDirection: "row", alignItems: "center", gap: 4 },
  reviewSignalText: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5 },
  reviewOpen: { color: colors.amber, fontSize: 10.5, fontWeight: "900", marginLeft: "auto" },
  nightLink: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  nightLinkText: { flex: 1, color: colors.textDim, fontSize: 10.5 },
  reviewImage: { width: 116, minHeight: 190 },
  reviewImageWide: { width: 190, minHeight: 204 },
  emptyCard: { alignItems: "center", gap: 7, padding: 24, marginBottom: 8, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, backgroundColor: colors.bgElev },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "center" },
  emptyText: { color: colors.textDim, fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 520 },
  loadingRow: { minHeight: 86, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  footer: { minHeight: 74, justifyContent: "center", paddingTop: 10 },
  errorCard: { alignItems: "center", gap: 9, padding: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.bgElev },
  errorTitle: { color: colors.text, fontSize: 14.5, fontWeight: "900" },
  errorText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 18, textAlign: "center" },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 17, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  retryText: { color: colors.amber, fontSize: 12, fontWeight: "900" },
  loadMore: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  loadMoreText: { color: colors.amber, fontSize: 13, fontWeight: "900" },
  complete: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17, textAlign: "center", padding: 16 },
});
