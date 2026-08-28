import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, displayFont, focusRing, font, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import { countryForCity } from "../geo";
import Icon from "../components/Icon";
import DiscoverChart from "../components/discover/DiscoverChart";
import DiscoverGenres from "../components/discover/DiscoverGenres";
import { DiscoverPhotos } from "../components/discover/DiscoverCommunity";
import DiscoverEventBanner from "../components/discover/DiscoverEventBanner";
import { MetricTile, OverviewState, QuickAction, SectionHeading } from "../components/discover/DiscoverPrimitives";
import { UpcomingEventCard, VenueDiscoveryCard } from "../components/VenueDiscoveryCards";
import { EventScopeToggle, PopularLoungeCard } from "../components/LiveDiscoveryCards";
import { PublicPressableLink } from "../components/PublicWebLinks";
import { eventPath } from "../domain/urls.mjs";
import { buildDiscoverEventBannerSlides } from "../domain/discoverEventBanner.mjs";
import {
  DISCOVER_AREA_SCOPE,
  defaultDiscoverAreaChoice,
  discoverAreaIsLocal,
  resolveDiscoverAreaChoice,
  selectDiscoverCountryArea,
  selectDiscoverScopeArea,
  syncDiscoverAreaChoice,
} from "../domain/discoverArea.mjs";
import {
  discoverCountryIdentity,
  discoverEventCountryFacets,
  filterDiscoverSceneRows,
  projectDiscoverScene,
} from "../domain/discoverScene.mjs";
import {
  LIVE_EVENT_SCOPE,
  liveEventTitle,
  liveScopeLabel,
  localDiscoveryEvents,
  projectPopularLounges,
  upcomingEventsForScope,
} from "../domain/liveDiscovery.mjs";
import {
  DISCOVER_RANGE_BATCH,
  DISCOVER_RANGE_DAYS,
  DISCOVER_RANGE_MAX_EVENTS,
  DISCOVER_RANGE_REQUEST_LIMIT,
  mergeDiscoverRangePages,
  selectDiscoverRangeEvents,
} from "../domain/discoverEventRange.mjs";
import {
  cancelDiscoverRequest,
  compactDiscoverNumber,
  discoverSectionState,
  discoverNationOptions,
  hasDiscoverOverviewContent,
  normalizeDiscoverArtistRows,
  normalizeDiscoverOverview,
  orderDiscoverCountries,
  selectDefaultDiscoverGenre,
  selectDiscoverPhotos,
  visibleDiscoverCountries,
} from "../domain/discoverView.mjs";

const EMPTY_OVERVIEW = normalizeDiscoverOverview({});
const EMPTY_EVENT_RANGE = Object.freeze({ scopeKey: "", days: null, through: null, rows: [], nextCursor: null, status: "idle" });

function useLatestCallback(callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args) => callbackRef.current?.(...args), []);
}

