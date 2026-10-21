import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, displayFont, focusRing, font, mono, radius, space } from "../../theme";
import { countryForCity } from "../../geo";
import { buildDiscoverVenueCities } from "../../domain/discoverVenues.mjs";
import { discoverVenueCityChoices, discoverVenueCityMatches, discoverVenueExplorerRows } from "../../domain/discoverVenueExplorer.mjs";
import { eventDateMeta, venueHomePlaceId } from "../../domain/venueDiscovery.mjs";
import Icon from "../Icon";
import VenueMap from "./DiscoverVenueMap";
import { useVenueMapCatalogue } from "./useVenueMapCatalogue";
import { reconcileVenueMapSelection, snapshotVenueMapSelection } from "../../domain/venueMapSelection.mjs";

const EMPTY = [];
const feedback = ({ pressed, hovered, focused }) => [hovered && styles.hover, pressed && styles.pressed, focused && focusRing];

export default function DiscoverVenues({ region = "Worldwide", homeCity = "", venueDirectoryIndex = EMPTY, tourDates = EMPTY, session, onOpenVenue, onOpenEvent, onOpenVenues }) {
  const [query, setQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  // The map is a primary discovery feature. Hiding it is the viewer's choice,
  // never a prerequisite step before they can explore venues geographically.
  const [mapOpen, setMapOpen] = useState(true);
  const [chosenCity, setChosenCity] = useState(null);
  const [chosenVenue, setChosenVenue] = useState(null);
  const [mapLocationIds, setMapLocationIds] = useState(null);
  const [expandedShowsFor, setExpandedShowsFor] = useState(null);
  const [visible, setVisible] = useState(8);
  const [cityLimit, setCityLimit] = useState(6);
  const [allVenuesOpen, setAllVenuesOpen] = useState(true);
  const [page, setPage] = useState(0);
  const venueRows = useRef(new Map());
  const pendingReveal = useRef(null);
  const chosenSnapshot = useRef(null);
  const catalogue = useVenueMapCatalogue({ venueDirectoryIndex, tourDates });
  const catalogueEnabled = !!catalogue;
  const worldwide = !!catalogue && allVenuesOpen;
  const cities = useMemo(() => catalogue ? catalogue.cities : buildDiscoverVenueCities(venueDirectoryIndex, tourDates, { region, countryForCity }), [catalogue?.cities, venueDirectoryIndex, tourDates, region]);
  const homeValue = session?.home || { city: homeCity };
  const home = venueHomePlaceId({ ...homeValue, city: String(homeValue.city || "").split(",")[0], label: homeValue.city }, cities);
  const city = cities.find(row => row.id === chosenCity) || cities.find(row => row.id === home) || cities[0];
  const matchingCities = useMemo(() => discoverVenueCityMatches(cities, cityQuery), [cities, cityQuery]);
  const cityChoices = discoverVenueCityChoices(matchingCities, city?.id, cityLimit);
  const venues = useMemo(() => discoverVenueExplorerRows(worldwide ? { venues: catalogue.rows } : city, query), [worldwide, catalogue?.rows, city, query]);
  const listStart = catalogue ? Math.min(page * 12, Math.max(0, Math.floor((venues.length - 1) / 12) * 12)) : 0;
  const shownVenues = venues.slice(listStart, catalogue ? listStart + 12 : visible);
  const areaLabel = worldwide ? "Worldwide" : city?.city || region;
  const changeQuery = value => { setQuery(value); setChosenVenue(null); setExpandedShowsFor(null); setVisible(8); setPage(0); pendingReveal.current = null; chosenSnapshot.current = null; };
  const selectCity = id => { setAllVenuesOpen(false); setChosenCity(id); changeQuery(""); setCityQuery(""); setCityLimit(6); setCityPickerOpen(false); };
  const selectAllVenues = () => { setAllVenuesOpen(true); changeQuery(""); setCityPickerOpen(false); };
  const toggleCityPicker = () => { setCityPickerOpen(open => !open); setCityQuery(""); setCityLimit(6); };
  const revealVenue = id => {
    if (pendingReveal.current !== id) return;
    const row = venueRows.current.get(id);
    // The existing page owns scrolling: no second vertical scroll trap.
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "nearest", behavior: "auto" });
    if (row) pendingReveal.current = null;
  };
  const selectMapVenue = id => {
    chosenSnapshot.current = snapshotVenueMapSelection(venues.find(row => row.id === id));
    pendingReveal.current = id;
    setChosenVenue(id); setExpandedShowsFor(null);
    if (catalogue) setPage(Math.max(0, Math.floor(venues.findIndex(row => row.id === id) / 12)));
    else setVisible(current => Math.max(current, venues.findIndex(row => row.id === id) + 1));
  };
  useEffect(() => { if (chosenVenue) revealVenue(chosenVenue); }, [chosenVenue, visible, page]);
  useEffect(() => {
    if (!catalogueEnabled || !chosenVenue) return;
    const current = venues.find(row => row.id === chosenVenue);
    if (current) { chosenSnapshot.current = snapshotVenueMapSelection(current); return; }
    const nextId = reconcileVenueMapSelection(venues, chosenSnapshot.current);
    if (!nextId || nextId === chosenVenue) return;
    pendingReveal.current = nextId;
    setChosenVenue(nextId);
    setExpandedShowsFor(currentId => currentId === chosenVenue ? nextId : currentId);
    setPage(Math.max(0, Math.floor(venues.findIndex(row => row.id === nextId) / 12)));
  }, [venues, chosenVenue, catalogueEnabled]);
  useEffect(() => {
    setChosenCity(null); setChosenVenue(null); setExpandedShowsFor(null); setQuery("");
    setCityQuery(""); setVisible(8); setPage(0); setAllVenuesOpen(true); setCityLimit(6); setCityPickerOpen(false); setMapOpen(true);
    pendingReveal.current = null;
    chosenSnapshot.current = null;
  }, [region]);

  return <View style={styles.root}>
    <View style={styles.heading}>
      <View style={styles.flex}><Text style={styles.title} accessibilityRole="header">Venues{worldwide ? " worldwide" : city ? ` in ${city.city}` : ""}</Text><Text style={styles.body}>{worldwide ? "Explore the entire venue catalogue" : city ? city.region : region}</Text></View>
      {catalogue && !worldwide && <Pressable onPress={selectAllVenues} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>All venues worldwide</Text></Pressable>}
      <Pressable onPress={toggleCityPicker} accessibilityRole="button" accessibilityLabel="Change city" accessibilityState={{ expanded: cityPickerOpen }} style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>{cityPickerOpen ? "Close cities" : "Change city"}</Text><Icon name={cityPickerOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.amber} /></Pressable>
    </View>
    {cityPickerOpen && <View style={styles.cityPicker} accessibilityLabel="Choose a venue city">
      <View style={styles.search}><Icon name="search" size={18} color={colors.textDim} /><TextInput accessibilityLabel="Find a city" placeholder="Find a city" placeholderTextColor={colors.textFaint} value={cityQuery}
        onChangeText={value => { setCityQuery(value); setCityLimit(6); }} style={styles.input} maxLength={100} autoCorrect={false} autoCapitalize="none" />
        {!!cityQuery && <Pressable accessibilityRole="button" accessibilityLabel="Clear city search" onPress={() => setCityQuery("")} style={styles.clear}><Icon name="x" size={18} color={colors.textDim} /></Pressable>}
      </View>
      {cityChoices.map(row => <Pressable key={row.id} onPress={() => selectCity(row.id)} accessibilityRole="button" accessibilityState={{ selected: row.id === city?.id }} aria-pressed={row.id === city?.id}
        accessibilityLabel={`Explore ${row.city}, ${row.region}`} style={state => [styles.cityChoice, row.id === city?.id && styles.citySelected, ...feedback(state)]}>
        <View style={styles.flex}><Text style={styles.venueName}>{row.city}</Text><Text style={styles.small}>{row.region}</Text></View><Icon name={row.id === city?.id ? "check" : "chevron-right"} size={18} color={row.id === city?.id ? colors.amber : colors.textFaint} />
      </Pressable>)}
      {!cityChoices.length && <Text style={styles.body}>No cities match. Try another name or change the country above.</Text>}
      {matchingCities.length > cityLimit && (catalogue || cityLimit < 60) && <Pressable onPress={() => setCityLimit(current => catalogue ? current + 12 : Math.min(current + 12, 60))} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>More cities</Text></Pressable>}
    </View>}
    {catalogue?.status === "loading" && !venues.length && <Text style={styles.small} accessibilityRole={Platform.OS === "web" ? "status" : undefined}>Loading venues…</Text>}
    {catalogue?.status === "error" && <View accessibilityRole="alert"><Text style={styles.small}>Couldn’t load all venues.</Text><Pressable onPress={catalogue.retry} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>Retry venues</Text></Pressable></View>}
    {(catalogue?.feedStatus === "error" || catalogue?.feedStatus === "stale") && <View accessibilityRole="alert"><Text style={styles.small}>Some map locations aren’t available.</Text><Pressable onPress={catalogue.retryFeed} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>Retry locations</Text></Pressable></View>}
    {!city && !worldwide ? <View style={styles.empty}><Text style={styles.subtitle}>No venues listed in {region} yet</Text><Text style={styles.body}>Choose another country above or browse the full directory.</Text></View> : <>
      <View style={styles.search}><Icon name="search" size={18} color={colors.textDim} /><TextInput accessibilityLabel={worldwide ? "Search all venues" : `Search venues in ${areaLabel}`} placeholder={worldwide ? "Search all venues" : `Search venues in ${areaLabel}`} placeholderTextColor={colors.textFaint} value={query}
        onChangeText={changeQuery} style={styles.input} maxLength={100} autoCorrect={false} autoCapitalize="none" />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear venue search" onPress={() => changeQuery("")} style={styles.clear}><Icon name="x" size={18} color={colors.textDim} /></Pressable>}
      </View>
      <View style={styles.listHeading}><Text style={[styles.small, styles.flex]}>{venues.length} {venues.length === 1 ? "venue" : "venues"}{query.trim() ? " found" : " · Upcoming shows first"}</Text>
        <Pressable onPress={() => setMapOpen(open => !open)} accessibilityRole="button" accessibilityState={{ expanded: mapOpen }} accessibilityLabel={mapOpen ? "Hide venue map" : "Show venue map"} style={state => [styles.textButton, ...feedback(state)]}><Icon name="pin" size={16} color={colors.amber} /><Text style={styles.link}>{mapOpen ? "Hide map" : "Show map"}</Text></Pressable>
      </View>
      {mapOpen && <VenueMap venues={venues} selected={chosenVenue} onSelect={selectMapVenue} city={areaLabel} trustedCatalogueRows={catalogue?.sourceRows} providerEvents={catalogue?.providerEvents} providerFetchedAt={catalogue?.providerFetchedAt} onMapLocations={setMapLocationIds} />}
      {!venues.length ? <View style={styles.empty}><Text style={styles.subtitle}>No venues match "{query.trim()}"</Text><Text style={styles.body}>Search another name{worldwide ? "" : ` in ${areaLabel}`}, or change city.</Text><Pressable onPress={() => changeQuery("")} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>{worldwide ? "Show all venues" : `Show all venues in ${areaLabel}`}</Text></Pressable></View> :
      <View testID="discover-venue-list">
        {shownVenues.map((venue, index) => {
          const expanded = chosenVenue === venue.id;
          const showAll = expandedShowsFor === venue.id;
          const nextShow = venue.shows[0];
          const condensedShows = catalogue && venue.venueUpcomingCount > venue.shows.length;
          return <View key={venue.id} ref={node => { if (node) venueRows.current.set(venue.id, node); else venueRows.current.delete(venue.id); }} onLayout={() => revealVenue(venue.id)} style={[styles.venueCard, expanded && styles.venueSelected]} accessibilityLabel={`Venue: ${venue.name}`}>
            <Pressable onPress={() => onOpenVenue?.(venue)} accessibilityRole="button" accessibilityLabel={`Open venue ${venue.name}`} accessibilityHint="Opens the full venue page." style={state => [styles.venueRow, ...feedback(state)]}>
              {mapOpen && <Text style={styles.rowNumber}>{listStart + index + 1}</Text>}
              <View style={styles.flex}><Text style={styles.venueName}>{venue.name}</Text>{catalogue && <Text style={styles.small}>{venue.place || "Location not listed"}</Text>}<Text style={styles.small}>{condensedShows ? `${venue.venueUpcomingCount} upcoming shows · ` : ""}{nextShow ? `Next: ${eventDateMeta(nextShow.date).timing} · ${nextShow.eventName || nextShow.artist || "Live show"}` : "No upcoming shows listed"}</Text></View><Icon name="chevron-right" size={18} color={colors.amber} />
            </Pressable>
            {!!venue.shows.length && <Pressable onPress={() => { chosenSnapshot.current = expanded ? null : snapshotVenueMapSelection(venue); setChosenVenue(expanded ? null : venue.id); setExpandedShowsFor(null); pendingReveal.current = null; }} accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} accessibilityLabel={condensedShows ? `${expanded ? "Hide" : "Show"} next concert at ${venue.name}` : `${expanded ? "Hide" : "Show"} ${venue.shows.length} upcoming show${venue.shows.length === 1 ? "" : "s"} at ${venue.name}`} style={state => [styles.showsToggle, ...feedback(state)]}>
              <Text style={styles.link}>{expanded ? "Hide shows" : condensedShows ? "Next concert" : `${venue.shows.length} upcoming show${venue.shows.length === 1 ? "" : "s"}`}</Text><Icon name={expanded ? "chevron-up" : "chevron-down"} size={15} color={colors.amber} />
            </Pressable>}
            {expanded && <View style={styles.shows} accessibilityLabel={`Upcoming shows at ${venue.name}`}>
              {!catalogueEnabled && !(mapLocationIds ? mapLocationIds.includes(venue.id) : venue.coord) && mapOpen && <Text style={styles.small}>Map location not confirmed. You can still open this venue and its shows.</Text>}
              {venue.shows.slice(0, showAll ? venue.shows.length : 3).map(event => <ShowRow key={event.id || `${event.artist}|${event.date}`} event={event} onOpen={onOpenEvent} />)}
              {venue.shows.length > 3 && <Pressable onPress={() => setExpandedShowsFor(showAll ? null : venue.id)} accessibilityRole="button" accessibilityLabel={`${showAll ? "Show fewer" : `Show all ${venue.shows.length}`} listed shows at ${venue.name}`} style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>{showAll ? "Show fewer shows" : `Show all ${venue.shows.length} shows`}</Text></Pressable>}
              {!venue.shows.length && <Text style={styles.small}>No upcoming shows listed. Open the venue for its available details.</Text>}
            </View>}
          </View>;
        })}
        {catalogue ? <View style={styles.listHeading}><Pressable disabled={!listStart} accessibilityRole="button" accessibilityLabel="Previous venue page" onPress={() => setPage(Math.max(0, listStart / 12 - 1))} style={state => [styles.textButton, !listStart && { opacity: .35 }, ...feedback(state)]}><Text style={styles.link}>Previous</Text></Pressable><Text style={styles.small}>{listStart + 1}–{Math.min(listStart + 12, venues.length)} of {venues.length}</Text><Pressable disabled={listStart + 12 >= venues.length} accessibilityRole="button" accessibilityLabel="Next venue page" onPress={() => setPage(listStart / 12 + 1)} style={state => [styles.textButton, listStart + 12 >= venues.length && { opacity: .35 }, ...feedback(state)]}><Text style={styles.link}>Next</Text></Pressable></View> : visible < venues.length && <Pressable accessibilityRole="button" onPress={() => setVisible(current => current + 12)} style={state => [styles.more, ...feedback(state)]}><Text style={styles.link}>Show more venues ({venues.length - visible})</Text><Icon name="chevron-down" size={16} color={colors.amber} /></Pressable>}
      </View>}
    </>}
    <Pressable onPress={() => onOpenVenues?.(region)} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>Browse the full venue directory</Text><Icon name="chevron-right" size={16} color={colors.amber} /></Pressable>
  </View>;
}

