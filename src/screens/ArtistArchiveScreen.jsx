import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useStore } from "../store";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";
import Stars from "../components/Stars";
import Icon from "../components/Icon";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import {
  archiveCoverMedia,
  archiveDateLabel,
  archiveDateRangeLabel,
  archiveRatingLabel,
  compactArchiveCount,
} from "../domain/artistEventArchive.mjs";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import { useArtistEventArchive } from "../features/artistEvents/useArtistEventArchive";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { openTicketLink } from "../lib/ticketLinks";

const list = (value) => Array.isArray(value) ? value : [];

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

function EmptyRow({ icon = "archive", title, copy }) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIcon}><Icon name={icon} size={21} color={colors.textFaint} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{copy}</Text>
    </View>
  );
}

function Cover({ cover, style, label, onOpenPhotos, onOpenProfile }) {
  const media = archiveCoverMedia(cover);
  if (!media) {
    return <View style={[styles.cover, styles.coverFallback, style]}><Icon name="photo" size={23} color={colors.textFaint} /></View>;
  }
  return (
    <View style={[styles.coverWrap, style]}>
      <SmartImage
        uri={media.uri}
        posterUri={media.posterUri}
        mediaKind={media.kind}
        style={styles.coverImage}
        contain={false}
        previewWidth={420}
        accessibilityLabel={label}
        onPress={() => onOpenPhotos?.([media], 0, media.postId)}
      />
      <Pressable
        style={({ pressed, focused }) => [styles.credit, pressed && styles.pressed, focused && focusRing]}
        onPress={() => media.userId && onOpenProfile?.(media.userId)}
        disabled={!media.userId || !onOpenProfile}
        accessibilityRole={media.userId && onOpenProfile ? "button" : "text"}
        accessibilityLabel={`Photo by ${media.by}${media.userId && onOpenProfile ? ", open profile" : ""}`}
      >
        <Icon name="camera" size={10} color="#FFFFFF" />
        <Text style={styles.creditText} numberOfLines={1}>{media.by}</Text>
      </Pressable>
    </View>
  );
}

function ShowRow({ show, rank = null, wide, onOpenShow, onOpenPhotos, onOpenProfile }) {
  const ratingCount = Math.max(0, Number(show?.ratingCount) || 0);
  const rating = archiveRatingLabel(show?.avgRating, ratingCount);
  return (
    <View style={[styles.showCard, rank === 1 && styles.showCardLead, wide && styles.showCardWide]}>
      <Cover
        cover={show?.cover}
        style={[styles.showCover, wide && styles.showCoverWide]}
        label={`Open fan media from ${show?.venue || "this performance"}`}
        onOpenPhotos={onOpenPhotos}
        onOpenProfile={onOpenProfile}
      />
      <Pressable
        style={({ pressed, focused }) => [styles.showAction, pressed && styles.pressed, focused && focusRing]}
        onPress={() => onOpenShow?.(show)}
        accessibilityRole="button"
        accessibilityLabel={`${rank ? `Number ${rank}, ` : ""}${show?.artist || "Artist"} at ${show?.venue || "venue"}, ${rating} stars from ${ratingCount} ratings`}
        accessibilityHint="Opens the performance page"
      >
        <View style={styles.showTopline}>
          {rank ? (
            <View style={[styles.rankPill, rank === 1 && styles.rankPillLead]}>
              <Icon name={rank === 1 ? "trophy" : "star"} size={11} color={rank === 1 ? colors.gold : colors.amber} />
              <Text style={[styles.rankText, rank === 1 && styles.rankTextLead]}>#{rank}</Text>
            </View>
          ) : <Text style={styles.showDate}>{archiveDateLabel(show?.date)}</Text>}
          <View style={styles.ratingPill}>
            <Icon name="star" size={11} color={colors.gold} />
            <Text style={styles.ratingText}>{rating}</Text>
          </View>
        </View>
        <Text style={styles.showVenue} numberOfLines={2}>{show?.venue || "Venue unavailable"}</Text>
        <Text style={styles.showPlace} numberOfLines={1}>{show?.place || "Location unavailable"} · {archiveDateLabel(show?.date)}</Text>
        <Text style={styles.showTour} numberOfLines={1}>{show?.tourName || "Live archive"}</Text>
        <View style={styles.signalRow}>
          <Text style={styles.signal}>{compactArchiveCount(ratingCount)} rating{ratingCount === 1 ? "" : "s"}</Text>
          <Text style={styles.signalDot}>·</Text>
          <Text style={styles.signal}>{compactArchiveCount(show?.reviewCount)} review{Number(show?.reviewCount) === 1 ? "" : "s"}</Text>
          <Text style={styles.signalDot}>·</Text>
          <Text style={styles.signal}>{compactArchiveCount(show?.mediaCount)} photo{Number(show?.mediaCount) === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.openLine}><Text style={styles.openText}>Open the night</Text><Icon name="chevron-right" size={15} color={colors.amber} /></View>
      </Pressable>
    </View>
  );
}

