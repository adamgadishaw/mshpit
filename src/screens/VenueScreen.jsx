import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";
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
import { VENUE_PAGE_SECTIONS, venuePagePreview, venuePageSectionModel, venuePhotoViewerIndex } from "../domain/venuePageSections.mjs";
import { openTicketLink } from "../lib/ticketLinks";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import { normalizeVenuePhotoProviderIdentity } from "../domain/venuePhotos.mjs";
import { venueGuideModel } from "../domain/venueGuide.mjs";
import ExpandableText from "../components/ExpandableText";

const REVIEW_BATCH = 8;
const HISTORY_BATCH = 12;
const UPCOMING_BATCH = 6;

export default function VenueScreen({ venueName, venueIdentity = null, onClose, onOpenShow, onOpenArtist, onReviewVenue, onOpenProfile, onOpenPhotos, onReport }) {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const {
    venueSummary, venueCoord, venueReviewsFor, loadVenueReviews, venueRating, venueTopPhotos,
    session, venuePhotos, venuePhotoState, loadVenuePhotos, venuePhotoPrivacyRevision, userByHandle,
  } = useStore();
  const venue = venueSummary(venueName);
  const photoIdentity = normalizeVenuePhotoProviderIdentity({
    source: venueIdentity?.source || venue.source,
    providerVenueId: venueIdentity?.providerVenueId || venueIdentity?.venue_provider_id || venue.providerVenueId,
  });
  const coord = venueCoord(venue.name);
  const venueGuide = venueGuideModel({ name: venue.name, place: venue.place, capacity: venue.capacity, coord });
  const photos = venuePhotos(venue.name, photoIdentity);
  const photoState = venuePhotoState(venue.name, photoIdentity);
  const reviews = venueReviewsFor(venue.name);
  const [visibleReviewCount, setVisibleReviewCount] = useState(REVIEW_BATCH);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(HISTORY_BATCH);
  const [visibleUpcomingCount, setVisibleUpcomingCount] = useState(UPCOMING_BATCH);
  const [venueGuideError, setVenueGuideError] = useState("");
  const [sectionSelection, setSectionSelection] = useState(() => ({ venueName: venue.name, section: "overview" }));
  const activeSection = sectionSelection.venueName === venue.name ? sectionSelection.section : "overview";
  const sectionModel = venuePageSectionModel(activeSection);
  const setActiveSection = (section) => setSectionSelection({ venueName: venue.name, section });

  useEffect(() => {
    const controller = new AbortController();
    setVisibleReviewCount(REVIEW_BATCH);
    setVisibleHistoryCount(HISTORY_BATCH);
    setVisibleUpcomingCount(UPCOMING_BATCH);
    void loadVenueReviews(venue.name, { signal: controller.signal });
    void loadVenuePhotos(venue.name, { ...photoIdentity, signal: controller.signal }).catch(() => { /* architecture: allow-empty-catch -- the venue page retains its licensed empty state and visible retry control */ });
    return () => controller.abort();
  }, [venue.name, photoIdentity?.source, photoIdentity?.providerVenueId, venuePhotoPrivacyRevision]);

  const fanRating = venueRating(venue.name);
  const fullGridPhotos = venueTopPhotos(venue.name, wide ? 24 : 18);
  const gridPhotos = venuePagePreview(fullGridPhotos, { condensed: true, limit: 3 });
  const reviewWindow = venueRowWindow(reviews, visibleReviewCount, REVIEW_BATCH);
  const historyWindow = venueRowWindow(venue.nights, visibleHistoryCount, HISTORY_BATCH);
  const upcomingWindow = venueRowWindow(venue.upcoming, visibleUpcomingCount, UPCOMING_BATCH);
  const visibleReviews = venuePagePreview(reviewWindow.rows, { condensed: sectionModel.condensed, limit: 2 });
  const visibleNights = historyWindow.rows;
  const visibleUpcoming = venuePagePreview(upcomingWindow.rows, { condensed: sectionModel.condensed, limit: 3 });
  const onMention = (handle) => {
    const user = userByHandle(handle);
    if (user) onOpenProfile?.(user.id);
  };
  const openPhotoWidget = photos.length
    ? (photo, fallbackIndex = 0) => onOpenPhotos?.(photos, venuePhotoViewerIndex(photos, photo, fallbackIndex))
    : undefined;
  const venueRefreshScope = refreshScope(session?.id, "venue", venue.name);
  const openVenueGuideAction = (action) => {
    setVenueGuideError("");
    if (Platform.OS === "web") return;
    void Linking.openURL(action.url).catch(() => setVenueGuideError(`${action.label} could not be opened on this device.`));
  };
  const { refresh: refreshVenue, refreshing: venueRefreshing } = useScopedRefresh({
    scope: venueRefreshScope,
    task: async ({ signal }) => {
      const [reviewResult, refreshedPhotos] = await Promise.all([
        loadVenueReviews(venue.name, { signal }),
        loadVenuePhotos(venue.name, { ...photoIdentity, force: true, signal }),
      ]);
      if (reviewResult?.ok === false && reviewResult?.error) throw reviewResult.error;
      return { reviewResult, refreshedPhotos };
    },
  });

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="VENUE GUIDE" title={venue.name} onBack={onClose} />
      <VinylRefreshBoundary
        refreshing={venueRefreshing}
        onRefresh={refreshVenue}
        accessibilityLabel={`Refresh ${venue.name} venue page`}
      >
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
            showDirections={false}
            onRetry={() => { void loadVenuePhotos(venue.name, { ...photoIdentity, force: true }).catch(() => { /* architecture: allow-empty-catch -- the visible retry state reports this optional gallery failure */ }); }}
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

        <VenuePageSectionNav active={activeSection} onChange={setActiveSection} />

        {sectionModel.showGuide ? (
          <Section title="Plan your visit" kicker="VENUE GUIDE">
            <VenueVisitGuide
              guide={venueGuide}
              wide={wide}
              error={venueGuideError}
              onOpen={openVenueGuideAction}
            />
          </Section>
        ) : null}

        {sectionModel.showUpcoming ? (
          venue.upcoming.length > 0 ? (
            <Section title="Upcoming shows" kicker="UPCOMING HERE" count={venue.upcoming.length}>
              <View style={styles.stack}>
                {visibleUpcoming.map((event) => (
                  <UpcomingEventCard
                    key={event.id}
                    event={event}
                    onOpenArtist={() => onOpenArtist?.(event.artist)}
                    onOpenEvent={() => onOpenShow?.(event)}
                    onTickets={() => { void openTicketLink(event.ticketUrl); }}
                  />
                ))}
                {sectionModel.condensed && venue.upcoming.length > visibleUpcoming.length ? (
                  <SectionSwitchButton
                    label={`See all ${venue.upcoming.length} upcoming shows`}
                    onPress={() => setActiveSection("shows")}
                  />
                ) : !sectionModel.condensed && upcomingWindow.remaining > 0 ? (
                  <MoreButton
                    label={`Show ${Math.min(UPCOMING_BATCH, upcomingWindow.remaining)} more upcoming shows`}
                    remaining={upcomingWindow.remaining}
                    onPress={() => setVisibleUpcomingCount(upcomingWindow.nextCount)}
                  />
                ) : null}
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
          )
        ) : null}

        {sectionModel.showReputation ? (
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
        ) : null}

        {sectionModel.showPhotos && gridPhotos.length > 0 ? (
          <Section title="Fan photos" kicker="FAN PHOTOS" count={fullGridPhotos.length}>
            <View style={styles.photoGrid}>
              {gridPhotos.map((photo, index) => (
                <SmartImage
                  key={`${photo.uri}-${index}`}
                  uri={photo.uri}
                  style={styles.photoTile}
                  contain={false}
                  previewWidth={420}
                  accessibilityLabel={`Open fan photo ${index + 1} from ${venue.name}`}
                  onPress={() => onOpenPhotos?.(fullGridPhotos, index)}
                />
              ))}
            </View>
            {fullGridPhotos.length > gridPhotos.length && onOpenPhotos ? (
              <SectionSwitchButton label={`See all ${fullGridPhotos.length} fan photos`} onPress={() => onOpenPhotos(fullGridPhotos, 0)} />
            ) : null}
          </Section>
        ) : null}

        {sectionModel.showReviews ? (
        <Section title="Fan notes" kicker="REVIEWS" count={reviews.length}>
          {reviews.length ? (
            <View style={styles.stack}>
              {visibleReviews.map((review) => {
                const reviewPhotoViewerItems = (Array.isArray(review.photos) ? review.photos : []).map((photoUri) => ({
                  uri: photoUri,
                  by: review.name,
                  venueReviewId: review.id,
                  ownerId: review.userId,
                }));
                const reviewPhotoPreview = reviewPhotoViewerItems.slice(0, 3);
                return (
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
                  {review.text ? (
                    <ExpandableText
                      text={review.text}
                      containerStyle={styles.reviewTextBlock}
                      moreAccessibilityLabel={`Read the full review from ${review.name || "this member"}`}
                      lessAccessibilityLabel={`Show a shorter review from ${review.name || "this member"}`}
                      renderText={({ text, accessibilityLabel }) => (
                        <MentionText text={text} style={styles.reviewText} onMention={onMention} accessibilityLabel={accessibilityLabel} />
                      )}
                    />
                  ) : null}
                  {reviewPhotoPreview.length ? (
                    <View style={styles.reviewPhotos}>
                      {reviewPhotoPreview.map((photo, index) => {
                        const remaining = reviewPhotoViewerItems.length - reviewPhotoPreview.length;
                        const opensRemainder = index === reviewPhotoPreview.length - 1 && remaining > 0;
                        return (
                          <View key={`${photo.uri}-${index}`} style={styles.reviewPhotoFrame}>
                            <SmartImage
                              uri={photo.uri}
                              style={styles.reviewPhoto}
                              contain={false}
                              previewWidth={240}
                              accessibilityLabel={opensRemainder
                                ? `See all ${reviewPhotoViewerItems.length} photos from ${review.name}'s review of ${venue.name}`
                                : `Open photo ${index + 1} from ${review.name}'s review of ${venue.name}`}
                              onPress={() => onOpenPhotos?.(reviewPhotoViewerItems, index)}
                            />
                            {opensRemainder ? (
                              <View style={styles.reviewPhotoMore} pointerEvents="none">
                                <Text style={styles.reviewPhotoMoreText}>+{remaining}</Text>
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
                );
              })}
              {sectionModel.condensed && reviews.length > visibleReviews.length ? (
                <SectionSwitchButton
                  label={`Read all ${reviews.length} fan notes`}
                  onPress={() => setActiveSection("reviews")}
                />
              ) : !sectionModel.condensed && reviewWindow.remaining > 0 ? (
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
        ) : null}

        {sectionModel.showHistory ? (
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
        ) : null}
      </ScrollView>
      </VinylRefreshBoundary>
    </View>
  );
}

function VenuePageSectionNav({ active, onChange }) {
  return (
    <View style={styles.sectionNav} accessibilityRole="tablist" accessibilityLabel="Venue page sections">
      {VENUE_PAGE_SECTIONS.map((section) => {
        const selected = active === section.key;
        return (
          <Pressable
            key={section.key}
            style={({ pressed, focused }) => [
              styles.sectionNavItem,
              selected && styles.sectionNavItemOn,
              pressed && styles.buttonPressed,
              focused && focusRing,
            ]}
            onPress={() => onChange(section.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${section.label} venue page section`}
          >
            <Icon name={section.icon} size={14} color={selected ? colors.amber : colors.textFaint} />
            <Text style={[styles.sectionNavText, selected && styles.sectionNavTextOn]}>{section.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function webExternalLinkProps(url) {
  return Platform.OS === "web" && String(url || "").startsWith("https://")
    ? { href: url, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } }
    : {};
}

function VenueVisitGuide({ guide, wide, error, onOpen }) {
  return (
    <View style={[styles.guideGrid, wide && styles.guideGridWide]}>
      <View style={[styles.seatingCard, wide && styles.seatingCardWide]}>
        <View style={styles.guideIcon}>
          <Icon name="ticket" size={21} color={colors.amber} />
        </View>
        <View style={styles.flexCopy}>
          <Text style={styles.guideLabel}>SEATING &amp; LAYOUT</Text>
          <Text style={styles.guideTitle} selectable>{guide.capacityLabel ? `${guide.capacityLabel} listed capacity` : "Check the event layout"}</Text>
          <Text style={styles.guideBody} selectable>{guide.seatingSummary}</Text>
        </View>
      </View>
      {guide.actions.length ? (
        <View style={[styles.guideActions, wide && styles.guideActionsWide]}>
          {guide.actions.map((action) => (
            <Pressable
              key={action.id}
              {...webExternalLinkProps(action.url)}
              style={({ pressed, hovered, focused }) => [
                styles.guideAction,
                hovered && styles.guideActionHover,
                pressed && styles.buttonPressed,
                focused && focusRing,
              ]}
              onPress={() => onOpen(action)}
              accessibilityRole="link"
              accessibilityLabel={`${action.label}. ${action.description}`}
            >
              <View style={styles.guideActionIcon}>
                <Icon name={action.icon} size={18} color={colors.cool} />
              </View>
              <View style={styles.flexCopy}>
                <Text style={styles.guideActionTitle}>{action.label}</Text>
                <Text style={styles.guideActionBody}>{action.description}</Text>
              </View>
              <Icon name="external" size={15} color={colors.textFaint} />
            </Pressable>
          ))}
          {error ? <Text style={styles.guideError} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text> : null}
        </View>
      ) : (
        <View style={[styles.guideUnavailable, wide && styles.guideUnavailableWide]}>
          <Icon name="map" size={20} color={colors.textFaint} />
          <Text style={styles.guideUnavailableText}>Parking and transit links will appear when this venue has a verified location.</Text>
        </View>
      )}
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

function SectionSwitchButton({ label, onPress }) {
  return (
    <Pressable
      style={({ pressed, focused }) => [styles.moreButton, pressed && styles.buttonPressed, focused && focusRing]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.moreButtonText}>{label}</Text>
      <Icon name="chevron-right" size={16} color={colors.amber} />
    </Pressable>
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
  content: { width: "100%", maxWidth: 980, minWidth: 0, alignSelf: "center", alignItems: "stretch", paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: 96, gap: 14 },
  heroShell: { width: "100%", maxWidth: "100%", minWidth: 0, alignSelf: "stretch", padding: 7, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  heroMeta: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 8, paddingTop: 5 },
  placeRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
  place: { flexShrink: 1, color: colors.textDim, fontSize: 12 },
  capacity: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  metrics: { width: "100%", maxWidth: "100%", minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  metric: { minWidth: 0, flexGrow: 1, flexBasis: 128, minHeight: 64, alignItems: "center", justifyContent: "center", padding: 8, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  metricValue: { color: colors.text, fontFamily: mono, fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"], marginTop: 2 },
  metricValueAccent: { color: colors.amber },
  metricLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.8, marginTop: 2 },
  sectionNav: { width: "100%", maxWidth: "100%", minWidth: 0, alignSelf: "stretch", flexDirection: "row", alignItems: "stretch", gap: 5, padding: 4, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  sectionNavItem: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, borderRadius: radius.sm, borderCurve: "continuous" },
  sectionNavItemOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.amber },
  sectionNavText: { color: colors.textFaint, fontSize: 11.5, fontWeight: "800" },
  sectionNavTextOn: { color: colors.amber },
  guideGrid: { width: "100%", maxWidth: "100%", minWidth: 0, alignSelf: "stretch", gap: 8 },
  guideGridWide: { flexDirection: "row", alignItems: "stretch" },
  seatingCard: { minWidth: 0, alignSelf: "stretch", minHeight: 148, flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 15, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  seatingCardWide: { flex: 0.9 },
  guideIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  guideLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  guideTitle: { color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "900", marginTop: 5 },
  guideBody: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  guideActions: { minWidth: 0, alignSelf: "stretch", gap: 7 },
  guideActionsWide: { flex: 1.1 },
  guideAction: { width: "100%", maxWidth: "100%", minWidth: 0, minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 11, paddingVertical: 8, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, ...Platform.select({ web: { cursor: "pointer", transitionDuration: "120ms", transitionProperty: "background-color, border-color" } }) },
  guideActionHover: { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
  guideActionIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.bgElev },
  guideActionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 13, fontWeight: "900" },
  guideActionBody: { color: colors.textDim, fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  guideError: { color: colors.danger, fontSize: 11.5, lineHeight: 16, textAlign: "center" },
  guideUnavailable: { minWidth: 0, alignSelf: "stretch", minHeight: 90, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 15, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  guideUnavailableWide: { flex: 1.1 },
  guideUnavailableText: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  section: { width: "100%", maxWidth: "100%", minWidth: 0, alignSelf: "stretch", gap: 10 },
  sectionHeader: { minWidth: 0, minHeight: 40, flexDirection: "row", alignItems: "flex-end", gap: 12 },
  sectionKicker: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 21, fontWeight: "900", letterSpacing: -0.4, marginTop: 3 },
  countPill: { minWidth: 30, height: 28, flexShrink: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  countText: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "900", fontVariant: ["tabular-nums"] },
  stack: { width: "100%", maxWidth: "100%", minWidth: 0, alignSelf: "stretch", gap: 10 },
  noUpcoming: { width: "100%", maxWidth: "100%", minWidth: 0, minHeight: 82, flexDirection: "row", alignItems: "center", gap: 13, padding: 15, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  noUpcomingIcon: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 15, borderCurve: "continuous", backgroundColor: colors.bgElev },
  noUpcomingTitle: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900" },
  noUpcomingBody: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 3 },
  reputationGrid: { width: "100%", maxWidth: "100%", minWidth: 0, flexDirection: "column", gap: 8 },
  reputationGridWide: { flexDirection: "row" },
  scorePanel: { minWidth: 106, alignSelf: "stretch", alignItems: "center", justifyContent: "center", padding: 12, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  scoreValue: { color: colors.cool, fontFamily: mono, fontSize: 32, lineHeight: 36, fontWeight: "900", fontVariant: ["tabular-nums"] },
  scoreLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.8, marginTop: 7 },
  reputationCopy: { flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center", padding: 12, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  reputationTitle: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900" },
  reputationBody: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 4 },
  reviewSignal: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  reviewSignalText: { color: colors.textFaint, fontSize: 11 },
  reviewButton: { width: "100%", maxWidth: "100%", minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.amberStrong, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.amber, borderBottomColor: colors.accentEdge, ...shadow.control, ...Platform.select({ web: { cursor: "pointer" } }) },
  reviewButtonText: { color: "#1A1206", fontFamily: displayFont, fontSize: 14, fontWeight: "900" },
  buttonPressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
  photoGrid: { width: "100%", maxWidth: "100%", minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  photoTile: { width: "31.5%", aspectRatio: 1, borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft },
  reviewCard: { width: "100%", maxWidth: "100%", minWidth: 0, padding: 15, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, ...shadow.card },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  flexCopy: { flex: 1, minWidth: 0 },
  reviewName: { color: colors.text, fontFamily: displayFont, fontSize: 14, fontWeight: "900" },
  reviewTime: { color: colors.textFaint, fontSize: 10, marginTop: 2 },
  reviewReportBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: colors.lineSoft },
  scorePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  scorePillText: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  reviewText: { color: colors.text, fontSize: 14, lineHeight: 21, marginTop: 12 },
  reviewTextBlock: { alignItems: "flex-start" },
  reviewPhotos: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  reviewPhotoFrame: { width: 82, maxWidth: "31%", aspectRatio: 1, overflow: "hidden", borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line },
  reviewPhoto: { ...StyleSheet.absoluteFillObject },
  reviewPhotoMore: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(6,7,11,0.58)" },
  reviewPhotoMoreText: { color: "#fff", fontFamily: mono, fontSize: 18, fontWeight: "900" },
  emptyReviews: { width: "100%", maxWidth: "100%", minWidth: 0, alignItems: "center", padding: 25, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  emptyTitle: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "900", textAlign: "center", marginTop: 10 },
  emptyBody: { maxWidth: 470, color: colors.textDim, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 5 },
  historyCard: { width: "100%", maxWidth: "100%", minWidth: 0, minHeight: 70, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, ...Platform.select({ web: { cursor: "pointer", transitionDuration: "120ms", transitionProperty: "background-color, transform" } }) },
  historyHover: { backgroundColor: colors.surfaceAlt },
  historyIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  historyArtist: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900" },
  historyMeta: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  historyEmpty: { width: "100%", maxWidth: "100%", minWidth: 0, color: colors.textDim, fontSize: 13, fontStyle: "italic", padding: 16, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  moreButton: { width: "100%", maxWidth: "100%", minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, ...Platform.select({ web: { cursor: "pointer" } }) },
  moreButtonText: { color: colors.amber, fontFamily: displayFont, fontSize: 13, fontWeight: "900" },
});