export default function DiscoverScreen({
  onOpen,
  onOpenTopRated,
  onOpenEvents,
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
    loadDiscoverTourDateRange,
    discoverStats,
    discoverySidebar,
    discoverySidebarStatus,
    tourDates,
    myAttendance = [],
  } = useStore();
  const { width } = useWindowDimensions();
  const compact = width < 620;
  const veryCompact = width < 380;
  const wide = width >= 900;
  const actionBasis = veryCompact ? "100%" : "48%";

  const accountId = session?.id || null;
  const homeCity = session?.home?.city || discoverySidebar?.location?.city || "";
  const homeCountry = countryForCity(homeCity);
  const areaContext = { accountId, homeCity, homeCountry };
  const [areaChoice, setAreaChoice] = useState(() => defaultDiscoverAreaChoice(areaContext));
  const resolvedArea = resolveDiscoverAreaChoice(areaChoice, areaContext);
  const region = resolvedArea.region;
  const liveScope = discoverAreaIsLocal(resolvedArea)
    ? LIVE_EVENT_SCOPE.LOCAL
    : LIVE_EVENT_SCOPE.WORLDWIDE;
  const rangeScopeKey = `${liveScope}|${region}|${homeCity}|${homeCountry || ""}`;
  const [query, setQuery] = useState("");
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [overviewStatus, setOverviewStatus] = useState("idle");
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [sceneExpanded, setSceneExpanded] = useState(false);
  const [genreResult, setGenreResult] = useState({ genre: null, region: null, rows: [] });
  const genreRows = genreResult.genre === selectedGenre && genreResult.region === region
    ? genreResult.rows
    : [];
  const [genreStatus, setGenreStatus] = useState("idle");
  const [eventRange, setEventRange] = useState(EMPTY_EVENT_RANGE);
  const [visibleEventCount, setVisibleEventCount] = useState(DISCOVER_RANGE_BATCH);
  const overviewLoaderRef = useRef(loadDiscoverOverview);
  overviewLoaderRef.current = loadDiscoverOverview;
  const genreLoaderRef = useRef(loadDiscoverGenre);
  genreLoaderRef.current = loadDiscoverGenre;
  const rangeLoaderRef = useRef(loadDiscoverTourDateRange);
  rangeLoaderRef.current = loadDiscoverTourDateRange;
  const overviewRequestRef = useRef({ sequence: 0, controller: null });
  const genreRequestRef = useRef({ sequence: 0, controller: null });
  const rangeRequestRef = useRef({ sequence: 0, controller: null });
  const openArtist = useLatestCallback(onOpenArtist);
  const openPhotos = useLatestCallback(onOpenPhotos);

  const localStatsRef = useRef(null);
  if (!localStatsRef.current) localStatsRef.current = discoverStats();
  const localStats = localStatsRef.current;
  const photos = useMemo(() => selectDiscoverPhotos(feed, { removedIds, blockedIds, limit: 30 }), [blockedIds, feed, removedIds]);
  const scenePhotos = useMemo(() => filterDiscoverSceneRows(photos, {
    region,
    countryForCity,
    limit: 30,
  }), [photos, region]);
  const photoUris = useMemo(() => scenePhotos.map((photo) => ({
    ...photo,
    uri: photo.uri,
    by: photo.by,
    postId: photo.logId,
    ownerId: photo.ownerId,
  })), [scenePhotos]);
  const sceneProjection = useMemo(() => projectDiscoverScene(tourDates, {
    region,
    eventLimit: 12,
    venueLimit: 8,
    countryForCity,
  }), [region, tourDates]);
  const eventCountryFacets = useMemo(() => discoverEventCountryFacets(tourDates, {
    countryForCity,
    limit: 40,
  }), [tourDates]);
  const localEvents = useMemo(
    () => localDiscoveryEvents(discoverySidebar?.upcomingEvents, { limit: 12 }),
    [discoverySidebar?.upcomingEvents],
  );
  const initialRangeEvents = useMemo(() => selectDiscoverRangeEvents(
    liveScope === LIVE_EVENT_SCOPE.LOCAL ? localEvents : sceneProjection.events,
    {
      days: DISCOVER_RANGE_DAYS[0],
      region: liveScope === LIVE_EVENT_SCOPE.LOCAL ? "Worldwide" : region,
      countryForCity,
    },
  ), [liveScope, localEvents, region, sceneProjection.events]);
  const liveEvents = useMemo(() => upcomingEventsForScope({
    scope: LIVE_EVENT_SCOPE.WORLDWIDE,
    worldwideEvents: initialRangeEvents,
    limit: 4,
  }), [initialRangeEvents]);
  const rangeMatchesScene = eventRange.scopeKey === rangeScopeKey
    && (eventRange.status === "ready" || eventRange.rows.length > 0);
  const rangeEvents = useMemo(() => {
    if (!rangeMatchesScene) return [];
    const scopedRows = liveScope === LIVE_EVENT_SCOPE.LOCAL
      ? localDiscoveryEvents(eventRange.rows, { limit: DISCOVER_RANGE_MAX_EVENTS })
      : eventRange.rows;
    return selectDiscoverRangeEvents(scopedRows, {
      days: eventRange.days,
      through: eventRange.through,
      region: liveScope === LIVE_EVENT_SCOPE.LOCAL ? "Worldwide" : region,
      countryForCity,
    });
  }, [eventRange.days, eventRange.rows, eventRange.through, liveScope, rangeMatchesScene, region]);
  const visibleLiveEvents = useMemo(() => rangeMatchesScene ? upcomingEventsForScope({
    scope: LIVE_EVENT_SCOPE.WORLDWIDE,
    worldwideEvents: rangeEvents,
    limit: visibleEventCount,
  }) : liveEvents, [liveEvents, rangeEvents, rangeMatchesScene, visibleEventCount]);
  const selectedRangeDays = eventRange.scopeKey === rangeScopeKey && eventRange.days
    ? eventRange.days
    : DISCOVER_RANGE_DAYS[0];
  const rangeHasMore = !rangeMatchesScene
    || rangeEvents.length > visibleEventCount
    || (!!eventRange.nextCursor && eventRange.rows.length < DISCOVER_RANGE_MAX_EVENTS);
  const eventArtwork = useMemo(() => visibleLiveEvents.flatMap((event) => event?.eventImage ? [{
    ...event.eventImage,
    eventId: event.id,
    source: "provider",
    provider: "ticketmaster",
    by: event.eventImage.attribution,
  }] : []), [visibleLiveEvents]);
  const eventBannerMedia = useMemo(() => [...photoUris, ...eventArtwork], [eventArtwork, photoUris]);
  const eventBannerSlides = useMemo(() => buildDiscoverEventBannerSlides({
    events: visibleLiveEvents,
    media: eventBannerMedia,
    blockedIds,
    limit: 4,
  }), [blockedIds, eventBannerMedia, visibleLiveEvents]);
  const homeSceneSelected = discoverCountryIdentity(region) === discoverCountryIdentity(homeCountry);
  const venueRows = sceneProjection.venues.length
    ? sceneProjection.venues.slice(0, 3)
    : (!tourDates.length && homeSceneSelected && Array.isArray(discoverySidebar?.trendingVenues)
      ? discoverySidebar.trendingVenues.slice(0, 3)
      : []);
  const loungeRows = useMemo(() => filterDiscoverSceneRows(
    projectPopularLounges(discoverySidebar?.popularLounges, { limit: 12 }),
    { region, countryForCity, limit: 4 },
  ), [discoverySidebar?.popularLounges, region]);
  const sceneAttendance = useMemo(() => filterDiscoverSceneRows(myAttendance, {
    region,
    countryForCity,
    limit: 200,
  }), [myAttendance, region]);

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
      setGenreResult({ genre: null, region: null, rows: [] });
      setGenreStatus("idle");
      return null;
    }
    const controller = new AbortController();
    const sequence = genreRequestRef.current.sequence + 1;
    genreRequestRef.current = { sequence, controller };
    setGenreResult({ genre: selectedGenre, region, rows: [] });
    setGenreStatus("loading");
    genreLoaderRef.current({ genre: selectedGenre, country: region, limit: 12, signal: controller.signal, force })
      .then((result) => {
        if (controller.signal.aborted || genreRequestRef.current.sequence !== sequence) return;
        setGenreResult({ genre: selectedGenre, region, rows: normalizeDiscoverArtistRows(result?.rows, 12) });
        setGenreStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted && genreRequestRef.current.sequence === sequence) setGenreStatus("error");
      });
    return controller;
  }, [region, selectedGenre]);

  const requestEventRange = useCallback((days, { after = null, append = false } = {}) => {
    rangeRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const sequence = rangeRequestRef.current.sequence + 1;
    rangeRequestRef.current = { sequence, controller };
    setEventRange((current) => ({
      scopeKey: rangeScopeKey,
      days,
      through: append && current.scopeKey === rangeScopeKey && current.days === days ? current.through : null,
      rows: append && current.scopeKey === rangeScopeKey && current.days === days ? current.rows : [],
      nextCursor: append && current.scopeKey === rangeScopeKey && current.days === days ? current.nextCursor : null,
      status: "loading",
    }));
    const worldwideIdentity = discoverCountryIdentity("Worldwide");
    const local = liveScope === LIVE_EVENT_SCOPE.LOCAL;
    const requestCountry = local || discoverCountryIdentity(region) === worldwideIdentity ? undefined : region;
    rangeLoaderRef.current({
      days,
      limit: DISCOVER_RANGE_REQUEST_LIMIT,
      after,
      country: requestCountry,
      local,
      signal: controller.signal,
    }).then(({ tourDates: rows, nextCursor, through }) => {
      if (controller.signal.aborted || rangeRequestRef.current.sequence !== sequence) return;
      setEventRange((current) => ({
        scopeKey: rangeScopeKey,
        days,
        through,
        rows: append && current.scopeKey === rangeScopeKey && current.days === days
          ? mergeDiscoverRangePages(current.rows, rows)
          : mergeDiscoverRangePages([], rows),
        nextCursor,
        status: "ready",
      }));
    }).catch(() => {
      if (!controller.signal.aborted && rangeRequestRef.current.sequence === sequence) {
        setEventRange((current) => ({ ...current, scopeKey: rangeScopeKey, days, status: "error" }));
      }
    });
  }, [liveScope, rangeScopeKey, region]);

  const selectEventRange = useCallback((days) => {
    setVisibleEventCount(DISCOVER_RANGE_BATCH);
    requestEventRange(days);
  }, [requestEventRange]);

  const loadMoreEvents = useCallback(() => {
    if (eventRange.status === "loading") return;
    const nextVisibleCount = visibleEventCount + DISCOVER_RANGE_BATCH;
    setVisibleEventCount(nextVisibleCount);
    if (!rangeMatchesScene) {
      requestEventRange(selectedRangeDays);
      return;
    }
    if (rangeEvents.length < nextVisibleCount && eventRange.nextCursor
      && eventRange.rows.length < DISCOVER_RANGE_MAX_EVENTS) {
      requestEventRange(eventRange.days, { after: eventRange.nextCursor, append: true });
    }
  }, [eventRange.days, eventRange.nextCursor, eventRange.rows.length, eventRange.status, rangeEvents.length, rangeMatchesScene, requestEventRange, selectedRangeDays, visibleEventCount]);

  useEffect(() => {
    setVisibleEventCount(DISCOVER_RANGE_BATCH);
    return () => {
      rangeRequestRef.current.controller?.abort();
      rangeRequestRef.current.sequence += 1;
    };
  }, [rangeScopeKey]);

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
    setAreaChoice((current) => syncDiscoverAreaChoice(current, { accountId, homeCity, homeCountry }));
  }, [accountId, homeCity, homeCountry]);

  useEffect(() => {
    const nextGenre = selectDefaultDiscoverGenre(overview.genres, selectedGenre);
    if (nextGenre !== selectedGenre) setSelectedGenre(nextGenre);
  }, [overview.genres, selectedGenre]);

  const pickRegion = (country) => {
    setQuery("");
    setSceneExpanded(false);
    setAreaChoice((current) => selectDiscoverCountryArea(
      resolveDiscoverAreaChoice(current, areaContext),
      country,
    ));
  };
  const pickLiveScope = (value) => {
    if (value === LIVE_EVENT_SCOPE.LOCAL && homeCountry) {
      setQuery("");
      setSceneExpanded(false);
    }
    setAreaChoice((current) => selectDiscoverScopeArea(
      resolveDiscoverAreaChoice(current, areaContext),
      value === LIVE_EVENT_SCOPE.LOCAL ? DISCOVER_AREA_SCOPE.LOCAL : DISCOVER_AREA_SCOPE.COUNTRY,
      { homeCountry },
    ));
  };
  const retryGenre = useCallback(() => requestGenre({ force: true }), [requestGenre]);

  const overviewState = discoverSectionState({ status: overviewStatus, rows: overview.chart.rows });
  const showOverviewContent = hasDiscoverOverviewContent(overview)
    && (overviewStatus === "ready" || overviewStatus === "refreshing" || overviewStatus === "error");
  const countries = discoverNationOptions(eventCountryFacets, {
    homeCountry,
    selectedRegion: region,
    limit: 12,
  });
  const sceneCountries = visibleDiscoverCountries(countries, region, { compact, expanded: sceneExpanded, limit: 3 });
  const hiddenSceneCount = Math.max(0, countries.length - sceneCountries.length);
  const selectedCountryRow = overview.countries.find((row) => discoverCountryIdentity(row.country) === discoverCountryIdentity(region));
  const sceneArtistTotal = region === "Worldwide"
    ? overview.catalogTotal ?? localStats.artists
    : selectedCountryRow?.count ?? overview.genreTotal;
  const metrics = [
    { label: "artists", value: sceneArtistTotal, tint: colors.amber },
    { label: "upcoming events", value: sceneProjection.eventCount, tint: colors.gold },
    { label: "venues", value: sceneProjection.venueCount, tint: colors.cool },
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
          <Text style={styles.kicker}>FIND MUSIC AND SHOWS</Text>
          <Text style={[styles.title, compact && styles.titleCompact]} accessibilityRole="header">Discover</Text>
          <Text style={styles.tagline}>See upcoming events, popular artists, venues, and fan picks in one place.</Text>
        </View>
        <View style={styles.scenePill} accessible accessibilityLabel={`Showing Discover for ${region}`}>
          <Icon name={region === "Worldwide" ? "globe" : "pin"} size={15} color={colors.amber} />
          <Text style={styles.scenePillText} numberOfLines={1}>{region}</Text>
        </View>
      </View>

      <View style={styles.controlsCard}>
        <View style={[styles.controlTop, compact && styles.controlTopCompact]}>
          <View style={styles.controlCopy}>
            <Text style={styles.controlLabel}>CHOOSE AN AREA</Text>
            <Text style={styles.controlHint}>Events, venues, and artists update for the area you choose.</Text>
          </View>
        </View>
        <Text style={styles.controlLabel}>COUNTRY OR REGION</Text>
        <View style={styles.regionGrid} accessibilityRole="radiogroup" accessibilityLabel="Choose an area to explore">
          {sceneCountries.map((country) => {
            const selected = country.country.toLocaleLowerCase() === region.toLocaleLowerCase();
            return (
              <Pressable
                key={country.country}
                style={[styles.regionChip, compact && styles.regionChipCompact, veryCompact && styles.regionChipVeryCompact, selected && styles.regionChipSelected]}
                onPress={() => pickRegion(country.country)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={country.country + (country.count != null ? ", " + country.count + " upcoming events" : "")}
              >
                <View style={styles.regionChipCopy}>
                  <Text style={[styles.regionText, selected && styles.regionTextSelected]} numberOfLines={2}>{country.country}</Text>
                  {country.count != null && <Text style={[styles.regionCount, selected && styles.regionCountSelected]}>{compactDiscoverNumber(country.count)} upcoming</Text>}
                </View>
                {selected && <Icon name="check" size={14} color={colors.amber} />}
              </Pressable>
            );
          })}
          {compact && countries.length > 3 && (
            <Pressable
              style={[styles.regionChip, styles.moreScenesChip, styles.regionChipCompact, veryCompact && styles.regionChipVeryCompact]}
              onPress={() => setSceneExpanded((value) => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded: sceneExpanded }}
              accessibilityLabel={sceneExpanded ? "Show fewer areas" : "Show " + hiddenSceneCount + " more areas"}
            >
              <View style={styles.regionChipCopy}>
                <Text style={styles.regionText}>{sceneExpanded ? "Show fewer" : "More areas"}</Text>
                <Text style={styles.regionCount}>{sceneExpanded ? "Fewer choices" : "+" + hiddenSceneCount + " areas"}</Text>
              </View>
              <Icon name={sceneExpanded ? "x" : "chevron-down"} size={14} color={colors.textDim} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.upcomingSection}>
        <View style={styles.livePanel}>
          <View style={[styles.livePanelHead, compact && styles.livePanelHeadCompact]}>
            <SectionHeading
              eyebrow="PLAN A NIGHT OUT"
              title="Upcoming events"
              detail={liveScope === LIVE_EVENT_SCOPE.LOCAL ? liveScopeLabel({ scope: liveScope, homeCity }) : region}
              action={(
                <Pressable style={styles.sectionAction} onPress={() => onOpenEvents?.(region)} accessibilityRole="button" accessibilityLabel="Browse all events">
                  <Text style={styles.eventSectionActionText}>Browse all</Text>
                  <Icon name="chevron-right" size={14} color={colors.amber} />
                </Pressable>
              )}
            />
            <EventScopeToggle
              scope={liveScope}
              localLabel={homeCity ? `Near ${homeCity}` : "Near you"}
              worldLabel={region}
              compact={compact}
              onChange={pickLiveScope}
            />
            <View style={styles.rangeControl}>
              <Text style={styles.rangeLabel}>HOW FAR AHEAD?</Text>
              <Text style={styles.rangeHint}>Choose how far ahead to plan. We'll keep your current events here while we find more.</Text>
              <View style={styles.rangeOptions} accessibilityRole="radiogroup" accessibilityLabel="Choose how far ahead to look for events">
                {DISCOVER_RANGE_DAYS.map((days) => {
                  const selected = selectedRangeDays === days;
                  return (
                    <Pressable
                      key={days}
                      style={({ focused, pressed }) => [
                        styles.rangeOption,
                        selected && styles.rangeOptionSelected,
                        pressed && styles.cardPressed,
                        focused && focusRing,
                      ]}
                      onPress={() => selectEventRange(days)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Show events over the next ${days} days`}
                    >
                      <Text style={[styles.rangeOptionText, selected && styles.rangeOptionTextSelected]}>{days} days</Text>
                    </Pressable>
                  );
                })}
              </View>
              {eventRange.scopeKey === rangeScopeKey && eventRange.status === "loading" && !rangeMatchesScene ? (
                <View style={styles.rangeStatus} accessibilityLiveRegion="polite">
                  <ActivityIndicator size="small" color={colors.amber} />
                  <Text style={styles.rangeStatusText}>Finding more upcoming events...</Text>
                </View>
              ) : null}
              {eventRange.scopeKey === rangeScopeKey && eventRange.status === "error" ? (
                <Pressable style={({ focused, pressed }) => [styles.rangeRetry, pressed && styles.cardPressed, focused && focusRing]} onPress={() => selectEventRange(eventRange.days || selectedRangeDays)} accessibilityRole="button" accessibilityLabel="Try loading this event range again">
                  <Text style={styles.rangeRetryText}>Couldn't load more dates. Try again.</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <DiscoverEventBanner
            key={`events:${liveScope}:${discoverCountryIdentity(region)}`}
            slides={eventBannerSlides}
            compact={compact}
            active
            onOpenEvent={onOpen}
          />
          {visibleLiveEvents.length === 0 ? (
            <View style={styles.liveEmpty} accessibilityLiveRegion="polite">
              <Icon name={liveScope === LIVE_EVENT_SCOPE.WORLDWIDE ? "globe" : "pin"} size={19} color={colors.textFaint} />
              <Text style={styles.liveEmptyText}>
                {discoverySidebarStatus === "loading"
                  ? "Loading upcoming events…"
                  : liveScope === LIVE_EVENT_SCOPE.LOCAL
                    ? "No events are listed near your home area yet. Try Worldwide."
                    : `No upcoming events are listed for ${region} yet.`}
              </Text>
            </View>
          ) : (
            <View style={styles.liveRows}>
              {visibleLiveEvents.map((event) => (
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
          {rangeMatchesScene && eventRange.status === "ready" ? (
            <Text style={styles.rangeSummary} accessibilityLiveRegion="polite">
              {"Showing " + visibleLiveEvents.length + " event" + (visibleLiveEvents.length === 1 ? "" : "s") + " over the next " + selectedRangeDays + " days."}
            </Text>
          ) : null}
          {rangeHasMore ? (
            <Pressable
              style={({ focused, pressed }) => [styles.loadMoreEvents, pressed && styles.cardPressed, focused && focusRing, eventRange.status === "loading" && styles.loadMoreEventsDisabled]}
              onPress={loadMoreEvents}
              disabled={eventRange.status === "loading"}
              accessibilityRole="button"
              accessibilityState={{ disabled: eventRange.status === "loading" }}
              accessibilityLabel={`Load ${DISCOVER_RANGE_BATCH} more upcoming events`}
            >
              {eventRange.status === "loading" ? <ActivityIndicator size="small" color={colors.amber} /> : null}
              <Text style={styles.loadMoreEventsText}>{eventRange.status === "loading" ? "Finding more events..." : `Load ${DISCOVER_RANGE_BATCH} more events`}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.nearSection}>
        <SectionHeading
          eyebrow="AROUND YOU"
          title="Near you"
          detail={homeCity ? `Shows, festivals, and venues near ${homeCity}.` : "Add your home area to see nearby events."}
        />
        <Pressable
          style={({ pressed }) => [styles.nearHero, pressed && styles.cardPressed]}
          onPress={onOpenNearby}
          accessibilityRole="button"
          accessibilityLabel={homeCity ? `Find live events near ${homeCity}` : "Find live events near you"}
        >
          <View style={styles.nearHeroIcon}><Icon name="map" size={24} color={colors.good} /></View>
          <View style={styles.venueHeroCopy}>
            <Text style={styles.venueHeroTitle}>{homeCity ? `What’s on near ${homeCity}` : "Add your home area"}</Text>
            <Text style={styles.venueHeroDetail}>See nearby events on a map or by date.</Text>
          </View>
          <Icon name="chevron-right" size={21} color={colors.good} />
        </Pressable>
      </View>

      <View style={styles.venueSection}>
        <SectionHeading
          eyebrow="PLACES TO GO"
          title="Venues"
          detail={region === "Worldwide"
            ? "Browse venues, cities, and upcoming lineups."
            : `Venues with upcoming events in ${region}.`}
          action={(
            <Pressable style={styles.sectionAction} onPress={() => onOpenVenues?.(region)} accessibilityRole="button" accessibilityLabel="Browse all venues">
              <Text style={styles.sectionActionText}>Browse all</Text>
              <Icon name="chevron-right" size={14} color={colors.cool} />
            </Pressable>
          )}
        />
        <Pressable
          style={({ pressed }) => [styles.venueHero, pressed && styles.cardPressed]}
          onPress={() => onOpenVenues?.(region)}
          accessibilityRole="button"
          accessibilityLabel="Browse venues"
          accessibilityHint="Browse venues by city and upcoming events"
        >
          <View style={styles.venueHeroIcon}><Icon name="pin" size={24} color={colors.cool} /></View>
          <View style={styles.venueHeroCopy}>
            <Text style={styles.venueHeroTitle}>Find a venue</Text>
            <Text style={styles.venueHeroDetail}>{region === "Worldwide" ? "Browse venues around the world." : `Browse venues and upcoming events in ${region}.`}</Text>
          </View>
          <Icon name="chevron-right" size={21} color={colors.cool} />
        </Pressable>
        {venueRows.length > 0 ? (
          <View style={styles.venueRows}>
            {venueRows.map((venue) => (
              <VenueDiscoveryCard key={venue.identity || `${venue.name}|${venue.place || ""}`} venue={venue} compact onPress={() => onOpenVenue?.(venue)} />
            ))}
          </View>
        ) : (
          <View style={styles.liveEmpty} accessibilityLiveRegion="polite">
            <Icon name="pin" size={19} color={colors.textFaint} />
            <Text style={styles.liveEmptyText}>No venues with upcoming events are listed for {region} yet.</Text>
          </View>
        )}
      </View>

      <View style={styles.quickSection}>
        <SectionHeading eyebrow="MORE TO EXPLORE" title="More ways to explore" detail="Top-rated shows and artist communities" />
        <View style={styles.quickGrid}>
          <QuickAction icon="trophy" title="Top-rated shows" detail={region === "Worldwide" ? "Shows members rated highest" : `Highly rated shows in ${region}`} tint={colors.gold} onPress={() => onOpenTopRated?.(region)} basis={actionBasis} />
          <QuickAction icon="you" title="Fan clubs" detail="Meet other fans of an artist" tint={colors.magenta} onPress={onOpenFanClubs} basis={actionBasis} />
        </View>
      </View>

      <View style={[styles.metrics, compact && styles.metricsCompact]}>{metrics.map((metric) => <MetricTile key={metric.label} {...metric} compact={compact} />)}</View>

      <View style={styles.loungePanel}>
        <SectionHeading eyebrow="CONCERT CONVERSATIONS" title="Popular lounges" detail={region === "Worldwide" ? "The most active concert conversations. Private member data is not used." : `Active concert conversations in ${region}. Private member data is not used.`} />
        {loungeRows.length === 0 ? (
          <View style={styles.liveEmpty}>
            <Icon name="comment" size={19} color={colors.textFaint} />
            <Text style={styles.liveEmptyText}>Concert lounges in {region} will appear when people start talking.</Text>
          </View>
        ) : (
          <View style={styles.liveRows}>
            {loungeRows.map((lounge) => <PopularLoungeCard key={lounge.key} lounge={lounge} compact onPress={() => onOpenLounge?.(lounge)} />)}
          </View>
        )}
      </View>

      {overviewStatus === "refreshing" && showOverviewContent && (
        <View style={styles.refreshNotice} accessibilityLiveRegion="polite"><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.refreshNoticeText}>Updating {region}</Text></View>
      )}
      {overviewStatus === "error" && showOverviewContent && (
        <View style={styles.refreshError} accessibilityLiveRegion="assertive">
          <Text style={styles.refreshErrorText} selectable>Could not update. Showing the last results.</Text>
          <Pressable style={styles.refreshRetryButton} onPress={() => requestOverview({ preserve: true, force: true })} accessibilityRole="button" accessibilityLabel="Retry updating Discover"><Text style={styles.refreshRetry}>Retry</Text></Pressable>
        </View>
      )}

      {!showOverviewContent ? (
        <OverviewState state={overviewState} region={region} onRetry={() => requestOverview({ force: true })} onWorldwide={() => pickRegion("Worldwide")} />
      ) : (
        <>
          <DiscoverChart rows={overview.chart.rows} source={overview.chart.source} info={overview.chart} query={query} onQuery={setQuery} onOpenArtist={openArtist} compact={compact} narrow={veryCompact} />
        </>
      )}

      <DiscoverPhotos photos={scenePhotos} photoUris={photoUris} compact={compact} width={width} onOpenPhotos={openPhotos} />
      {showOverviewContent ? (
        <DiscoverGenres
          genres={overview.genres}
          selected={selectedGenre}
          onSelect={setSelectedGenre}
          total={overview.genreTotal}
          rows={genreRows}
          fallbackRows={overview.chart.rows}
          attendanceRows={sceneAttendance}
          status={genreStatus}
          region={region}
          compact={compact}
          onOpenArtist={openArtist}
          onRetry={retryGenre}
        />
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
  controlsCard: { width: "100%", minWidth: 0, overflow: "hidden", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, borderCurve: "continuous", padding: 14, gap: 10 },
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
  regionGrid: { width: "100%", minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  regionChip: { flexBasis: 180, flexGrow: 1, minWidth: 0, minHeight: 58, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  regionChipCompact: { flexBasis: "47%" },
  regionChipVeryCompact: { flexBasis: "100%" },
  regionChipCopy: { flex: 1, minWidth: 0, justifyContent: "center" },
  moreScenesChip: { borderStyle: "dashed", backgroundColor: colors.bgElev },
  regionChipSelected: { borderColor: colors.amber, backgroundColor: colors.amber + "16" },
  regionText: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 16, fontWeight: "800" },
  regionTextSelected: { color: colors.amber, fontWeight: "900" },
  regionCount: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, lineHeight: 12, fontWeight: "800", paddingTop: 2, textTransform: "uppercase" },
  regionCountSelected: { color: colors.amber },
  venueSection: { gap: 10 },
  upcomingSection: { gap: 10 },
  nearSection: { gap: 10 },
  sectionAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 10, borderRadius: radius.pill },
  sectionActionText: { color: colors.cool, fontFamily: font, fontSize: 12, fontWeight: "900" },
  eventSectionActionText: { color: colors.amber, fontFamily: font, fontSize: 12, fontWeight: "900" },
  venueHero: { minHeight: 96, flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: `${colors.cool}66`, backgroundColor: `${colors.cool}0F`, ...shadow.card },
  nearHero: { minHeight: 96, flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: `${colors.good}66`, backgroundColor: `${colors.good}0F`, ...shadow.card },
  venueHeroIcon: { width: 50, height: 50, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: `${colors.cool}55`, backgroundColor: colors.bgElev },
  nearHeroIcon: { width: 50, height: 50, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: `${colors.good}55`, backgroundColor: colors.bgElev },
  venueHeroCopy: { flex: 1, minWidth: 0 },
  venueHeroTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  venueHeroDetail: { color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 17, paddingTop: 3 },
  venueRows: { gap: 8 },
  quickSection: { gap: 10 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metrics: { flexDirection: "row", gap: 10 },
  metricsCompact: { flexWrap: "wrap" },
  livePanel: { minWidth: 0, width: "100%", gap: 10, padding: 14, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev, ...shadow.card },
  loungePanel: { width: "100%", gap: 10, padding: 14, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev, ...shadow.card },
  livePanelHead: { gap: 10 },
  livePanelHeadCompact: { alignItems: "stretch" },
  rangeControl: { gap: 7, paddingTop: 2 },
  rangeLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 1.2 },
  rangeHint: { color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 17 },
  rangeOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rangeOption: { minHeight: 44, minWidth: 78, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  rangeOptionSelected: { borderColor: colors.amber, backgroundColor: `${colors.amber}16` },
  rangeOptionText: { color: colors.textDim, fontFamily: font, fontSize: 12, fontWeight: "900" },
  rangeOptionTextSelected: { color: colors.amber },
  rangeStatus: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 7 },
  rangeStatusText: { color: colors.textDim, fontFamily: font, fontSize: 12 },
  rangeRetry: { minHeight: 44, justifyContent: "center" },
  rangeRetryText: { color: colors.danger, fontFamily: font, fontSize: 12, fontWeight: "900" },
  rangeSummary: { color: colors.textFaint, fontFamily: font, fontSize: 11, lineHeight: 16, textAlign: "center" },
  liveRows: { gap: 8 },
  liveLink: { borderRadius: radius.md },
  loadMoreEvents: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.amber}66`, backgroundColor: `${colors.amber}0F` },
  loadMoreEventsDisabled: { opacity: 0.72 },
  loadMoreEventsText: { color: colors.amber, fontFamily: font, fontSize: 12, fontWeight: "900" },
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