function TourRow({ tour, onOpenTour, onOpenPhotos, onOpenProfile }) {
  const cover = archiveCoverMedia(tour?.cover);
  const ratingCount = Math.max(0, Number(tour?.ratingCount) || 0);
  return (
    <View style={styles.tourCard}>
      <Cover
        cover={cover}
        style={styles.tourCover}
        label={`Open fan media from ${tour?.name || "this tour"}`}
        onOpenPhotos={onOpenPhotos}
        onOpenProfile={onOpenProfile}
      />
      <Pressable
        style={({ pressed, focused }) => [styles.tourAction, pressed && styles.pressed, focused && focusRing]}
        onPress={() => onOpenTour?.(tour)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${tour?.name || "tour"}, ${tour?.showCount || 0} shows and ${tour?.reviewCount || 0} reviews`}
      >
        <Text style={styles.tourName} numberOfLines={2}>{tour?.name || "Live archive"}</Text>
        <Text style={styles.tourDates}>{archiveDateRangeLabel(tour?.firstDate, tour?.lastDate)}</Text>
        <View style={styles.tourSignals}>
          <Text style={styles.tourSignal}>{compactArchiveCount(tour?.showCount)} shows</Text>
          <Text style={styles.tourSignal}>{compactArchiveCount(tour?.reviewCount)} reviews</Text>
          <Text style={styles.tourSignal}>{archiveRatingLabel(tour?.avgRating, ratingCount)} avg</Text>
        </View>
        <View style={styles.openLine}><Text style={styles.openText}>Explore tour</Text><Icon name="chevron-right" size={15} color={colors.amber} /></View>
      </Pressable>
    </View>
  );
}

function UpcomingRow({ show, artistName, onOpenShow }) {
  const hasTickets = /^https:\/\//i.test(show?.ticketUrl || "");
  return (
    <View style={styles.upcomingCard}>
      <Pressable
        style={({ pressed, focused }) => [styles.upcomingAction, pressed && styles.pressed, focused && focusRing]}
        onPress={() => onOpenShow?.(show)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${artistName} at ${show?.venue || "venue"}, ${archiveDateLabel(show?.date)}`}
      >
        <View style={styles.upcomingDate}><Icon name="calendar" size={15} color={colors.cool} /><Text style={styles.upcomingDateText}>{archiveDateLabel(show?.date)}</Text></View>
        <Text style={styles.upcomingVenue} numberOfLines={1}>{show?.venue || "Venue to be announced"}</Text>
        <Text style={styles.upcomingPlace} numberOfLines={1}>{show?.place || "Location to be announced"}</Text>
      </Pressable>
      {show?.soldOut ? (
        <View style={styles.soldOut}><Text style={styles.soldOutText}>SOLD OUT</Text></View>
      ) : hasTickets ? (
        <Pressable
          style={({ pressed, focused }) => [styles.ticketButton, pressed && styles.pressed, focused && focusRing]}
          onPress={() => { void openTicketLink(show.ticketUrl); }}
          accessibilityRole="link"
          accessibilityLabel={`Open tickets for ${artistName} at ${show?.venue || "this show"}`}
        >
          <Icon name="ticket" size={14} color="#1A1206" /><Text style={styles.ticketText}>Tickets</Text>
        </Pressable>
      ) : <Text style={styles.ticketSoon}>Tickets soon</Text>}
    </View>
  );
}

