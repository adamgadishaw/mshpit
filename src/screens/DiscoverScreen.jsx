import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, displayFont, font, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import { countryForCity } from "../geo";
import Icon from "../components/Icon";
import DiscoverChart from "../components/discover/DiscoverChart";
import DiscoverGenres from "../components/discover/DiscoverGenres";
import { DiscoverPhotos, FriendsListening } from "../components/discover/DiscoverCommunity";
import { MetricTile, OverviewState, QuickAction, SectionHeading } from "../components/discover/DiscoverPrimitives";
import {
  cancelDiscoverRequest,
  compactDiscoverNumber,
  discoverPlaybackTrack,
  discoverSectionState,
  hasDiscoverOverviewContent,
  isCurrentDiscoverAccountRequest,
  normalizeDiscoverArtistRows,
  normalizeDiscoverOverview,
  normalizeFriendsListening,
  orderDiscoverCountries,
  selectDiscoverPhotos,
} from "../domain/discoverView.mjs";

const EMPTY_OVERVIEW = normalizeDiscoverOverview({});

function useLatestCallback(callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args) => callbackRef.current?.(...args), []);
}

function SourceToggle({ value, onChange }) {
  return (
    <View style={styles.sourceToggle} accessibilityRole="tablist">
      {[
        { key: "popularity", label: "Trending" },
        { key: "plays", label: "On Pit" },
      ].map((option) => {
        const selected = value === option.key;
        return (
          <Pressable
            key={option.key}
            style={[styles.sourceOption, selected && styles.sourceOptionSelected]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.label} chart`}
          >
            <Text style={[styles.sourceOptionText, selected && styles.sourceOptionTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function DiscoverScreen({
  onOpenTopRated,
  onOpenArtist,
  onOpenNearby,
  onOpenFanClubs,
  onOpenVenues,
  onOpenPhotos,
  onPlay,
  onOpenProfile,
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
    loadFriendsListeningStrict,
  } = useStore();
  const { width } = useWindowDimensions();
  const compact = width < 620;
  const veryCompact = width < 380;
  const wide = width >= 900;
  const actionBasis = veryCompact ? "100%" : wide ? "23%" : "48%";

  const accountId = session?.id || null;
  const homeCountry = countryForCity(session?.home?.city);
  const [regionChoice, setRegionChoice] = useState(() => ({ accountId, value: homeCountry || "Worldwide", touched: false }));
  const region = regionChoice.accountId === accountId ? regionChoice.value : homeCountry || "Worldwide";
  const [chartBy, setChartBy] = useState("popularity");
  const [query, setQuery] = useState("");
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [overviewStatus, setOverviewStatus] = useState("idle");
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [genreRows, setGenreRows] = useState([]);
  const [genreStatus, setGenreStatus] = useState("idle");
  const [friendRows, setFriendRows] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(!!session);
  const [friendsError, setFriendsError] = useState(false);

  const overviewLoaderRef = useRef(loadDiscoverOverview);
  overviewLoaderRef.current = loadDiscoverOverview;
  const genreLoaderRef = useRef(loadDiscoverGenre);
  genreLoaderRef.current = loadDiscoverGenre;
  const friendsLoaderRef = useRef(loadFriendsListeningStrict);
  friendsLoaderRef.current = loadFriendsListeningStrict;
  const overviewRequestRef = useRef({ sequence: 0, controller: null });
  const genreRequestRef = useRef({ sequence: 0, controller: null });
  const friendsRequestRef = useRef({ sequence: 0, accountId, controller: null });
  const openArtist = useLatestCallback(onOpenArtist);
  const openProfile = useLatestCallback(onOpenProfile);
  const openPhotos = useLatestCallback(onOpenPhotos);
  const play = useLatestCallback(onPlay);

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
    overviewLoaderRef.current({ by: chartBy, country: region, signal: controller.signal, force })
      .then((payload) => {
        if (controller.signal.aborted || overviewRequestRef.current.sequence !== sequence) return;
        const normalized = normalizeDiscoverOverview(payload, chartBy);
        normalized.countries = orderDiscoverCountries(normalized.countries, homeCountry);
        setOverview(normalized);
        setOverviewStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted && overviewRequestRef.current.sequence === sequence) setOverviewStatus("error");
      });
    return controller;
  }, [chartBy, homeCountry, region]);

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

  const requestFriends = useCallback(() => {
    friendsRequestRef.current.controller?.abort();
    const sequence = friendsRequestRef.current.sequence + 1;
    const controller = accountId ? new AbortController() : null;
    friendsRequestRef.current = { sequence, accountId, controller };
    setFriendRows([]);
    setFriendsError(false);
    if (!accountId) {
      setFriendsLoading(false);
      return;
    }
    setFriendsLoading(true);
    Promise.resolve()
      .then(() => friendsLoaderRef.current({ signal: controller.signal }))
      .then((rows) => {
        if (isCurrentDiscoverAccountRequest(friendsRequestRef.current, sequence, accountId)) {
          setFriendRows(normalizeFriendsListening(rows));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && isCurrentDiscoverAccountRequest(friendsRequestRef.current, sequence, accountId)) setFriendsError(true);
      })
      .finally(() => {
        if (isCurrentDiscoverAccountRequest(friendsRequestRef.current, sequence, accountId)) setFriendsLoading(false);
      });
  }, [accountId]);

  useEffect(() => {
    requestFriends();
    return () => {
      friendsRequestRef.current.controller?.abort();
      const sequence = friendsRequestRef.current.sequence;
      friendsRequestRef.current = { sequence: sequence + 1, accountId: null, controller: null };
    };
    // Store actions are intentionally omitted: the legacy context recreates
    // them on state changes and would restart these reads indefinitely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    if (selectedGenre && !overview.genres.some((item) => item.genre === selectedGenre && item.genre !== "Other")) setSelectedGenre(null);
  }, [overview.genres, selectedGenre]);

  const pickRegion = (country) => {
    setQuery("");
    setRegionChoice({ accountId, value: country, touched: true });
  };
  const pickChartSource = (source) => {
    setQuery("");
    setChartBy(source);
  };
  const playArtistRow = useCallback((row) => {
    const track = discoverPlaybackTrack(row);
    if (track) play(track);
  }, [play]);
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
            <Text style={styles.controlHint}>{chartBy === "plays" ? "Real member listening" : "Current catalog momentum"}</Text>
          </View>
          <SourceToggle value={chartBy} onChange={pickChartSource} />
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

      <View style={styles.quickSection}>
        <SectionHeading eyebrow="START HERE" title="Explore your way" detail="Shortcuts to the parts of Pit that help you make plans" />
        <View style={styles.quickGrid}>
          <QuickAction icon="map" title="Near you" detail={session?.home?.city ? `Shows around ${session.home.city}` : "Shows and scenes close by"} tint={colors.good} onPress={onOpenNearby} basis={actionBasis} />
          <QuickAction icon="pin" title="Find venues" detail="Browse rooms by city and lineup" tint={colors.cool} onPress={onOpenVenues} basis={actionBasis} />
          <QuickAction icon="trophy" title="Top rated" detail="Concerts members loved most" tint={colors.gold} onPress={onOpenTopRated} basis={actionBasis} />
          <QuickAction icon="you" title="Fan clubs" detail="Join artist communities" tint={colors.magenta} onPress={onOpenFanClubs} basis={actionBasis} />
        </View>
      </View>

      <View style={[styles.metrics, compact && styles.metricsCompact]}>{metrics.map((metric) => <MetricTile key={metric.label} {...metric} compact={compact} />)}</View>

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
          <DiscoverChart rows={overview.chart.rows} source={overview.chart.source} info={overview.chart} query={query} onQuery={setQuery} onOpenArtist={openArtist} onPlay={playArtistRow} compact={compact} narrow={veryCompact} />
          <DiscoverGenres genres={overview.genres} selected={selectedGenre} onSelect={setSelectedGenre} total={overview.genreTotal} rows={genreRows} status={genreStatus} region={region} onOpenArtist={openArtist} onPlay={playArtistRow} onRetry={retryGenre} />
        </>
      )}

      <FriendsListening rows={friendRows} loading={friendsLoading} error={friendsError} signedIn={!!session} onRetry={requestFriends} onOpenProfile={openProfile} onPlay={play} />
      <DiscoverPhotos photos={photos} photoUris={photoUris} compact={compact} width={width} onOpenPhotos={openPhotos} />
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
  quickSection: { gap: 10 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metrics: { flexDirection: "row", gap: 10 },
  metricsCompact: { flexWrap: "wrap" },
  refreshNotice: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.pill, backgroundColor: colors.bgElev },
  refreshNoticeText: { color: colors.textDim, fontFamily: font, fontSize: 12, fontWeight: "700" },
  refreshError: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.danger}55`, backgroundColor: colors.bgElev },
  refreshErrorText: { color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 17, textAlign: "center" },
  refreshRetryButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  refreshRetry: { color: colors.danger, fontFamily: font, fontSize: 12, fontWeight: "900", paddingVertical: 8 },
});
