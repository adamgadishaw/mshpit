import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { colors } from "../../theme";
import Icon from "../Icon";
import VinylRefreshBoundary from "../VinylRefreshBoundary";
import DiscoverEventList from "./DiscoverEventList";
import { PopularLoungeCard } from "../LiveDiscoveryCards";
import { createBrowseScrollReturn } from "../../domain/iosBrowseReturn.mjs";
import { DISCOVER_PROGRAMME_SECTIONS } from "../../domain/discoverProgramme.mjs";
import { DISCOVER_RANGE_DAYS } from "../../domain/discoverEventRange.mjs";
import { buildDiscoverArtistSpotlight, discoverGenreDistribution, discoverGenreLabel, filterDiscoverRows, rankDiscoverGenres } from "../../domain/discoverView.mjs";
import { liveEventTitle } from "../../domain/liveDiscovery.mjs";
import { calendarDateKey } from "../../domain/dataPolicy.mjs";
import { artistInitials } from "../../domain/artistInitials.mjs";
import { isHttp, proxied } from "../../lib/img";

const GUTTER = 20;
const GAP = 12;
const WASHES = ["#49301F", "#233747", "#462A40", "#283E35", "#3A2D4E", "#4C3430"];
const washFor = (name) => WASHES[Array.from(String(name || "")).reduce((sum, char) => sum + char.charCodeAt(0), 0) % WASHES.length];

export function browseDate(value) {
  const key = calendarDateKey(value);
  if (key == null) return "Date to be announced";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Math.floor(key / 10000), Math.floor(key % 10000 / 100) - 1, key % 100, 12)));
}

// Carry the same approved photo and its supplied credit into show details.
// The incoming slides are produced by the existing fail-closed media selector.
export function eventFromBrowseSlide(slide) {
  const media = slide.media;
  return { ...slide.event, discoverPhotoCredit: media?.by ? {
    creator: media.by, sourcePage: media.sourcePage, license: media.license, licenseUrl: media.licenseUrl,
  } : null };
}

export function BrowseArtwork({ uri, name, size = 360, style, contain = false, proxy = false }) {
  const [failedUri, setFailedUri] = useState(null);
  const source = uri ? (proxy && isHttp(uri) ? proxied(uri, Math.ceil(size * 2)) : uri) : null;
  return <View style={[styles.artwork, { backgroundColor: washFor(name) }, style]} accessible={false}>
    <View style={styles.artworkFallback}><Text style={styles.initials}>{artistInitials(name)}</Text></View>
    {source && failedUri !== source ? <Image source={{ uri: source }} style={StyleSheet.absoluteFill}
      contentFit={contain ? "contain" : "cover"} cachePolicy="memory-disk" enforceEarlyResizing
      recyclingKey={source} accessible={false} onError={() => setFailedUri(source)} /> : null}
  </View>;
}

function TextAction({ children, onPress, label, icon = "chevron-right", selected = false }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
    <Text style={[styles.actionText, selected && styles.selectedText]}>{children}</Text>
    {icon ? <Icon name={icon} size={16} color={colors.amber} /> : null}
  </Pressable>;
}

function SectionHeader({ title, action, onPress, detail }) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.25;
  return <View style={[styles.sectionHeader, largeText && styles.sectionHeaderLarge]}>
    <View style={[styles.headingCopy, largeText && styles.sectionHeadingLarge]}><Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}</View>
    {action && onPress ? <TextAction onPress={onPress} label={`${action}: ${title}`}>{action}</TextAction> : null}
  </View>;
}

export function BrowseRail({ children, label, cardWidth, railKey }) {
  return <ScrollView key={railKey} horizontal directionalLockEnabled nestedScrollEnabled
    showsHorizontalScrollIndicator={false} contentInsetAdjustmentBehavior="never"
    keyboardShouldPersistTaps="handled" snapToInterval={cardWidth ? cardWidth + GAP : undefined}
    decelerationRate="fast" disableIntervalMomentum={!!cardWidth}
    contentContainerStyle={styles.railContent} style={styles.rail} accessibilityLabel={label}>
    {children}
  </ScrollView>;
}