function Hero({ artistName, archive }) {
  const totals = archive?.totals || {};
  return (
    <View style={styles.hero}>
      <View style={styles.heroGlow} />
      <View style={styles.heroMark}><Icon name="archive" size={26} color={colors.amber} /></View>
      <View style={styles.heroCopy}>
        <Text style={styles.heroKicker}>THE LIVE RECORD</Text>
        <Text style={styles.heroTitle}>{artistName}</Text>
        <Text style={styles.heroText}>Every fan-rated night, the images people kept, and the tours that became part of the story.</Text>
      </View>
      <View style={styles.stats}>
        {[
          [totals.shows, "shows"],
          [totals.reviews, "reviews"],
          [totals.tours, "tours"],
          [totals.upcoming, "upcoming"],
        ].map(([value, label]) => (
          <View key={label} style={styles.stat}>
            <Text style={styles.statValue}>{compactArchiveCount(value)}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>
      {archive?.truncated && <Text style={styles.truncated}>This is a large archive, so the overview shows its newest window. Open a tour to continue through its complete review history.</Text>}
    </View>
  );
}

function buildRows(archive) {
  const topShows = list(archive?.topShows);
  const tours = list(archive?.tours);
  const upcoming = list(archive?.upcoming);
  const shows = list(archive?.shows);
  const rows = [];

  rows.push({ type: "section", key: "section-top", eyebrow: "HALL OF NIGHTS", title: "The top three", copy: "Confidence-weighted fan ratings reward nights with real community depth, not one perfect score.", count: topShows.length });
  if (topShows.length) topShows.forEach((show, index) => rows.push({ type: "top-show", key: `top:${show.key}`, show, rank: index + 1 }));
  else rows.push({ type: "empty", key: "empty-top", title: "The podium is still open", copy: "Once fans rate a few performances, the strongest nights will rise here." });

  rows.push({ type: "section", key: "section-tours", eyebrow: "TOUR SHELVES", title: "Browse by era", copy: "Open a tour to see its nights, fan media, and every review in one place.", count: tours.length });
  if (tours.length) tours.forEach((tour) => rows.push({ type: "tour", key: `tour:${tour.key}`, tour }));
  else rows.push({ type: "empty", key: "empty-tours", title: "No tours grouped yet", copy: "Historical nights will form tour shelves as the archive grows." });

  rows.push({ type: "section", key: "section-upcoming", eyebrow: "WORLDWIDE", title: "Coming up", copy: "Public dates across the global live calendar.", count: upcoming.length });
  if (upcoming.length) upcoming.forEach((show) => rows.push({ type: "upcoming", key: `upcoming:${show.id}`, show }));
  else rows.push({ type: "empty", key: "empty-upcoming", icon: "globe", title: "No public dates right now", copy: "Check back when the next run is announced." });

  rows.push({ type: "section", key: "section-history", eyebrow: "EVERY RECORDED NIGHT", title: "The full history", copy: "One card per performance, built from every eligible fan rating and public photo.", count: shows.length });
  if (shows.length) shows.forEach((show) => rows.push({ type: "show", key: `show:${show.key}`, show }));
  else rows.push({ type: "empty", key: "empty-history", title: "No nights recorded yet", copy: "The first concert log will start this artist’s live archive." });
  return rows;
}

export default function ArtistArchiveScreen({ artistName, artistKey, onClose, onOpenShow, onOpenTour, onOpenPhotos, onOpenProfile }) {
  const { session } = useStore();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const accountId = session?.id || null;
  const { resource, refresh: refreshArchive } = useArtistEventArchive({ accountId, name: artistName, artistKey });
  const [refreshError, setRefreshError] = useState("");
  const artistArchiveRefreshScope = refreshScope(accountId, "artist-archive", artistKey || artistName || "unknown");
  const { refresh: refreshArchiveView, refreshing } = useScopedRefresh({
    scope: artistArchiveRefreshScope,
    task: async ({ signal }) => {
      setRefreshError("");
      return refreshArchive({ signal });
    },
    onError: () => setRefreshError("The archive could not refresh. Showing the last complete view."),
  });
  const archive = resource.data;
  const rows = useMemo(() => buildRows(archive), [archive]);
  const initialLoading = resource.status === "loading" && resource.updatedAt == null;
  const initialError = resource.status === "error" && resource.updatedAt == null;

  const renderRow = ({ item }) => {
    if (item.type === "section") return <SectionRow {...item} />;
    if (item.type === "empty") return <EmptyRow {...item} />;
    if (item.type === "top-show") return <ShowRow show={item.show} rank={item.rank} wide={wide} onOpenShow={onOpenShow} onOpenPhotos={onOpenPhotos} onOpenProfile={onOpenProfile} />;
    if (item.type === "show") return <ShowRow show={item.show} wide={wide} onOpenShow={onOpenShow} onOpenPhotos={onOpenPhotos} onOpenProfile={onOpenProfile} />;
    if (item.type === "tour") return <TourRow tour={item.tour} onOpenTour={onOpenTour} onOpenPhotos={onOpenPhotos} onOpenProfile={onOpenProfile} />;
    if (item.type === "upcoming") return <UpcomingRow show={item.show} artistName={artistName} onOpenShow={onOpenShow} />;
    return null;
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="LIVE ARCHIVE" title={artistName || "Artist"} onBack={onClose} />
      {initialLoading ? (
        <View style={styles.center} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.amber} /><Text style={styles.stateText}>Opening the live archive…</Text></View>
      ) : initialError ? (
        <View style={styles.center} accessibilityLiveRegion="assertive">
          <Icon name="archive" size={27} color={colors.textFaint} />
          <Text style={styles.stateTitle}>The archive could not be loaded</Text>
          <Text style={styles.errorText} selectable>{resource.error?.message || "Check your connection and try again."}</Text>
          <Pressable style={({ focused, pressed }) => [styles.retry, pressed && styles.pressed, focused && focusRing]} onPress={refreshArchiveView} accessibilityRole="button" accessibilityLabel="Retry loading artist live archive"><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      ) : (
        <VinylRefreshBoundary
          refreshing={refreshing}
          onRefresh={refreshArchiveView}
          accessibilityLabel={`Refresh ${artistName || "artist"} live archive`}
          testID="artist-archive-refresh"
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
              <Hero artistName={archive?.artist?.name || artistName} archive={archive} />
              {(refreshError || (resource.status === "error" && resource.updatedAt != null)) && (
                <View style={styles.refreshWarning} accessibilityLiveRegion="assertive">
                  <Text style={styles.refreshWarningText} selectable>{refreshError || "The archive could not refresh. Showing the last complete view."}</Text>
                  <Pressable style={({ focused, pressed }) => [styles.inlineRetry, pressed && styles.pressed, focused && focusRing]} onPress={refreshArchiveView} accessibilityRole="button" accessibilityLabel="Retry refreshing artist live archive"><Text style={styles.inlineRetryText}>Retry</Text></Pressable>
                </View>
              )}
            </>
          )}
          ListFooterComponent={<View style={styles.listEnd}><Icon name="star" size={12} color={colors.gold} /><Text style={styles.listEndText}>Built from fan ratings and public media on Pit.</Text></View>}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
        />
        </VinylRefreshBoundary>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { width: "100%", maxWidth: 960, alignSelf: "center", padding: space(4), paddingBottom: space(14) },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 28 },
  stateTitle: { color: colors.text, fontFamily: displayFont, fontSize: 19, fontWeight: "900", textAlign: "center" },
  stateText: { color: colors.textDim, fontSize: 13, lineHeight: 19, textAlign: "center" },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 520 },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, marginTop: 5 },
  retryText: { color: colors.amber, fontWeight: "900", fontSize: 13 },
  pressed: { opacity: 0.76 },

  hero: { position: "relative", overflow: "hidden", gap: 14, padding: 20, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, ...shadow.card },
  heroGlow: { position: "absolute", width: 240, height: 240, borderRadius: 120, top: -130, right: -70, backgroundColor: `${colors.amberStrong}24` },
  heroMark: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface },
  heroCopy: { maxWidth: 700, gap: 4 },
  heroKicker: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.8 },
  heroTitle: { color: colors.text, fontFamily: displayFont, fontSize: 30, lineHeight: 35, fontWeight: "900", letterSpacing: -0.8 },
  heroText: { color: colors.textDim, fontSize: 14, lineHeight: 21, maxWidth: 680 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexGrow: 1, minWidth: 110, gap: 2, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  statValue: { color: colors.text, fontFamily: displayFont, fontSize: 20, fontWeight: "900", fontVariant: ["tabular-nums"] },
  statLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  truncated: { color: colors.gold, fontSize: 11.5, lineHeight: 17 },
  refreshWarning: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginTop: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.bgElev },
  refreshWarningText: { flex: 1, color: colors.danger, fontSize: 11.5, lineHeight: 17 },
  inlineRetry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  inlineRetryText: { color: colors.amber, fontSize: 11.5, fontWeight: "900" },

  sectionRow: { flexDirection: "row", alignItems: "flex-end", gap: 14, paddingTop: 31, paddingBottom: 10 },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 1.5 },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 23, fontWeight: "900", letterSpacing: -0.5, marginTop: 3 },
  sectionText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 4, maxWidth: 680 },
  sectionCount: { color: colors.textFaint, fontFamily: mono, fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },

  coverWrap: { overflow: "hidden", position: "relative", backgroundColor: colors.bgElev },
  cover: { overflow: "hidden", backgroundColor: colors.bgElev },
  coverImage: { width: "100%", height: "100%" },
  coverFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.lineSoft },
  credit: { position: "absolute", left: 7, right: 7, bottom: 7, minHeight: 25, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.68)" },
  creditText: { flex: 1, color: "#FFFFFF", fontSize: 9.5, fontWeight: "800" },

  showCard: { overflow: "hidden", flexDirection: "row", minHeight: 164, marginBottom: 10, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, ...shadow.card },
  showCardLead: { borderColor: colors.gold },
  showCardWide: { minHeight: 176 },
  showCover: { width: 124, minHeight: 164, borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md },
  showCoverWide: { width: 190, minHeight: 176 },
  showAction: { flex: 1, minWidth: 0, justifyContent: "center", gap: 5, padding: 14 },
  showTopline: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  showDate: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, fontWeight: "800" },
  rankPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  rankPillLead: { borderColor: colors.gold },
  rankText: { color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "900" },
  rankTextLead: { color: colors.gold },
  ratingPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: colors.bgElev },
  ratingText: { color: colors.gold, fontFamily: mono, fontSize: 10.5, fontWeight: "900", fontVariant: ["tabular-nums"] },
  showVenue: { color: colors.text, fontFamily: displayFont, fontSize: 17, lineHeight: 21, fontWeight: "900" },
  showPlace: { color: colors.textDim, fontSize: 11.5, lineHeight: 16 },
  showTour: { color: colors.cool, fontSize: 11, fontWeight: "800" },
  signalRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 2 },
  signal: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5 },
  signalDot: { color: colors.line },
  openLine: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3 },
  openText: { color: colors.amber, fontSize: 11.5, fontWeight: "900" },

  tourCard: { overflow: "hidden", flexDirection: "row", minHeight: 136, marginBottom: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  tourCover: { width: 112, minHeight: 136 },
  tourAction: { flex: 1, minWidth: 0, justifyContent: "center", gap: 5, padding: 14 },
  tourName: { color: colors.text, fontFamily: displayFont, fontSize: 17, lineHeight: 21, fontWeight: "900" },
  tourDates: { color: colors.textDim, fontFamily: mono, fontSize: 9.5 },
  tourSignals: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tourSignal: { color: colors.textFaint, fontSize: 10, paddingVertical: 3, paddingHorizontal: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },

  upcomingCard: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 106, padding: 13, marginBottom: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  upcomingAction: { flex: 1, minWidth: 0, gap: 3, paddingVertical: 3 },
  upcomingDate: { flexDirection: "row", alignItems: "center", gap: 6 },
  upcomingDateText: { color: colors.cool, fontFamily: mono, fontSize: 10, fontWeight: "900" },
  upcomingVenue: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 2 },
  upcomingPlace: { color: colors.textDim, fontSize: 11.5 },
  ticketButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 13, borderRadius: radius.sm, backgroundColor: colors.amberStrong, borderWidth: 1, borderColor: colors.amber },
  ticketText: { color: "#1A1206", fontSize: 11.5, fontWeight: "900" },
  ticketSoon: { color: colors.textFaint, fontSize: 10.5, fontStyle: "italic" },
  soldOut: { minHeight: 40, justifyContent: "center", paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger },
  soldOutText: { color: colors.danger, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },

  emptyCard: { alignItems: "center", gap: 7, padding: 24, marginBottom: 8, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, backgroundColor: colors.bgElev },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "center" },
  emptyText: { color: colors.textDim, fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 520 },
  listEnd: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingTop: 28 },
  listEndText: { color: colors.textFaint, fontSize: 10.5, textAlign: "center" },
});
