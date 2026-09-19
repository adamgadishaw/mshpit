import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, displayFont, focusRing, font, mono, radius, space } from "../../theme";
import { countryForCity } from "../../geo";
import { HAS_MAP, MAP_PROVIDER, mapStaticUrl } from "../../mapConfig";
import { buildDiscoverVenueCities, clusterDiscoverVenuePins, discoverVenueMap } from "../../domain/discoverVenues.mjs";
import { discoverVenueCityChoices, discoverVenueCityMatches, discoverVenueExplorerRows, discoverVenueMapPoints } from "../../domain/discoverVenueExplorer.mjs";
import { eventDateMeta, venueHomePlaceId } from "../../domain/venueDiscovery.mjs";
import Icon from "../Icon";

const EMPTY = [];
const feedback = ({ pressed, hovered, focused }) => [hovered && styles.hover, pressed && styles.pressed, focused && focusRing];

function VenueMap({ venues, selected, onSelect, city }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const [mapSize, setMapSize] = useState({ width: 640, height: 420 });
  const { points, mappedCount, unmappedCount } = useMemo(() => discoverVenueMapPoints(venues, selected), [venues, selected]);
  const projection = useMemo(() => discoverVenueMap(points), [points]);
  const url = projection && HAS_MAP ? mapStaticUrl(projection.center, MAP_PROVIDER === "mapbox" ? Math.max(0, projection.zoom - 1) : projection.zoom, projection.width, projection.height)
    .replace("attribution=false&logo=false", "attribution=true&logo=true") : null;
  const showMap = !!url && failedUrl !== url;
  // Group overlapping touch targets at the actual rendered size, not only
  // identical coordinates. Repeated taps cycle rooms; the list is equivalent.
  const clusters = useMemo(() => clusterDiscoverVenuePins(points, projection, mapSize), [points, projection, mapSize]);
  const measureMap = ({ nativeEvent }) => {
    const width = Math.round(nativeEvent.layout.width), height = Math.round(nativeEvent.layout.height);
    if (!(width > 0 && height > 0)) return;
    setMapSize(current => current.width === width && current.height === height ? current : { width, height });
  };
  return <View>
    <View style={[styles.map, !points.length && styles.unmapped]} onLayout={measureMap} accessibilityLabel={`Venue locations in ${city}`}>
      {showMap ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="stretch" onError={() => setFailedUrl(url)} accessibilityLabel={`Street map of ${city}`} />
        : <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {[20, 40, 60, 80].map(offset => <View key={`h${offset}`} style={[styles.gridLine, { top: `${offset}%`, left: 0, right: 0, height: 1 }]} />)}
          {[20, 40, 60, 80].map(offset => <View key={`v${offset}`} style={[styles.gridLine, { left: `${offset}%`, top: 0, bottom: 0, width: 1 }]} />)}
          <Text style={styles.plotLabel}>{projection ? "LOCATION PLOT · STREET MAP UNAVAILABLE" : "VENUE COORDINATES NOT YET AVAILABLE"}</Text>
        </View>}
      {clusters.map(({ venues: group, position }) => {
        const active = group.some(row => row.id === selected);
        const venue = group.find(row => row.id === selected) || group[0];
        const number = venues.findIndex(row => row.id === venue.id) + 1;
        return <Pressable key={group[0].id} onPress={() => onSelect(group[(group.findIndex(row => row.id === selected) + 1) % group.length].id)}
          accessibilityRole="button" accessibilityLabel={`Map pin ${number}: ${group.map(row => row.name).join(", ")}${group.length > 1 ? ". Tap to cycle venues" : ""}`}
          accessibilityState={{ selected: active }} aria-pressed={active} accessibilityHint="Selects this venue in the list and shows its upcoming concerts."
          title={group.map(row => row.name).join(" · ")}
          style={state => [styles.pinTarget, { left: `${position.x * 100}%`, top: `${position.y * 100}%`, zIndex: active ? 2 : 1 }, ...feedback(state)]}>
          <View style={[styles.pin, active && styles.pinSelected]}><Text style={[styles.pinText, active && styles.pinTextSelected]}>{group.length > 1 ? `${group.length}×` : number}</Text></View>
        </Pressable>;
      })}
    </View>
    <View style={styles.mapCaption}><Icon name="pin" size={14} color={colors.textDim} /><Text style={[styles.small, { flex: 1 }]}>{points.length} venues plotted{mappedCount > points.length ? ` of ${mappedCount} with locations` : ""}{unmappedCount ? ` · ${unmappedCount} awaiting a map location` : ""}. {points.length ? "Select a numbered pin or venue below. Grouped pins cycle through nearby venues." : "You can still view venue details and shows below."}</Text></View>
  </View>;
}