export function ArtistRail({ rows = [], title = "Popular artists", onOpen, action, onAction, cardWidth = 154, detail }) {
  if (!rows.length) return null;
  return <View style={styles.section}>
    <SectionHeader title={title} action={action} onPress={onAction} detail={detail} />
    <BrowseRail label={title} cardWidth={cardWidth}>
      {rows.map((artist, index) => <Pressable key={artist.key || artist.artistKey || `${artist.name}:${index}`}
        onPress={() => onOpen?.(artist)} accessibilityRole="button" accessibilityLabel={`Open ${artist.name}`}
        style={({ pressed }) => [styles.artistCard, { width: cardWidth }, pressed && styles.pressed]}>
        <BrowseArtwork uri={artist.photo} name={artist.name} size={cardWidth} proxy style={styles.artistArt} />
        <Text style={styles.artistName}>{artist.name}</Text>
        {artist.genre ? <Text style={styles.artistDetail}>{discoverGenreLabel(artist.genre)}</Text> : null}
      </Pressable>)}
    </BrowseRail>
  </View>;
}

export function FeaturedRail({ slides = [], artists = [], width, onOpen, onOpenArtist, region }) {
  const cardWidth = Math.min(480, Math.max(240, width - GUTTER * 2 - 12));
  const eventSlides = slides.slice(0, 5);
  const entries = eventSlides.length ? eventSlides : artists.slice(0, 5).map((artist) => ({
    id: artist.key || artist.artistKey || artist.name, title: artist.name, artist,
    media: { uri: artist.photo },
  }));
  if (!entries.length) return null;
  return <View style={styles.section}>
    <SectionHeader title={eventSlides.length ? "Coming to the stage" : "In the spotlight"} />
    <BrowseRail label={eventSlides.length ? "Featured upcoming shows" : "Featured artists"} cardWidth={cardWidth} railKey={`${region}:${eventSlides.length ? "events" : "artists"}`}>
      {entries.map((entry, index) => <Pressable key={entry.id} accessibilityRole="button"
        accessibilityLabel={`Open ${entry.title}${entry.artist ? "" : `. ${browseDate(entry.date)}. ${entry.venue || ""}`}. ${index + 1} of ${entries.length}`}
        onPress={() => entry.artist ? onOpenArtist?.(entry.artist) : onOpen?.(eventFromBrowseSlide(entry))}
        style={({ pressed }) => [styles.feature, { width: cardWidth, backgroundColor: washFor(entry.title) }, pressed && styles.pressed]}>
        <BrowseArtwork uri={entry.media?.uri} name={entry.title} size={cardWidth} style={StyleSheet.absoluteFill}
          proxy={!!entry.artist} contain={entry.media?.source === "catalog"} />
        <View style={styles.featureTop}><View style={styles.featureBadge}><Text style={styles.featureBadgeText}>{entry.artist ? "ARTIST SPOTLIGHT" : "LIVE MUSIC"}</Text></View></View>
        <View style={styles.featureSpace} />
        <View style={styles.featureCopy}>
          <Text style={styles.featureTitle}>{entry.title}</Text>
          <View style={styles.featureBottom}>
            <Text style={styles.featureDetail}>{entry.artist
              ? discoverGenreLabel(entry.artist.genre) || "Explore the artist"
              : [browseDate(entry.date), entry.venue || entry.place].filter(Boolean).join(" · ")}</Text>
            <View style={styles.featureArrow}><Icon name="chevron-right" color="#FFFFFF" size={17} /></View>
          </View>
        </View>
      </Pressable>)}
    </BrowseRail>
  </View>;
}

export function BrowseCategories({ selected, onSelect }) {
  const scroll = useRef(null);
  const positions = useRef({});
  useEffect(() => { scroll.current?.scrollTo?.({ x: Math.max(0, (positions.current[selected] || 0) - GUTTER), animated: false }); }, [selected]);
  return <ScrollView ref={scroll} horizontal directionalLockEnabled showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.categoryContent} style={styles.categories} accessibilityRole="tablist" accessibilityLabel="Discover sections">
    {DISCOVER_PROGRAMME_SECTIONS.map((section) => <Pressable key={section.key} nativeID={`discover-tab-${section.key}`}
      accessibilityRole="tab" accessibilityLabel={section.label} accessibilityState={{ selected: selected === section.key }}
      onLayout={(event) => { positions.current[section.key] = event.nativeEvent.layout.x;
        if (selected === section.key) scroll.current?.scrollTo?.({ x: Math.max(0, event.nativeEvent.layout.x - GUTTER), animated: false }); }}
      onPress={() => onSelect(section.key)}
      style={({ pressed }) => [styles.category, selected === section.key && styles.categorySelected, pressed && styles.pressed]}>
      <Text style={[styles.categoryText, selected === section.key && styles.categoryTextSelected]}>{section.label}</Text>
    </Pressable>)}
  </ScrollView>;
}