function ShowRow({ event, onOpen }) {
  const date = eventDateMeta(event.date);
  return <Pressable onPress={() => onOpen?.(event)} accessibilityRole="button" accessibilityLabel={`View ${event.artist || event.eventName} at ${event.venue}, ${event.date}`} style={state => [styles.showRow, ...feedback(state)]}>
    <View style={styles.date}><Text style={styles.dateMonth}>{date.month}</Text><Text style={styles.dateDay}>{date.day}</Text></View><View style={styles.flex}><Text style={styles.venueName}>{event.eventName || event.artist || "Live show"}</Text><Text style={styles.small}>{date.label || event.date}</Text></View><Icon name="chevron-right" size={17} color={colors.textFaint} />
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { gap: space(4), minWidth: 0 }, flex: { flex: 1, minWidth: 0 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), justifyContent: "space-between" },
  title: { fontFamily: displayFont, color: colors.text, fontSize: 25, fontWeight: "800" },
  body: { fontFamily: font, fontSize: 14, lineHeight: 21, color: colors.textDim }, small: { fontFamily: font, fontSize: 12, lineHeight: 18, color: colors.textDim }, link: { fontFamily: font, fontSize: 13, fontWeight: "800", color: colors.amber },
  textButton: { minHeight: 44, paddingHorizontal: space(2), flexDirection: "row", alignItems: "center", gap: space(2), borderRadius: radius.sm }, hover: { backgroundColor: colors.surfaceAlt }, pressed: { opacity: .8 },
  search: { flexDirection: "row", alignItems: "center", gap: space(3), borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: space(3), backgroundColor: colors.surface }, input: { minHeight: 48, flex: 1, minWidth: 0, color: colors.text, fontFamily: font, fontSize: 15 }, clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  cityPicker: { gap: space(2), padding: space(3), backgroundColor: colors.surface, borderRadius: radius.md }, cityChoice: { flexDirection: "row", alignItems: "center", gap: space(3), minHeight: 58, paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.sm }, citySelected: { backgroundColor: colors.surfaceAlt },
  listHeading: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space(2), justifyContent: "space-between" },
  venueCard: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.lineSoft }, venueSelected: { backgroundColor: colors.surface, borderRadius: radius.sm },
  venueRow: { flexDirection: "row", alignItems: "center", gap: space(3), minHeight: 68, paddingHorizontal: space(3), paddingTop: space(3), paddingBottom: space(2) }, rowNumber: { fontFamily: mono, fontSize: 12, color: colors.textFaint, minWidth: 20 }, venueName: { fontFamily: font, fontSize: 15, lineHeight: 21, color: colors.text, fontWeight: "700" },
  showsToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: space(2), paddingHorizontal: space(3), paddingBottom: space(2) }, shows: { paddingHorizontal: space(3), paddingBottom: space(3), gap: space(2) }, more: { minHeight: 48, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space(2) },
  subtitle: { color: colors.text, fontFamily: displayFont, fontSize: 20, lineHeight: 27, fontWeight: "800" },
  showRow: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(3), minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.lineSoft }, date: { width: 40, alignItems: "center" }, dateMonth: { fontFamily: mono, fontSize: 10, color: colors.amber }, dateDay: { fontFamily: displayFont, fontSize: 22, fontWeight: "800", color: colors.text }, empty: { gap: space(3), paddingVertical: space(5) },
});
