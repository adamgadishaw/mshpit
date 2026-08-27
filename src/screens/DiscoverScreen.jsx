import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, displayFont, font, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import { countryForCity } from "../geo";
import Icon from "../components/Icon";
import DiscoverChart from "../components/discover/DiscoverChart";
import DiscoverGenres from "../components/discover/DiscoverGenres";
import { DiscoverPhotos } from "../components/discover/DiscoverCommunity";
import { MetricTile, OverviewState, QuickAction, SectionHeading } from "../components/discover/DiscoverPrimitives";
import { UpcomingEventCard, VenueDiscoveryCard } from "../components/VenueDiscoveryCards";
import { EventScopeToggle, PopularLoungeCard } from "../components/LiveDiscoveryCards";
import { PublicPressableLink } from "../components/PublicWebLinks";
import { eventPath } from "../domain/urls.mjs";
import {
  LIVE_EVENT_SCOPE,
  liveEventTitle,
  liveScopeLabel,
  localDiscoveryEvents,
  projectWorldwideUpcomingEvents,
  projectPopularLounges,
  upcomingEventsForScope,
} from "../domain/liveDiscovery.mjs";
import {
  cancelDiscoverRequest,
  compactDiscoverNumber,
  discoverSectionState,
  hasDiscoverOverviewContent,
  normalizeDiscoverArtistRows,
  normalizeDiscoverOverview,
  orderDiscoverCountries,
  selectDiscoverPhotos,
} from "../domain/discoverView.mjs";

const EMPTY_OVERVIEW = normalizeDiscoverOverview({});

function useLatestCallback(callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args) => callbackRef.current?.(...args), []);
}

