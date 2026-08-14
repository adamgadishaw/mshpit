import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import Stars from "../components/Stars";
import Icon from "../components/Icon";
import VenuePhotoWidget from "../components/VenuePhotoWidget";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import MentionText from "../components/MentionText";
import SmartImage from "../components/SmartImage";
import { UpcomingEventCard } from "../components/VenueDiscoveryCards";
import { formatDate } from "../domain/dates.mjs";
import { venueRowWindow } from "../domain/venueDiscovery.mjs";

const REVIEW_BATCH = 8;
const HISTORY_BATCH = 12;

export default function VenueScreen({ venueName, onClose, onOpenShow, onOpenArtist, onReviewVenue, onOpenProfile, onOpenPhotos, onReport }) {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const {
    venueSummary, venueCoord, venueReviewsFor, loadVenueReviews, venueRating, venueTopPhotos,
    session, venuePhotos, venuePhotoState, loadVenuePhotos, userByHandle,
  } = useStore();
  const venue = venueSummary(venueName);
  const coord = venueCoord(venue.name);
  const photos = venuePhotos(venue.name);
  const photoState = venuePhotoState(venue.name);
  const reviews = venueReviewsFor(venue.name);
  const [visibleReviewCount, setVisibleReviewCount] = useState(REVIEW_BATCH);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(HISTORY_BATCH);

  useEffect(() => {
    setVisibleReviewCount(REVIEW_BATCH);
    setVisibleHistoryCount(HISTORY_BATCH);
    loadVenueReviews(venue.name);
    void loadVenuePhotos(venue.name).catch(() => {});
  }, [venue.name]);

  const fanRating = venueRating(venue.name);
  const gridPhotos = venueTopPhotos(venue.name, wide ? 24 : 18);
  const reviewWindow = venueRowWindow(reviews, visibleReviewCount, REVIEW_BATCH);
  const historyWindow = venueRowWindow(venue.nights, visibleHistoryCount, HISTORY_BATCH);
  const visibleReviews = reviewWindow.rows;
  const visibleNights = historyWindow.rows;
  const onMention = (handle) => {
    const user = userByHandle(handle);
    if (user) onOpenProfile?.(user.id);
  };
  const openPhotoWidget = photos.length ? () => onOpenPhotos?.(photos, 0) : undefined;

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="VENUE GUIDE" title={venue.name} onBack={onClose} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroShell}>
          <VenuePhotoWidget
            photos={photos}
            venueName={venue.name}
            city={venue.place}
            coord={coord}
            loading={photoState.status === "idle" || photoState.status === "loading"}
            error={photoState.status === "error"}
            onRetry={() => { void loadVenuePhotos(venue.name, { force: true }).catch(() => {}); }}
            onPress={openPhotoWidget}
          />
          <View style={styles.heroMeta}>
            <View style={styles.placeRow}>
              <Icon name="pin" size={15} color={colors.amber} />
              <Text style={styles.place} selectable>{venue.place || "Location unavailable"}</Text>
            </View>
            {venue.capacity ? <Text style={styles.capacity}>{Number(venue.capacity).toLocaleString()} CAPACITY</Text> : null}
          </View>
        </View>

        <View style={styles.metrics}>
          <Metric value={venue.avgRoom > 0 ? venue.avgRoom.toFixed(1) : "—"} label="ROOM SCORE" icon="volume" accent={venue.avgRoom > 0} />
          <Metric value={fanRating > 0 ? fanRating.toFixed(1) : "—"} label="FAN SCORE" icon="star" />
          <Metric value={venue.totalShows} label="SHOWS LOGGED" icon="music" />
          <Metric value={venue.upcoming.length} label="UPCOMING" icon="calendar" accent={venue.upcoming.length > 0} />
        </View>

        {venue.upcoming.length > 0 ? (
          <Section title="Coming to this stage" kicker="UPCOMING HERE" count={venue.upcoming.length}>
            <View style={styles.stack}>
              {venue.upcoming.map((event) => (
                <UpcomingEventCard
                  key={event.id}
                  event={event}
                  onOpenArtist={() => onOpenArtist?.(event.artist)}
                  onTickets={() => { if (event.ticketUrl) void Linking.openURL(event.ticketUrl).catch(() => {}); }}
                />
              ))}
            </View>
          </Section>
        ) : (
          <View style={styles.noUpcoming}>
            <View style={styles.noUpcomingIcon}><Icon name="calendar" size={22} color={colors.textFaint} /></View>
            <View style={styles.flexCopy}>
              <Text style={styles.noUpcomingTitle}>No announced shows yet</Text>
              <Text style={styles.noUpcomingBody}>This venue has no released upcoming dates in the catalog.</Text>
            </View>
          </View>
        )}

        <Section title="The room, according to fans" kicker="ROOM REPUTATION">
          <View style={[styles.reputationGrid, wide && styles.reputationGridWide]}>
            <View style={styles.scorePanel}>
              <Text style={styles.scoreValue}>{venue.avgRoom > 0 ? venue.avgRoom.toFixed(1) : "—"}</Text>
              <Stars value={venue.avgRoom} size={18} color={colors.cool} />
              <Text style={styles.scoreLabel}>COMMUNITY ROOM SCORE</Text>
            </View>
            <View style={styles.reputationCopy}>
              <Text style={styles.reputationTitle}>{venue.totalShows > 0 ? `Built from ${venue.totalShows} logged ${venue.totalShows === 1 ? "show" : "shows"}` : "This room is waiting for its first concert log"}</Text>
              <Text style={styles.reputationBody}>Sound, sightlines and crowd energy stay with the venue—separate from the artist’s performance.</Text>
              <View style={styles.reviewSignal}>
                <Icon name="star" size={13} color={colors.gold} />
                <Text style={styles.reviewSignalText}>{reviews.length ? `${reviews.length} written ${reviews.length === 1 ? "review" : "reviews"} · ${fanRating.toFixed(1)} average` : "No written reviews yet"}</Text>
              </View>
            </View>
          </View>
          <Pressable
            style={({ pressed, focused }) => [styles.reviewButton, pressed && styles.buttonPressed, focused && focusRing]}
            onPress={() => onReviewVenue?.(venue.name)}
            accessibilityRole="button"
            accessibilityLabel={`Review ${venue.name}`}
          >
            <Icon name="edit" size={16} color="#1A1206" />
            <Text style={styles.reviewButtonText}>{reviews.length ? "Add your take" : "Write the first review"}</Text>
          </Pressable>
        </Section>

        {gridPhotos.length > 0 ? (
          <Section title="From the crowd" kicker="FAN PHOTOS" count={gridPhotos.length}>
            <View style={styles.photoGrid}>
              {gridPhotos.map((photo, index) => (
                <SmartImage
                  key={`${photo.uri}-${index}`}
                  uri={photo.uri}
                  style={[styles.photoTile, { width: wide ? "24%" : "31.5%" }]}
                  contain={false}
                  previewWidth={420}
                  accessibilityLabel={`Open fan photo ${index + 1} from ${venue.name}`}
                  onPress={() => onOpenPhotos?.(gridPhotos, index)}
                />
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="Fan notes" kicker="REVIEWS" count={reviews.length}>
          {reviews.length ? (
            <View style={styles.stack}>
              {visibleReviews.map((review) => (
                <View key={review.id} style={styles.reviewCard}>
                  <View style={styles.reviewHead}>
                    <Avatar user={{ initials: review.initials, name: review.name }} size={36} onPress={() => onOpenProfile?.(review.userId)} />
                    <View style={styles.flexCopy}>
                      <Text style={styles.reviewName}>{review.name}</Text>
                      <Text style={styles.reviewTime}>{review.ts || "Community review"}</Text>
                    </View>
                    {review.userId !== session?.id && onReport ? (
                      <Pressable
                        style={styles.reviewReportBtn}
                        onPress={() => onReport({
                          targetType: "venue_review",
                          targetId: review.id,
                          ownerId: review.userId,
                          targetName: "venue review",
                          title: `${review.name || "A member"}'s review of ${venue.name}`,
                          summary: review.text || `${Number(review.rating || 0).toFixed(1)} star venue review`,
                        })}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Report ${review.name || "this member"}'s venue review`}
                      >
                        <Icon name="flag" size={14} color={colors.textFaint} />
                      </Pressable>
                    ) : null}
                    <View style={styles.scorePill}>
                      <Icon name="star" size={11} color={colors.gold} />
                      <Text style={styles.scorePillText}>{Number(review.rating || 0).toFixed(1)}</Text>
                    </View>
                  </View>
                  {review.text ? <MentionText text={review.text} style={styles.reviewText} onMention={onMention} /> : null}
                  {review.photos?.length ? (
                    <View style={styles.reviewPhotos}>
                      {review.photos.map((uri, index) => (
                        <SmartImage
                          key={`${uri}-${index}`}
                          uri={uri}
                          style={styles.reviewPhoto}
                          contain={false}
                          previewWidth={240}
                          accessibilityLabel={`Open photo ${index + 1} from ${review.name}'s review of ${venue.name}`}
                          onPress={() => onOpenPhotos?.(review.photos.map((photoUri) => ({ uri: photoUri, by: review.name, venueReviewId: review.id, ownerId: review.userId })), index)}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
              {reviewWindow.remaining > 0 ? (
                <MoreButton
                  label={`Show ${Math.min(REVIEW_BATCH, reviewWindow.remaining)} more reviews`}
                  remaining={reviewWindow.remaining}
                  onPress={() => setVisibleReviewCount(reviewWindow.nextCount)}
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.emptyReviews}>
              <Icon name="comment" size={24} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>Nobody has described this room yet</Text>
              <Text style={styles.emptyBody}>Share the sound, view and crowd experience after your next show here.</Text>
            </View>
          )}
        </Section>

        <Section title="Concert history" kicker="SHOWS HERE" count={venue.nights.length}>
          {venue.nights.length ? (
            <View style={styles.stack}>
              {visibleNights.map((night) => (
                <Pressable
                  key={night.id}
                  style={({ pressed, hovered, focused }) => [styles.historyCard, hovered && styles.historyHover, pressed && styles.buttonPressed, focused && focusRing]}
                  onPress={() => onOpenShow?.(night)}
                  accessibilityRole="button"
                  accessibilityLabel={`${night.artist}, ${night.date === "aggregate" ? "community average" : formatDate(night.date, night.date)}, rated ${Number(night.overall || 0).toFixed(1)}`}
                >
                  <View style={styles.historyIcon}><Icon name="music" size={17} color={colors.amber} /></View>
                  <View style={styles.flexCopy}>
                    <Text style={styles.historyArtist}>{night.artist}</Text>
                    <Text style={styles.historyMeta}>{night.date === "aggregate" ? "Community average" : formatDate(night.date, night.date)}</Text>
                  </View>
                  <View style={styles.scorePill}>
                    <Icon name="star" size={11} color={colors.gold} />
                    <Text style={styles.scorePillText}>{Number(night.overall || 0).toFixed(1)}</Text>
                  </View>
                  <Icon name="chevron-right" size={17} color={colors.textFaint} />
                </Pressable>
              ))}
              {historyWindow.remaining > 0 ? (
                <MoreButton
                  label={`Show ${Math.min(HISTORY_BATCH, historyWindow.remaining)} more concerts`}
                  remaining={historyWindow.remaining}
                  onPress={() => setVisibleHistoryCount(historyWindow.nextCount)}
                />
              ) : null}
            </View>
          ) : (
            <Text style={styles.historyEmpty}>No concert history has been logged here yet.</Text>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

function Metric({ value, label, icon, accent = false }) {
  return (
    <View style={styles.metric}>
      <Icon name={icon} size={15} color={accent ? colors.amber : colors.textFaint} />
      <Text style={[styles.metricValue, accent && styles.metricValueAccent]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, kicker, count, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.flexCopy}>
          <Text style={styles.sectionKicker}>{kicker}</Text>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {Number.isFinite(count) ? <View style={styles.countPill}><Text style={styles.countText}>{count}</Text></View> : null}
      </View>
      {children}
    </View>
  );
}

function MoreButton({ label, remaining, onPress }) {
  return (
    <Pressable
      style={({ pressed, focused }) => [styles.moreButton, pressed && styles.buttonPressed, focused && focusRing]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${remaining} remaining.`}
    >
      <Text style={styles.moreButtonText}>{label}</Text>
      <Icon name="chevron-down" size={16} color={colors.amber} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { width: "100%", maxWidth: 980, alignSelf: "center", padding: 16, paddingBottom: 64, gap: 18 },
  heroShell: { padding: 8, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  heroMeta: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 8, paddingTop: 7 },
  placeRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
  place: { flexShrink: 1, color: colors.textDim, fontSize: 12 },
  capacity: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { flexGrow: 1, flexBasis: 150, minHeight: 82, alignItems: "center", justifyContent: "center", padding: 10, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  metricValue: { color: colors.text, fontFamily: mono, fontSize: 21, fontWeight: "900", fontVariant: ["tabular-nums"], marginTop: 3 },
  metricValueAccent: { color: colors.amber },
  metricLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.8, marginTop: 2 },
  section: { gap: 12 },
  sectionHeader: { minHeight: 46, flexDirection: "row", alignItems: "flex-end", gap: 12 },
  sectionKicker: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 21, fontWeight: "900", letterSpacing: -0.4, marginTop: 3 },
  countPill: { minWidth: 30, height: 28, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  countText: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "900", fontVariant: ["tabular-nums"] },
  stack: { gap: 10 },
  noUpcoming: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 13, padding: 15, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  noUpcomingIcon: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: colors.bgElev },
  noUpcomingTitle: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900" },
  noUpcomingBody: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 3 },
  reputationGrid: { gap: 10 },
  reputationGridWide: { flexDirection: "row" },
  scorePanel: { minWidth: 190, alignItems: "center", justifyContent: "center", padding: 18, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  scoreValue: { color: colors.cool, fontFamily: mono, fontSize: 43, lineHeight: 47, fontWeight: "900", fontVariant: ["tabular-nums"] },
  scoreLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.8, marginTop: 7 },
  reputationCopy: { flex: 1, justifyContent: "center", padding: 18, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  reputationTitle: { color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "900" },
  reputationBody: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 6 },
  reviewSignal: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  reviewSignalText: { color: colors.textFaint, fontSize: 11 },
  reviewButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.amberStrong, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.amber, borderBottomColor: colors.accentEdge, ...shadow.control, ...Platform.select({ web: { cursor: "pointer" } }) },
  reviewButtonText: { color: "#1A1206", fontFamily: displayFont, fontSize: 14, fontWeight: "900" },
  buttonPressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  photoTile: { aspectRatio: 1, borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft },
  reviewCard: { padding: 15, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, ...shadow.card },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  flexCopy: { flex: 1, minWidth: 0 },
  reviewName: { color: colors.text, fontFamily: displayFont, fontSize: 14, fontWeight: "900" },
  reviewTime: { color: colors.textFaint, fontSize: 10, marginTop: 2 },
  reviewReportBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: colors.lineSoft },
  scorePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  scorePillText: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  reviewText: { color: colors.text, fontSize: 14, lineHeight: 21, marginTop: 12 },
  reviewPhotos: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  reviewPhoto: { width: 82, height: 82, borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line },
  emptyReviews: { alignItems: "center", padding: 25, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  emptyTitle: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "900", textAlign: "center", marginTop: 10 },
  emptyBody: { maxWidth: 470, color: colors.textDim, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 5 },
  historyCard: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, ...Platform.select({ web: { cursor: "pointer", transitionDuration: "120ms", transitionProperty: "background-color, transform" } }) },
  historyHover: { backgroundColor: colors.surfaceAlt },
  historyIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  historyArtist: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900" },
  historyMeta: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  historyEmpty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", padding: 16, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  moreButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, ...Platform.select({ web: { cursor: "pointer" } }) },
  moreButtonText: { color: colors.amber, fontFamily: displayFont, fontSize: 13, fontWeight: "900" },
});