export default function DiscoverVenues({ region = "Worldwide", homeCity = "", venueDirectoryIndex = EMPTY, tourDates = EMPTY, session, onOpenVenue, onOpenEvent, onOpenVenues }) {
  const [query, setQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [chosenCity, setChosenCity] = useState(null);
  const [chosenVenue, setChosenVenue] = useState(null);
  const [expandedShowsFor, setExpandedShowsFor] = useState(null);
  const [visible, setVisible] = useState(8);
  const [cityLimit, setCityLimit] = useState(6);
  const venueRows = useRef(new Map());
  const pendingReveal = useRef(null);
  const cities = useMemo(() => buildDiscoverVenueCities(venueDirectoryIndex, tourDates, { region, countryForCity }), [venueDirectoryIndex, tourDates, region]);
  const homeValue = session?.home || { city: homeCity };
  const home = venueHomePlaceId({ ...homeValue, city: String(homeValue.city || "").split(",")[0], label: homeValue.city }, cities);
  const city = cities.find(row => row.id === chosenCity) || cities.find(row => row.id === home) || cities[0];
  const matchingCities = useMemo(() => discoverVenueCityMatches(cities, cityQuery), [cities, cityQuery]);
  const cityChoices = discoverVenueCityChoices(matchingCities, city?.id, cityLimit);
  const venues = useMemo(() => discoverVenueExplorerRows(city, query), [city, query]);
  const shownVenues = venues.slice(0, visible);
  const changeQuery = value => { setQuery(value); setChosenVenue(null); setExpandedShowsFor(null); setVisible(8); pendingReveal.current = null; };
  const selectCity = id => { setChosenCity(id); changeQuery(""); setCityQuery(""); setCityLimit(6); setCityPickerOpen(false); };
  const toggleCityPicker = () => { setCityPickerOpen(open => !open); setCityQuery(""); setCityLimit(6); };
  const revealVenue = id => {
    if (pendingReveal.current !== id) return;
    const row = venueRows.current.get(id);
    // The existing page owns scrolling: no second vertical scroll trap.
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "nearest", behavior: "auto" });
    if (row) pendingReveal.current = null;
  };
  const selectMapVenue = id => {
    pendingReveal.current = id;
    setChosenVenue(id); setExpandedShowsFor(null);
    setVisible(current => Math.max(current, venues.findIndex(row => row.id === id) + 1));
  };
  useEffect(() => { if (chosenVenue) revealVenue(chosenVenue); }, [chosenVenue, visible]);
  useEffect(() => {
    setChosenCity(null); setChosenVenue(null); setExpandedShowsFor(null); setQuery("");
    setCityQuery(""); setVisible(8); setCityLimit(6); setCityPickerOpen(false); setMapOpen(false);
    pendingReveal.current = null;
  }, [region]);

  return <View style={styles.root}>
    <View style={styles.heading}>
      <View style={styles.flex}><Text style={styles.title} accessibilityRole="header">Venues{city ? ` in ${city.city}` : ""}</Text><Text style={styles.body}>{city ? city.region : region}</Text></View>
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
      {matchingCities.length > cityLimit && cityLimit < 60 && <Pressable onPress={() => setCityLimit(current => Math.min(current + 12, 60))} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>More cities</Text></Pressable>}
    </View>}
    {!city ? <View style={styles.empty}><Text style={styles.subtitle}>No venues listed in {region} yet</Text><Text style={styles.body}>Choose another country above or browse the full directory.</Text></View> : <>
      <View style={styles.search}><Icon name="search" size={18} color={colors.textDim} /><TextInput accessibilityLabel={`Search venues in ${city.city}`} placeholder={`Search venues in ${city.city}`} placeholderTextColor={colors.textFaint} value={query}
        onChangeText={changeQuery} style={styles.input} maxLength={100} autoCorrect={false} autoCapitalize="none" />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear venue search" onPress={() => changeQuery("")} style={styles.clear}><Icon name="x" size={18} color={colors.textDim} /></Pressable>}
      </View>
      <View style={styles.listHeading}><Text style={[styles.small, styles.flex]}>{venues.length} {venues.length === 1 ? "venue" : "venues"}{query.trim() ? " found" : " · Upcoming shows first"}</Text>
        <Pressable onPress={() => setMapOpen(open => !open)} accessibilityRole="button" accessibilityState={{ expanded: mapOpen }} accessibilityLabel={mapOpen ? "Hide venue map" : "Show venue map"} style={state => [styles.textButton, ...feedback(state)]}><Icon name="pin" size={16} color={colors.amber} /><Text style={styles.link}>{mapOpen ? "Hide map" : "Show map"}</Text></Pressable>
      </View>
      {mapOpen && <VenueMap venues={venues} selected={chosenVenue} onSelect={selectMapVenue} city={city.city} />}
      {!venues.length ? <View style={styles.empty}><Text style={styles.subtitle}>No venues match “{query.trim()}”</Text><Text style={styles.body}>Search another name in {city.city}, or change city.</Text><Pressable onPress={() => changeQuery("")} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>Show all venues in {city.city}</Text></Pressable></View> :
      <View testID="discover-venue-list">
        {shownVenues.map((venue, index) => {
          const expanded = chosenVenue === venue.id;
          const showAll = expandedShowsFor === venue.id;
          const nextShow = venue.shows[0];
          return <View key={venue.id} ref={node => { if (node) venueRows.current.set(venue.id, node); else venueRows.current.delete(venue.id); }} onLayout={() => revealVenue(venue.id)} style={[styles.venueCard, expanded && styles.venueSelected]} accessibilityLabel={`Venue: ${venue.name}`}>
            <Pressable onPress={() => onOpenVenue?.(venue)} accessibilityRole="button" accessibilityLabel={`Open venue ${venue.name}`} accessibilityHint="Opens the full venue page." style={state => [styles.venueRow, ...feedback(state)]}>
              {mapOpen && <Text style={styles.rowNumber}>{index + 1}</Text>}
              <View style={styles.flex}><Text style={styles.venueName}>{venue.name}</Text><Text style={styles.small}>{nextShow ? `Next: ${eventDateMeta(nextShow.date).timing} · ${nextShow.eventName || nextShow.artist || "Live show"}` : "No upcoming shows listed"}</Text></View><Icon name="chevron-right" size={18} color={colors.amber} />
            </Pressable>
            {!!venue.shows.length && <Pressable onPress={() => { setChosenVenue(expanded ? null : venue.id); setExpandedShowsFor(null); pendingReveal.current = null; }} accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} accessibilityLabel={`${expanded ? "Hide" : "Show"} ${venue.shows.length} upcoming show${venue.shows.length === 1 ? "" : "s"} at ${venue.name}`} style={state => [styles.showsToggle, ...feedback(state)]}>
              <Text style={styles.link}>{expanded ? "Hide shows" : `${venue.shows.length} upcoming show${venue.shows.length === 1 ? "" : "s"}`}</Text><Icon name={expanded ? "chevron-up" : "chevron-down"} size={15} color={colors.amber} />
            </Pressable>}
            {expanded && <View style={styles.shows} accessibilityLabel={`Upcoming shows at ${venue.name}`}>
              {!venue.coord && mapOpen && <Text style={styles.small}>Map location not confirmed. You can still open this venue and its shows.</Text>}
              {venue.shows.slice(0, showAll ? venue.shows.length : 3).map(event => <ShowRow key={event.id || `${event.artist}|${event.date}`} event={event} onOpen={onOpenEvent} />)}
              {venue.shows.length > 3 && <Pressable onPress={() => setExpandedShowsFor(showAll ? null : venue.id)} accessibilityRole="button" accessibilityLabel={`${showAll ? "Show fewer" : `Show all ${venue.shows.length}`} listed shows at ${venue.name}`} style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>{showAll ? "Show fewer shows" : `Show all ${venue.shows.length} shows`}</Text></Pressable>}
              {!venue.shows.length && <Text style={styles.small}>No upcoming shows listed. Open the venue for its available details.</Text>}
            </View>}
          </View>;
        })}
        {visible < venues.length && <Pressable accessibilityRole="button" onPress={() => setVisible(current => current + 12)} style={state => [styles.more, ...feedback(state)]}><Text style={styles.link}>Show more venues ({venues.length - visible})</Text><Icon name="chevron-down" size={16} color={colors.amber} /></Pressable>}
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
  map: { width: "100%", aspectRatio: 640 / 420, backgroundColor: colors.surface, borderRadius: radius.md, overflow: "hidden", position: "relative" }, unmapped: { aspectRatio: undefined, minHeight: 120 },
  mapCaption: { flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2) }, gridLine: { position: "absolute", backgroundColor: colors.lineSoft }, plotLabel: { position: "absolute", bottom: 12, left: 12, right: 12, fontSize: 9, fontFamily: mono, color: colors.textFaint },
  pinTarget: { position: "absolute", width: 44, height: 44, marginLeft: -22, marginTop: -22, alignItems: "center", justifyContent: "center", borderRadius: radius.pill }, pin: { width: 29, height: 29, borderRadius: radius.pill, backgroundColor: colors.bgElev, borderColor: colors.amber, borderWidth: 1, alignItems: "center", justifyContent: "center" }, pinSelected: { width: 36, height: 36, borderWidth: 3, backgroundColor: colors.amber }, pinText: { fontFamily: mono, fontSize: 11, color: colors.text, fontWeight: "800" }, pinTextSelected: { color: colors.bgElev },
  venueCard: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.lineSoft }, venueSelected: { backgroundColor: colors.surface, borderRadius: radius.sm },
  venueRow: { flexDirection: "row", alignItems: "center", gap: space(3), minHeight: 68, paddingHorizontal: space(3), paddingTop: space(3), paddingBottom: space(2) }, rowNumber: { fontFamily: mono, fontSize: 12, color: colors.textFaint, minWidth: 20 }, venueName: { fontFamily: font, fontSize: 15, lineHeight: 21, color: colors.text, fontWeight: "700" },
  showsToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: space(2), paddingHorizontal: space(3), paddingBottom: space(2) }, shows: { paddingHorizontal: space(3), paddingBottom: space(3), gap: space(2) }, more: { minHeight: 48, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space(2) },
  subtitle: { color: colors.text, fontFamily: displayFont, fontSize: 20, lineHeight: 27, fontWeight: "800" },
  showRow: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(3), minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.lineSoft }, date: { width: 40, alignItems: "center" }, dateMonth: { fontFamily: mono, fontSize: 10, color: colors.amber }, dateDay: { fontFamily: displayFont, fontSize: 22, fontWeight: "800", color: colors.text }, empty: { gap: space(3), paddingVertical: space(5) },
});