export default function DiscoverScreen({
  onOpen,
  onOpenTopRated,
  onOpenArtist,
  onOpenVenue,
  onOpenNearby,
  onOpenFanClubs,
  onOpenVenues,
  onOpenLounge,
  onOpenPhotos,
}) {
  const {
    session,
    feed,
    removedIds,
    blockedIds,
    loadDiscoverOverview,
    loadDiscoverGenre,
    discoverStats,
    memberCount,
    discoverySidebar,
    discoverySidebarStatus,
    tourDates,
  } = useStore();
  const { width } = useWindowDimensions();
  const compact = width < 620;
  const veryCompact = width < 380;
  const wide = width >= 900;
  const actionBasis = veryCompact ? "100%" : wide ? "23%" : "48%";

  const accountId = session?.id || null;
  const homeCity = session?.home?.city || discoverySidebar?.location?.city || "";
  const homeCountry = countryForCity(homeCity);
  const [regionChoice, setRegionChoice] = useState(() => ({ accountId, value: homeCountry || "Worldwide", touched: false }));
  const region = regionChoice.accountId === accountId ? regionChoice.value : homeCountry || "Worldwide";
  const [query, setQuery] = useState("");
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [overviewStatus, setOverviewStatus] = useState("idle");
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [liveScopeChoice, setLiveScopeChoice] = useState(() => ({
    accountId,
    value: homeCity ? LIVE_EVENT_SCOPE.LOCAL : LIVE_EVENT_SCOPE.WORLDWIDE,
    touched: false,
  }));
  const liveScope = liveScopeChoice.accountId === accountId
    ? liveScopeChoice.value
    : homeCity ? LIVE_EVENT_SCOPE.LOCAL : LIVE_EVENT_SCOPE.WORLDWIDE;
  const [genreRows, setGenreRows] = useState([]);
  const [genreStatus, setGenreStatus] = useState("idle");
  const overviewLoaderRef = useRef(loadDiscoverOverview);
  overviewLoaderRef.current = loadDiscoverOverview;
  const genreLoaderRef = useRef(loadDiscoverGenre);
  genreLoaderRef.current = loadDiscoverGenre;
  const overviewRequestRef = useRef({ sequence: 0, controller: null });
  const genreRequestRef = useRef({ sequence: 0, controller: null });
  const openArtist = useLatestCallback(onOpenArtist);
  const openPhotos = useLatestCallback(onOpenPhotos);

  const localStatsRef = useRef(null);
  if (!localStatsRef.current) localStatsRef.current = discoverStats();
  const localStats = localStatsRef.current;
  const photos = useMemo(() => selectDiscoverPhotos(feed, { removedIds, blockedIds, limit: 10 }), [blockedIds, feed, removedIds]);
  const photoUris = useMemo(() => photos.map((photo) => ({
    ...photo,
    uri: photo.uri,
    by: photo.by,
    postId: photo.logId,
    ownerId: photo.ownerId,
  })), [photos]);
  const localEvents = useMemo(
    () => localDiscoveryEvents(discoverySidebar?.upcomingEvents, { limit: 12 }),
    [discoverySidebar?.upcomingEvents],
  );
  const worldwideEvents = useMemo(
    () => projectWorldwideUpcomingEvents(tourDates, { limit: 12 }),
    [tourDates],
  );
  const liveEvents = upcomingEventsForScope({
    scope: liveScope,
    localEvents,
    worldwideEvents,
    limit: 4,
  });
  const venueRows = Array.isArray(discoverySidebar?.trendingVenues) ? discoverySidebar.trendingVenues.slice(0, 3) : [];
  const loungeRows = projectPopularLounges(discoverySidebar?.popularLounges, { limit: 4 });

  const requestOverview = useCallback(({ preserve = false, force = false } = {}) => {
    overviewRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const sequence = overviewRequestRef.current.sequence + 1;
    overviewRequestRef.current = { sequence, controller };
    if (preserve) setOverviewStatus("refreshing");
    else {
      setOverview((current) => normalizeDiscoverOverview({ countries: current.countries }));
      setOverviewStatus("loading");
    }
    overviewLoaderRef.current({ by: "popularity", country: region, signal: controller.signal, force })
      .then((payload) => {
        if (controller.signal.aborted || overviewRequestRef.current.sequence !== sequence) return;
        const normalized = normalizeDiscoverOverview(payload, "popularity");
        normalized.countries = orderDiscoverCountries(normalized.countries, homeCountry);
        setOverview(normalized);
        setOverviewStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted && overviewRequestRef.current.sequence === sequence) setOverviewStatus("error");
      });
    return controller;
  }, [homeCountry, region]);

  const requestGenre = useCallback(({ force = false } = {}) => {
    genreRequestRef.current.controller?.abort();
    if (!selectedGenre) {
      setGenreRows([]);
      setGenreStatus("idle");
      return null;
    }
    const controller = new AbortController();
    const sequence = genreRequestRef.current.sequence + 1;
    genreRequestRef.current = { sequence, controller };
    setGenreRows([]);
    setGenreStatus("loading");
    genreLoaderRef.current({ genre: selectedGenre, country: region, limit: 12, signal: controller.signal, force })
      .then((result) => {
        if (controller.signal.aborted || genreRequestRef.current.sequence !== sequence) return;
        setGenreRows(normalizeDiscoverArtistRows(result?.rows, 12));
        setGenreStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted && genreRequestRef.current.sequence === sequence) setGenreStatus("error");
      });
    return controller;
  }, [region, selectedGenre]);

  useEffect(() => {
    requestOverview();
    return () => {
      overviewRequestRef.current = cancelDiscoverRequest(overviewRequestRef.current);
    };
  }, [requestOverview]);

  useEffect(() => {
    requestGenre();
    return () => {
      genreRequestRef.current = cancelDiscoverRequest(genreRequestRef.current);
    };
  }, [requestGenre]);

  useEffect(() => {
    setRegionChoice((current) => {
      if (current.accountId !== accountId) return { accountId, value: homeCountry || "Worldwide", touched: false };
      if (!current.touched && homeCountry && current.value !== homeCountry) return { ...current, value: homeCountry };
      return current;
    });
  }, [accountId, homeCountry]);

  useEffect(() => {
    setLiveScopeChoice((current) => {
      const fallback = homeCity ? LIVE_EVENT_SCOPE.LOCAL : LIVE_EVENT_SCOPE.WORLDWIDE;
      if (current.accountId !== accountId) return { accountId, value: fallback, touched: false };
      if (!current.touched && homeCity && current.value !== LIVE_EVENT_SCOPE.LOCAL) {
        return { ...current, value: LIVE_EVENT_SCOPE.LOCAL };
      }
      return current;
    });
  }, [accountId, homeCity]);

  useEffect(() => {
    if (selectedGenre && !overview.genres.some((item) => item.genre === selectedGenre && item.genre !== "Other")) setSelectedGenre(null);
  }, [overview.genres, selectedGenre]);

  const pickRegion = (country) => {
    setQuery("");
    setRegionChoice({ accountId, value: country, touched: true });
  };
  const retryGenre = useCallback(() => requestGenre({ force: true }), [requestGenre]);

  const overviewState = discoverSectionState({ status: overviewStatus, rows: overview.chart.rows });
  const showOverviewContent = hasDiscoverOverviewContent(overview)
    && (overviewStatus === "ready" || overviewStatus === "refreshing" || overviewStatus === "error");
  const countries = overview.countries.length ? overview.countries : orderDiscoverCountries([], homeCountry);
  const metrics = [
    { label: "members", value: overview.memberTotal ?? memberCount ?? localStats.members, tint: colors.gold },
    { label: "artists", value: overview.catalogTotal ?? localStats.artists, tint: colors.amber },
    { label: "venues", value: localStats.venues, tint: colors.cool },
    { label: "genres", value: overview.distinctGenres ?? localStats.genres, tint: colors.magenta },
  ];

  return (
    <ScrollView
      contentContainerStyle={[styles.content, compact && styles.contentCompact]}
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={overviewStatus === "refreshing"} onRefresh={() => requestOverview({ preserve: true, force: true })} tintColor={colors.amber} colors={[colors.amber]} />}
    >
      <View style={[styles.hero, compact && styles.heroCompact]}>
        <View style={styles.heroCopy}>
          <Text style={styles.kicker}>FIND YOUR NEXT OBSESSION</Text>
          <Text style={[styles.title, compact && styles.titleCompact]} accessibilityRole="header">Discover</Text>
          <Text style={styles.tagline}>Live charts, local rooms, and sounds worth following - without the endless scroll.</Text>
        </View>
        <View style={styles.scenePill} accessible accessibilityLabel={`Current Discover region: ${region}`}>
          <Icon name={region === "Worldwide" ? "globe" : "pin"} size={15} color={colors.amber} />
          <Text style={styles.scenePillText} numberOfLines={1}>{region}</Text>
        </View>
      </View>

      <View style={styles.controlsCard}>
        <View style={[styles.controlTop, compact && styles.controlTopCompact]}>
          <View style={styles.controlCopy}>
            <Text style={styles.controlLabel}>CHART VIEW</Text>
            <Text style={styles.controlHint}>Current catalog momentum</Text>
          </View>
        </View>
        <Text style={styles.controlLabel}>SCENE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionRail} accessibilityLabel="Choose a Discover region">
          {countries.map((country) => {
            const selected = country.country.toLocaleLowerCase() === region.toLocaleLowerCase();
            return (
              <Pressable
                key={country.country}
                style={[styles.regionChip, selected && styles.regionChipSelected]}
                onPress={() => pickRegion(country.country)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${country.country}${country.count != null ? `, ${country.count} artists` : ""}`}
              >
                <Text style={[styles.regionText, selected && styles.regionTextSelected]}>{country.country}</Text>
                {country.count != null && <Text style={[styles.regionCount, selected && styles.regionCountSelected]}>{compactDiscoverNumber(country.count)}</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.venueSection}>
        <SectionHeading
          eyebrow="LIVE ROOMS"
          title="Venues"
          detail="Start with the room: browse cities, lineups, and places fans keep coming back to."
          action={(
            <Pressable style={styles.sectionAction} onPress={onOpenVenues} accessibilityRole="button" accessibilityLabel="Browse all venues">
              <Text style={styles.sectionActionText}>Browse all</Text>
              <Icon name="chevron-right" size={14} color={colors.cool} />
            </Pressable>
          )}
        />
        <Pressable
          style={({ pressed }) => [styles.venueHero, pressed && styles.cardPressed]}
          onPress={onOpenVenues}
          accessibilityRole="button"
          accessibilityLabel="Open the venue directory"
          accessibilityHint="Browse venues by city and upcoming lineup"
        >
          <View style={styles.venueHeroIcon}><Icon name="pin" size={24} color={colors.cool} /></View>
          <View style={styles.venueHeroCopy}>
            <Text style={styles.venueHeroTitle}>Find your next favourite room</Text>
            <Text style={styles.venueHeroDetail}>{homeCity ? `Start around ${homeCity}, then explore worldwide.` : "Explore local stages and rooms around the world."}</Text>
          </View>
          <Icon name="chevron-right" size={21} color={colors.cool} />
        </Pressable>
        {venueRows.length > 0 ? (
          <View style={styles.venueRows}>
            {venueRows.map((venue) => (
              <VenueDiscoveryCard key={`${venue.name}|${venue.place || ""}`} venue={venue} compact onPress={() => onOpenVenue?.(venue.name || venue)} />
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.quickSection}>
        <SectionHeading eyebrow="START HERE" title="Explore your way" detail="Shortcuts to the parts of Pit that help you make plans" />
        <View style={styles.quickGrid}>
          <QuickAction icon="pin" title="Find venues" detail="Browse rooms by city and lineup" tint={colors.cool} onPress={onOpenVenues} basis={actionBasis} />
          <QuickAction icon="map" title="Near you" detail={homeCity ? `Shows around ${homeCity}` : "Shows and scenes close by"} tint={colors.good} onPress={onOpenNearby} basis={actionBasis} />
          <QuickAction icon="trophy" title="Top-rated shows" detail="Concerts members loved most" tint={colors.gold} onPress={onOpenTopRated} basis={actionBasis} />
          <QuickAction icon="you" title="Fan clubs" detail="Join artist communities" tint={colors.magenta} onPress={onOpenFanClubs} basis={actionBasis} />
        </View>
      </View>

      <View style={[styles.metrics, compact && styles.metricsCompact]}>{metrics.map((metric) => <MetricTile key={metric.label} {...metric} compact={compact} />)}</View>

      <View style={[styles.liveGrid, !wide && styles.liveGridStacked]}>
        <View style={styles.livePanel}>
          <View style={[styles.livePanelHead, compact && styles.livePanelHeadCompact]}>
            <SectionHeading eyebrow="PLAN THE NEXT NIGHT" title="Upcoming live events" detail={liveScopeLabel({ scope: liveScope, homeCity })} />
            <EventScopeToggle
              scope={liveScope}
              localLabel={homeCity ? `Near ${homeCity}` : "Near you"}
              compact={compact}
              onChange={(value) => setLiveScopeChoice({ accountId, value, touched: true })}
            />
          </View>
          {liveEvents.length === 0 ? (
            <View style={styles.liveEmpty} accessibilityLiveRegion="polite">
              <Icon name={liveScope === LIVE_EVENT_SCOPE.WORLDWIDE ? "globe" : "pin"} size={19} color={colors.textFaint} />
              <Text style={styles.liveEmptyText}>
                {discoverySidebarStatus === "loading"
                  ? "Loading upcoming live events…"
                  : liveScope === LIVE_EVENT_SCOPE.LOCAL
                    ? "No shows are listed near your saved home area yet. Try Worldwide."
                    : "No worldwide live-event dates are available yet."}
              </Text>
            </View>
          ) : (
            <View style={styles.liveRows}>
              {liveEvents.map((event) => (
                <PublicPressableLink
                  key={event.id || `${liveEventTitle(event)}|${event.venue}|${event.date}`}
                  href={eventPath(event)}
                  onNavigate={() => onOpen?.(event)}
                  style={({ pressed }) => [styles.liveLink, pressed && styles.cardPressed]}
                  accessibilityLabel={`Open ${liveEventTitle(event)} at ${event.venue || "the venue"}`}
                >
                  <UpcomingEventCard event={event} compact />
                </PublicPressableLink>
              ))}
            </View>
          )}
        </View>

        <View style={styles.livePanel}>
          <SectionHeading eyebrow="FANS ARE TALKING" title="Popular lounges" detail="Active concert rooms ranked by aggregate conversation, never by private member data." />
          {loungeRows.length === 0 ? (
            <View style={styles.liveEmpty}>
              <Icon name="comment" size={19} color={colors.textFaint} />
              <Text style={styles.liveEmptyText}>Active lounges will appear when concert conversations pick up.</Text>
            </View>
          ) : (
            <View style={styles.liveRows}>
              {loungeRows.map((lounge) => <PopularLoungeCard key={lounge.key} lounge={lounge} compact onPress={() => onOpenLounge?.(lounge)} />)}
            </View>
          )}
        </View>
      </View>

      {overviewStatus === "refreshing" && showOverviewContent && (
        <View style={styles.refreshNotice} accessibilityLiveRegion="polite"><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.refreshNoticeText}>Refreshing {region}</Text></View>
      )}
      {overviewStatus === "error" && showOverviewContent && (
        <View style={styles.refreshError} accessibilityLiveRegion="assertive">
          <Text style={styles.refreshErrorText} selectable>Could not refresh. Showing the last loaded chart.</Text>
          <Pressable style={styles.refreshRetryButton} onPress={() => requestOverview({ preserve: true, force: true })} accessibilityRole="button" accessibilityLabel="Retry refreshing Discover"><Text style={styles.refreshRetry}>Retry</Text></Pressable>
        </View>
      )}

      {!showOverviewContent ? (
        <OverviewState state={overviewState} region={region} onRetry={() => requestOverview({ force: true })} onWorldwide={() => pickRegion("Worldwide")} />
      ) : (
        <>
          <DiscoverChart rows={overview.chart.rows} source={overview.chart.source} info={overview.chart} query={query} onQuery={setQuery} onOpenArtist={openArtist} compact={compact} narrow={veryCompact} />
        </>
      )}

      <DiscoverPhotos photos={photos} photoUris={photoUris} compact={compact} width={width} onOpenPhotos={openPhotos} />
      {showOverviewContent ? (
        <DiscoverGenres genres={overview.genres} selected={selectedGenre} onSelect={setSelectedGenre} total={overview.genreTotal} rows={genreRows} status={genreStatus} region={region} onOpenArtist={openArtist} onRetry={retryGenre} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 1040, alignSelf: "center", paddingHorizontal: 24, paddingTop: 24, paddingBottom: 56, gap: 18 },
  contentCompact: { paddingHorizontal: 14, paddingTop: 16, paddingBottom: 40, gap: 14 },
  hero: { minHeight: 150, borderRadius: radius.lg, borderCurve: "continuous", padding: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 20, ...shadow.card },
  heroCompact: { minHeight: 0, padding: 18, alignItems: "flex-start", flexDirection: "column" },
  heroCopy: { flex: 1, maxWidth: 650 },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 10.5, fontWeight: "900", letterSpacing: 2.1 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 40, lineHeight: 46, fontWeight: "900", letterSpacing: -1.2, paddingTop: 5 },
  titleCompact: { fontSize: 34, lineHeight: 40 },
  tagline: { color: colors.textDim, fontFamily: font, fontSize: 15, lineHeight: 22, paddingTop: 6, maxWidth: 560 },
  scenePill: { maxWidth: 220, minHeight: 38, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  scenePillText: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "800", flexShrink: 1 },
  controlsCard: { backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, borderCurve: "continuous", padding: 14, gap: 10 },
  controlTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16 },
  controlTopCompact: { alignItems: "stretch", flexDirection: "column", gap: 10 },
  controlCopy: { flex: 1 },
  controlLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 1.3 },
  controlHint: { color: colors.textDim, fontFamily: font, fontSize: 12, paddingTop: 3 },
  sourceToggle: { flexDirection: "row", padding: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  sourceOption: { minHeight: 44, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", flex: 1 },
  sourceOptionSelected: { backgroundColor: colors.amberStrong },
  sourceOptionText: { color: colors.textDim, fontFamily: font, fontSize: 12.5, fontWeight: "800" },
  sourceOptionTextSelected: { color: "#1A1206" },
  regionRail: { gap: 8, paddingRight: 10 },
  regionChip: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  regionChipSelected: { borderColor: colors.amber, backgroundColor: `${colors.amber}16` },
  regionText: { color: colors.textDim, fontFamily: font, fontSize: 12.5, fontWeight: "700" },
  regionTextSelected: { color: colors.amber, fontWeight: "900" },
  regionCount: { color: colors.textFaint, fontFamily: mono, fontSize: 10, fontWeight: "800" },
  regionCountSelected: { color: colors.amber },
  venueSection: { gap: 10 },
  sectionAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 10, borderRadius: radius.pill },
  sectionActionText: { color: colors.cool, fontFamily: font, fontSize: 12, fontWeight: "900" },
  venueHero: { minHeight: 96, flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: `${colors.cool}66`, backgroundColor: `${colors.cool}0F`, ...shadow.card },
  venueHeroIcon: { width: 50, height: 50, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: `${colors.cool}55`, backgroundColor: colors.bgElev },
  venueHeroCopy: { flex: 1, minWidth: 0 },
  venueHeroTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  venueHeroDetail: { color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 17, paddingTop: 3 },
  venueRows: { gap: 8 },
  quickSection: { gap: 10 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metrics: { flexDirection: "row", gap: 10 },
  metricsCompact: { flexWrap: "wrap" },
  liveGrid: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  liveGridStacked: { flexDirection: "column" },
  livePanel: { flex: 1, minWidth: 0, width: "100%", gap: 10, padding: 14, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev, ...shadow.card },
  livePanelHead: { gap: 10 },
  livePanelHeadCompact: { alignItems: "stretch" },
  liveRows: { gap: 8 },
  liveLink: { borderRadius: radius.md },
  liveEmpty: { minHeight: 82, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  liveEmptyText: { flex: 1, color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 17 },
  cardPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  refreshNotice: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.pill, backgroundColor: colors.bgElev },
  refreshNoticeText: { color: colors.textDim, fontFamily: font, fontSize: 12, fontWeight: "700" },
  refreshError: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.danger}55`, backgroundColor: colors.bgElev },
  refreshErrorText: { color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 17, textAlign: "center" },
  refreshRetryButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  refreshRetry: { color: colors.danger, fontFamily: font, fontSize: 12, fontWeight: "900", paddingVertical: 8 },
});