export function GenreBrowse({ genres, selected, onSelect, width }) {
  if (!genres.length) return null;
  const cardWidth = Math.min(220, Math.max(146, width * .4));
  return <View style={styles.section}>
    <SectionHeader title="Find your sound" />
    <BrowseRail label="Browse music genres" cardWidth={cardWidth}>
      {genres.map(({ genre }) => <Pressable key={genre} accessibilityRole="button"
        accessibilityLabel={`Browse ${discoverGenreLabel(genre)} artists`} accessibilityState={{ selected: genre === selected }}
        onPress={() => onSelect(genre)} style={({ pressed }) => [styles.genreCard, { width: cardWidth, backgroundColor: washFor(genre) }, pressed && styles.pressed]}>
        <Icon name="music" size={23} color="rgba(255,255,255,0.65)" />
        <Text style={styles.genreTitle}>{discoverGenreLabel(genre)}</Text>
        {genre === selected ? <View style={styles.genreSelected}><Icon name="check" size={14} color="#FFFFFF" /></View> : null}
      </Pressable>)}
    </BrowseRail>
  </View>;
}

export function Recovery({ recovery, onRetry, onRange, onWorldwide, onArtists, onCities }) {
  if (!recovery) return null;
  return <View style={styles.empty} accessibilityLiveRegion="polite">
    {recovery.kind === "loading" ? <ActivityIndicator color={colors.amber} /> : <Icon name="calendar" color={colors.amber} size={25} />}
    <Text style={styles.emptyTitle}>{recovery.kind === "loading" ? "Finding your next show" : recovery.kind === "error" ? "Shows couldn’t load" : "A little quiet here"}</Text>
    <Text style={styles.body} accessibilityRole={recovery.kind === "error" ? "alert" : undefined}>{recovery.message}</Text>
    {recovery.kind !== "loading" ? <View style={styles.recoveryActions}>
      {recovery.kind === "error" ? <TextAction onPress={onRetry}>Try again</TextAction> : null}
      {recovery.nextDays ? <TextAction onPress={() => onRange(recovery.nextDays)}>Next {recovery.nextDays} days</TextAction> : null}
      {recovery.worldwide ? <TextAction onPress={onWorldwide}>Try Worldwide</TextAction> : null}
      {onArtists ? <TextAction onPress={onArtists}>Browse artists</TextAction>
        : recovery.kind === "empty" ? <TextAction onPress={onCities}>Browse cities</TextAction> : null}
    </View> : null}
  </View>;
}

function ExploreRow({ title, detail, icon, onPress }) {
  if (!onPress) return null;
  return <Pressable style={({ pressed }) => [styles.exploreRow, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
    <View style={styles.exploreIcon}><Icon name={icon} color={colors.amber} size={22} /></View>
    <View style={styles.headingCopy}><Text style={styles.rowTitle}>{title}</Text>{detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}</View>
    <Icon name="chevron-right" color={colors.textFaint} size={17} />
  </Pressable>;
}

export default function DiscoverBrowse({ browseReturn, initialBrowse, programme, onProgramme, region, homeCity, countries, onRegion, local, onScope,
  refreshing, onRefresh, refreshError, chart, overviewStatus, onRetryOverview,
  genres, selectedGenre, genreRows, genreStatus, onGenre, onRetryGenre, query, onQuery,
  slides, events, rangeEvents, eventRecovery, eventStatus, rangeLoadingMore, rangeHasMore, selectedRangeDays,
  onRange, eventView, onEventView, listView, onEventList, eventWeek, onEventWeek,
  onOpen, onOpenArtist, onOpenEvents, onOpenTopRated, onOpenCrew, onOpenFanClubs, onOpenLounge,
  loungeRows, panels, recommendations, attendanceRows = [],
}) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [areaOpen, setAreaOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [genreFocused, setGenreFocused] = useState(initialBrowse?.genreFocused === true);
  const scroll = useRef(null);
  const scrollReturn = useRef(null);
  if (!scrollReturn.current) scrollReturn.current = createBrowseScrollReturn(initialBrowse?.scrollY, browseReturn?.save);
  useEffect(() => { browseReturn?.save({ genreFocused }); }, [browseReturn, genreFocused]);
  useEffect(() => {
    const overviewReady = ["ready", "error"].includes(overviewStatus);
    const ready = programme === "shows" ? ["ready", "error"].includes(eventStatus) && !rangeLoadingMore
      : programme === "artists" ? overviewReady && (!genreFocused || ["ready", "error"].includes(genreStatus)) : overviewReady;
    scrollReturn.current.update(scroll.current, ready);
  });
  const width = measuredWidth || Math.min(windowWidth, 840);
  const artistWidth = Math.min(240, Math.max(154, (width - 52) / (fontScale > 1.25 ? 1.4 : 2.1)));
  const popular = chart?.rows || [];
  const visibleArtists = useMemo(() => filterDiscoverRows(popular, query), [popular, query]);
  const rankedGenres = useMemo(() => discoverGenreDistribution(rankDiscoverGenres(genres, popular), 0, { limit: 12 }).genres, [genres, popular]);
  const attendedArtists = useMemo(() => buildDiscoverArtistSpotlight({ genreRows, fallbackRows: popular, attendanceRows,
    selectedGenre: genreFocused ? selectedGenre : null, limit: 8 }).rows.filter((row) => row.discoveryReason === "Recently attended"), [attendanceRows, genreFocused, genreRows, popular, selectedGenre]);
  const chooseProgramme = (value) => { scrollReturn.current.cancel(); setGenreFocused(false); onProgramme(value); scroll.current?.scrollTo?.({ y: 0, animated: false }); };
  const chooseGenre = (genre) => { scrollReturn.current.cancel(); onGenre(genre); onQuery(""); onProgramme("artists"); setGenreFocused(true); scroll.current?.scrollTo?.({ y: 0, animated: false }); };
  // Any new filter or layout intent supersedes a pending Back restoration.
  // Keep retry-only actions direct so recovery can still restore the same view.
  const changeView = (action) => (...args) => { scrollReturn.current.cancel(); action(...args); };
  const pickRegion = changeView((country) => { setAreaOpen(false); onRegion(country); });
  const pickScope = changeView(onScope);
  const pickRange = changeView(onRange);
  const changeQuery = changeView(onQuery);
  const pickEventView = changeView(onEventView);
  const openEventList = changeView(onEventList);
  const pickEventWeek = changeView(onEventWeek);
  const showAllArtists = changeView(() => setGenreFocused(false));
  const toggleArea = changeView(() => setAreaOpen((value) => !value));
  const closeArea = changeView(() => setAreaOpen(false));
  const toggleDates = changeView(() => setDatesOpen((value) => !value));
  return <VinylRefreshBoundary refreshing={refreshing} onRefresh={onRefresh} accessibilityLabel="Refresh Discover" testID="discover-refresh">
    <ScrollView ref={scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag"
      directionalLockEnabled keyboardShouldPersistTaps="handled" onScroll={scrollReturn.current.onScroll} onScrollBeginDrag={scrollReturn.current.onScrollBeginDrag} scrollEventThrottle={32}
      onContentSizeChange={scrollReturn.current.onContentSizeChange}
      onLayout={(event) => { setMeasuredWidth(event.nativeEvent.layout.width); scrollReturn.current.onLayout(event); }}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Discover</Text>
        <Pressable onPress={toggleArea} accessibilityRole="button"
          accessibilityLabel={`Choose an area to explore. Current area: ${region}`} accessibilityState={{ expanded: areaOpen }}
          style={({ pressed }) => [styles.areaButton, pressed && styles.pressed]}>
          <Icon name={region === "Worldwide" ? "globe" : "pin"} size={16} color={colors.amber} />
          <Text style={styles.areaText}>{region}</Text><Icon name="chevron-down" size={14} color={colors.amber} />
        </Pressable>
      </View>
      <BrowseCategories selected={programme} onSelect={chooseProgramme} />
      {areaOpen ? <View style={styles.filterPanel}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Choose an area</Text>
        <Text style={styles.body}>Explore artists and venues in this area. For shows, choose this area or Near you below.</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Choose an area to explore" style={styles.filterWrap}>
          {countries.map((country) => <Pressable key={country.country} onPress={() => pickRegion(country.country)} accessibilityRole="radio"
            accessibilityLabel={country.country} accessibilityState={{ checked: country.country === region }}
            style={({ pressed }) => [styles.filterChip, country.country === region && styles.filterChipSelected, pressed && styles.pressed]}>
            <Text style={[styles.filterText, country.country === region && styles.selectedText]}>{country.country}</Text>
          </Pressable>)}
        </View>
        <TextAction onPress={closeArea} icon="x">Done</TextAction>
      </View> : null}
      {refreshError || overviewStatus === "error" && popular.length > 0 ? <View style={styles.notice} accessibilityLiveRegion="polite">
        <Text style={styles.body}>Some details couldn’t refresh. Your current results are still here.</Text><TextAction onPress={onRefresh}>Retry</TextAction>
      </View> : null}
      <View nativeID={`discover-panel-${programme}`} style={styles.programme}>
      {programme === "shows" ? <>
        {slides.length ? <FeaturedRail slides={slides} width={width} onOpen={onOpen} onOpenArtist={onOpenArtist} region={region} /> : null}
        <View style={styles.section}>
          <SectionHeader title="Upcoming shows" action="See all" onPress={() => onOpenEvents?.(region)} detail={`${local ? homeCity ? `Near ${homeCity}` : "Near you" : region} · Next ${selectedRangeDays} days`} />
          <View style={styles.showControls}>
            <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Event area">
              {[[false, region], [true, homeCity ? `Near ${homeCity}` : "Near you"]].map(([value, label]) => <Pressable key={String(value)} accessibilityRole="radio"
                accessibilityLabel={value ? homeCity ? `Near ${homeCity}` : "Near you" : region} accessibilityState={{ checked: local === value }}
                onPress={() => pickScope(value)} style={({ pressed }) => [styles.segmentButton, local === value && styles.segmentSelected, pressed && styles.pressed]}>
                <Text style={[styles.segmentText, local === value && styles.selectedText]}>{label}</Text>
              </Pressable>)}
            </View>
            <TextAction onPress={toggleDates} icon="chevron-down" label={`Choose event dates. Next ${selectedRangeDays} days`}>{selectedRangeDays} days</TextAction>
          </View>
          {datesOpen ? <View style={styles.dateOptions} accessibilityRole="radiogroup" accessibilityLabel="Choose how far ahead to look">
            {DISCOVER_RANGE_DAYS.map((days) => <Pressable key={days} onPress={() => { pickRange(days); setDatesOpen(false); }} accessibilityRole="radio"
              accessibilityLabel={`Next ${days} days`} accessibilityState={{ checked: days === selectedRangeDays }}
              style={[styles.filterChip, days === selectedRangeDays && styles.filterChipSelected]}><Text style={styles.filterText}>{days} days</Text></Pressable>)}
          </View> : null}
          {!eventRecovery ? <View style={styles.viewControls}>
            <Text style={styles.muted}>{rangeEvents.length || events.length} {(rangeEvents.length || events.length) === 1 ? "show" : "shows"}</Text>
            <View style={styles.viewModes} accessibilityRole="radiogroup" accessibilityLabel="Show events as">
              {[["cards", "Cards", "ticket"], ["list", "List", "menu"]].map(([value, label, icon]) => <Pressable key={value}
                accessibilityRole="radio" accessibilityLabel={`Show events as ${label.toLowerCase()}`} accessibilityState={{ checked: eventView === value }}
                onPress={() => value === "list" ? openEventList() : pickEventView("cards")}
                style={[styles.viewMode, eventView === value && styles.segmentSelected]}><Icon name={icon} size={16} color={eventView === value ? colors.amber : colors.textDim} /><Text style={styles.segmentText}>{label}</Text></Pressable>)}
            </View>
          </View> : null}
          {["loading", "refreshing"].includes(eventStatus) && events.length > 0 ? <View style={styles.loadingMore} accessibilityLiveRegion="polite"><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.muted}>Updating show dates…</Text></View> : null}
          {eventStatus === "error" && events.length > 0 ? <View style={styles.notice}><Text style={styles.body}>More dates couldn’t load.</Text><TextAction onPress={() => onRange(selectedRangeDays)}>Try again</TextAction></View> : null}
          <Recovery recovery={eventRecovery} onRetry={() => onRange(selectedRangeDays)} onRange={pickRange} onWorldwide={() => pickRegion("Worldwide")}
            onArtists={popular.length ? () => chooseProgramme("artists") : null} onCities={() => chooseProgramme("cities")} />
          {!eventRecovery && listView ? <View style={styles.inset}><DiscoverEventList events={rangeEvents} weekKey={eventWeek} onWeekChange={pickEventWeek} loadingMore={rangeLoadingMore} onOpen={onOpen} /></View>
            : !eventRecovery ? <BrowseRail label="Upcoming shows" cardWidth={Math.min(300, width - 64)} railKey={`${region}:${local}`}>
              {events.map((event) => <Pressable key={event.id || `${event.artist}:${event.venue}:${event.date}`} onPress={() => onOpen?.(event)} accessibilityRole="button"
                accessibilityLabel={`Open ${liveEventTitle(event)} at ${event.venue || "the venue"}. ${browseDate(event.date)}`}
                style={({ pressed }) => [styles.showCard, { width: Math.min(300, width - 64) }, pressed && styles.pressed]}>
                <Text style={styles.showDate}>{browseDate(event.date)}</Text><Text style={styles.showTitle}>{liveEventTitle(event)}</Text>
                <Text style={styles.body}>{[event.venue, event.place || event.city].filter(Boolean).join(" · ") || "Venue to be announced"}</Text>
                <View style={styles.showCardFoot}><Text style={styles.actionText}>View show</Text><Icon name="chevron-right" size={17} color={colors.amber} /></View>
              </Pressable>)}
            </BrowseRail> : null}
          {rangeHasMore && !listView && !eventRecovery ? <View style={styles.inset}><TextAction onPress={openEventList}>Browse the full list</TextAction></View> : null}
        </View>
        {!slides.length ? <FeaturedRail artists={popular} width={width} onOpenArtist={onOpenArtist} region={region} /> : null}
        <ArtistRail rows={popular.slice(0, 12)} title={chart?.source === "plays" ? "What fans are playing" : "Popular artists"} cardWidth={artistWidth} onOpen={onOpenArtist} action="See all" onAction={() => chooseProgramme("artists")} />
        <GenreBrowse genres={rankedGenres} width={width} onSelect={chooseGenre} />
        <View style={styles.section}><SectionHeader title="More to explore" /><View style={styles.exploreGroup}>
          <ExploreRow title="Festivals" detail="A whole weekend of live music" icon="calendar" onPress={() => chooseProgramme("festivals")} />
          <ExploreRow title="Music cities" detail="Explore the local scene" icon="globe" onPress={() => chooseProgramme("cities")} />
          <ExploreRow title="Top-rated shows" detail="The nights fans loved" icon="star" onPress={onOpenTopRated ? () => onOpenTopRated(region) : null} />
          <ExploreRow title="Your concert crew" detail="Make plans together" icon="you" onPress={onOpenCrew} />
          <ExploreRow title="Fan clubs" detail="Find people who love your artists" icon="heart" onPress={onOpenFanClubs} />
        </View></View>
        {loungeRows.length ? <View style={styles.section}><SectionHeader title="In the lounges" /><View style={styles.inset}>{loungeRows.map((lounge) => <PopularLoungeCard key={lounge.key} lounge={lounge} compact onPress={() => onOpenLounge?.(lounge)} />)}</View></View> : null}
      </> : programme === "artists" ? <>
        {!query && !genreFocused ? <FeaturedRail artists={popular} width={width} onOpenArtist={onOpenArtist} region={region} /> : null}
        <View style={styles.searchField}><Icon name="search" size={19} color={colors.textDim} /><TextInput value={query} onChangeText={changeQuery}
          placeholder="Artists, genres, or songs" placeholderTextColor={colors.textFaint} accessibilityLabel="Search this artist list"
          autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={styles.searchInput} />
          {query ? <Pressable onPress={() => changeQuery("")} style={styles.clearButton} accessibilityRole="button" accessibilityLabel="Clear artist search"><Icon name="x" size={18} /></Pressable> : null}</View>
        {!genreFocused || query ? (visibleArtists.length ? <ArtistRail rows={visibleArtists} title={query ? "Search results" : chart?.source === "plays" ? "What fans are playing" : "Popular artists"} cardWidth={artistWidth} onOpen={onOpenArtist} />
          : <View style={styles.empty}>{["idle", "loading"].includes(overviewStatus) ? <ActivityIndicator color={colors.amber} /> : null}
            <Text style={styles.emptyTitle}>{query ? `No matches for “${query.trim()}”` : overviewStatus === "error" ? "Artists couldn’t load" : ["idle", "loading"].includes(overviewStatus) ? "Finding artists" : `No artists in ${region} yet`}</Text>
            {query ? <TextAction onPress={() => changeQuery("")}>Clear search</TextAction> : overviewStatus === "error" ? <TextAction onPress={onRetryOverview}>Try again</TextAction> : region !== "Worldwide" ? <TextAction onPress={() => pickRegion("Worldwide")}>Try Worldwide</TextAction> : null}</View>) : null}
        {!query ? <>{genreFocused ? <SectionHeader title="Artists by genre" action="All artists" onPress={showAllArtists} /> : null}<GenreBrowse genres={rankedGenres} selected={selectedGenre} onSelect={chooseGenre} width={width} />
          {selectedGenre ? <View style={styles.section}>
            {genreRows.length ? <ArtistRail rows={genreRows} title={discoverGenreLabel(selectedGenre)} cardWidth={artistWidth} onOpen={onOpenArtist} />
              : <View style={styles.inset}><Text style={styles.sectionTitle} accessibilityRole="header">{discoverGenreLabel(selectedGenre)}</Text>
                {["idle", "loading", "refreshing"].includes(genreStatus) ? <ActivityIndicator color={colors.amber} /> : <Text style={styles.body}>{genreStatus === "error" ? "These artists couldn’t load." : "No artists are listed in this genre yet."}</Text>}</View>}
            {genreStatus === "error" ? <View style={styles.inset}><TextAction onPress={onRetryGenre}>Try again</TextAction></View> : null}
          </View> : null}
          <ArtistRail rows={attendedArtists} title="From shows you attended" cardWidth={artistWidth} onOpen={onOpenArtist} />
          {recommendations ? <View style={styles.inset}>{recommendations}</View> : null}</> : null}
      </> : <View style={styles.inset}>{panels[programme]}</View>}
      </View>
      <View style={styles.endMark} accessible={false}><View style={styles.endLine} /><Icon name="music" size={16} color={colors.amber} /><View style={styles.endLine} /></View>
    </ScrollView>
  </VinylRefreshBoundary>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 840, alignSelf: "center", paddingTop: 12, paddingBottom: 48, backgroundColor: colors.bg },
  header: { paddingHorizontal: GUTTER, gap: 4, paddingBottom: 16, alignItems: "flex-start" },
  title: { color: colors.text, fontFamily: "System", fontSize: 36, fontWeight: "700", letterSpacing: -1.1 },
  areaButton: { minHeight: 44, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 },
  areaText: { color: colors.amber, fontFamily: "System", fontSize: 15, fontWeight: "600", flexShrink: 1 },
  categories: { flexGrow: 0, marginBottom: 24 },
  categoryContent: { paddingHorizontal: GUTTER, gap: 8 },
  category: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 24, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  categorySelected: { backgroundColor: colors.amber },
  categoryText: { color: colors.textDim, fontFamily: "System", fontSize: 15, fontWeight: "600" },
  categoryTextSelected: { color: colors.bg },
  programme: { gap: 30 }, section: { gap: 12 },
  sectionHeader: { paddingHorizontal: GUTTER, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionHeaderLarge: { flexDirection: "column", alignItems: "stretch", gap: 0 },
  sectionHeadingLarge: { flex: 0, alignSelf: "stretch" },
  headingCopy: { flex: 1, minWidth: 0, gap: 4 },
  sectionTitle: { color: colors.text, fontFamily: "System", fontSize: 23, fontWeight: "700", letterSpacing: -.45 },
  sectionDetail: { color: colors.textDim, fontFamily: "System", fontSize: 14 },
  textAction: { minHeight: 44, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 3, flexShrink: 1 },
  actionText: { color: colors.amber, fontFamily: "System", fontSize: 15, fontWeight: "600", flexShrink: 1 },
  selectedText: { color: colors.amber }, rail: { flexGrow: 0 }, railContent: { paddingHorizontal: GUTTER, gap: GAP, alignItems: "flex-start" },
  artwork: { overflow: "hidden" }, artworkFallback: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  initials: { color: "rgba(255,255,255,0.55)", fontFamily: "System", fontSize: 46, fontWeight: "700", letterSpacing: -1 },
  feature: { borderRadius: 18, borderCurve: "continuous", overflow: "hidden", minHeight: 292 },
  featureTop: { padding: 16, alignItems: "flex-start" }, featureBadge: { borderRadius: 7, backgroundColor: "rgba(0,0,0,0.58)", paddingVertical: 6, paddingHorizontal: 8 },
  featureBadgeText: { color: "#FFFFFF", fontFamily: "System", fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
  featureSpace: { minHeight: 130, flex: 1 }, featureCopy: { padding: 16, gap: 6, backgroundColor: "rgba(0,0,0,0.76)" },
  featureTitle: { color: "#FFFFFF", fontFamily: "System", fontSize: 27, fontWeight: "700", letterSpacing: -.55 },
  featureBottom: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureDetail: { flex: 1, color: "#F1E9E3", fontFamily: "System", fontSize: 14, lineHeight: 20 },
  featureArrow: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  artistCard: { gap: 5, minHeight: 44 }, artistArt: { width: "100%", aspectRatio: 1, borderRadius: 12, borderCurve: "continuous", marginBottom: 5 },
  artistName: { color: colors.text, fontFamily: "System", fontSize: 16, fontWeight: "600", letterSpacing: -.2 },
  artistDetail: { color: colors.textDim, fontFamily: "System", fontSize: 13 },
  genreCard: { minHeight: 112, borderRadius: 12, borderCurve: "continuous", padding: 16, justifyContent: "space-between", gap: 18, overflow: "hidden" },
  genreTitle: { color: "#FFFFFF", fontFamily: "System", fontSize: 20, fontWeight: "700", letterSpacing: -.3 },
  genreSelected: { position: "absolute", right: 12, top: 12, width: 23, height: 23, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  inset: { paddingHorizontal: GUTTER, gap: 12 },
  showControls: { paddingHorizontal: GUTTER, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" },
  segment: { flexDirection: "row", padding: 3, borderRadius: 12, backgroundColor: colors.surfaceAlt, flexShrink: 1 },
  segmentButton: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 1 },
  segmentSelected: { backgroundColor: colors.bgElev }, segmentText: { color: colors.textDim, fontFamily: "System", fontSize: 13, fontWeight: "600", flexShrink: 1 },
  viewControls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: GUTTER },
  viewModes: { flexDirection: "row", gap: 4 }, viewMode: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, gap: 6, flexDirection: "row", alignItems: "center", borderRadius: 10 },
  loadingMore: { paddingHorizontal: GUTTER, flexDirection: "row", alignItems: "center", gap: 8 },
  muted: { color: colors.textFaint, fontFamily: "System", fontSize: 13 },
  showCard: { padding: 18, gap: 8, borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  showDate: { color: colors.amber, fontFamily: "System", fontSize: 14, fontWeight: "600" },
  showTitle: { color: colors.text, fontFamily: "System", fontSize: 21, fontWeight: "700", letterSpacing: -.3 },
  showCardFoot: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  body: { color: colors.textDim, fontFamily: "System", fontSize: 15, lineHeight: 22 },
  empty: { marginHorizontal: GUTTER, padding: 22, backgroundColor: colors.surface, borderRadius: 16, borderCurve: "continuous", gap: 10 },
  emptyTitle: { color: colors.text, fontFamily: "System", fontSize: 19, fontWeight: "600" },
  recoveryActions: { flexDirection: "row", flexWrap: "wrap", columnGap: 20, rowGap: 2 },
  notice: { marginHorizontal: GUTTER, marginBottom: 16, padding: 16, gap: 4, backgroundColor: colors.surfaceAlt, borderRadius: 12 },
  filterPanel: { marginHorizontal: GUTTER, marginBottom: 24, padding: 16, backgroundColor: colors.surface, borderRadius: 16, gap: 12 },
  filterWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, filterChip: { minHeight: 44, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.surfaceAlt, justifyContent: "center" },
  filterChipSelected: { borderWidth: 1, borderColor: colors.amber }, filterText: { color: colors.text, fontFamily: "System", fontSize: 15 },
  dateOptions: { paddingHorizontal: GUTTER, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  searchField: { marginHorizontal: GUTTER, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 4, backgroundColor: colors.surfaceAlt, borderRadius: 12, minHeight: 48 },
  searchInput: { color: colors.text, fontFamily: "System", fontSize: 17, paddingVertical: 12, flex: 1, minWidth: 0 },
  clearButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  exploreGroup: { marginHorizontal: GUTTER }, exploreRow: { minHeight: 76, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.lineSoft },
  exploreIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: colors.text, fontFamily: "System", fontSize: 17, fontWeight: "600" }, rowDetail: { color: colors.textDim, fontFamily: "System", fontSize: 13 },
  endMark: { marginTop: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14 }, endLine: { width: 28, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  pressed: { opacity: .66 },
});
