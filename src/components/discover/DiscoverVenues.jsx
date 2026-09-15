import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { colors, displayFont, focusRing, font, mono, radius, space } from "../../theme";
import { countryForCity } from "../../geo";
import { HAS_MAP, MAP_PROVIDER, mapStaticUrl } from "../../mapConfig";
import { buildDiscoverVenueCities, discoverVenueMap, filterDiscoverVenueCities, findDiscoverVenueMatch } from "../../domain/discoverVenues.mjs";
import { eventDateMeta, venueHomePlaceId } from "../../domain/venueDiscovery.mjs";
import Icon from "../Icon";

const EMPTY = [];
const feedback = ({ pressed, hovered, focused }) => [hovered && styles.hover, pressed && styles.pressed, focused && focusRing];

function VenueMap({ venues, selected, onSelect, city, compact }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const points = useMemo(() => {
    const mapped = venues.filter(venue => venue.coord);
    const first = mapped.slice(0, 24);
    const active = mapped.find(venue => venue.id === selected);
    if (active && !first.includes(active)) first[first.length - 1] = active;
    return first;
  }, [venues, selected]);
  const projection = useMemo(() => discoverVenueMap(points), [points]);
  const url = projection && HAS_MAP ? mapStaticUrl(projection.center, MAP_PROVIDER === "mapbox" ? Math.max(0, projection.zoom - 1) : projection.zoom, projection.width, projection.height)
    .replace("attribution=false&logo=false", "attribution=true&logo=true") : null;
  const showMap = !!url && failedUrl !== url;
  // Co-located rooms share one button; repeated taps cycle those rooms instead
  // of hiding smaller venues underneath another marker. The list is equivalent.
  const clusters = new Map();
  points.forEach(venue => {
    const key = `${venue.coord.lat.toFixed(5)},${venue.coord.lng.toFixed(5)}`;
    clusters.set(key, [...(clusters.get(key) || []), venue]);
  });
  return <View style={[styles.mapColumn, compact && styles.columnChild]}>
    <View style={styles.map} accessibilityLabel={`Venue locations in ${city}`}>
      {showMap ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="stretch" onError={() => setFailedUrl(url)} accessibilityLabel={`Street map of ${city}`} />
        : <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {[20, 40, 60, 80].map(offset => <View key={`h${offset}`} style={[styles.gridLine, { top: `${offset}%`, left: 0, right: 0, height: 1 }]} />)}
          {[20, 40, 60, 80].map(offset => <View key={`v${offset}`} style={[styles.gridLine, { left: `${offset}%`, top: 0, bottom: 0, width: 1 }]} />)}
          <Text style={styles.plotLabel}>{projection ? "LOCATION PLOT · STREET MAP UNAVAILABLE" : "VENUE COORDINATES NOT YET AVAILABLE"}</Text>
        </View>}
      {[...clusters.values()].map(group => {
        const active = group.some(row => row.id === selected);
        const venue = group.find(row => row.id === selected) || group[0];
        const position = projection.project(venue.coord);
        const number = venues.findIndex(row => row.id === venue.id) + 1;
        return <Pressable key={group[0].id} onPress={() => onSelect(group[(group.findIndex(row => row.id === selected) + 1) % group.length].id)}
          accessibilityRole="button" accessibilityLabel={`Map pin ${number}: ${group.map(row => row.name).join(", ")}${group.length > 1 ? ". Tap to cycle venues" : ""}`}
          accessibilityState={{ selected: active }} aria-pressed={active} accessibilityHint="Selects this venue in the list and shows its upcoming concerts."
          title={group.map(row => row.name).join(" · ")}
          style={state => [styles.pinTarget, { left: `${position.x * 100}%`, top: `${position.y * 100}%`, zIndex: active ? 2 : 1 }, ...feedback(state)]}>
          <View style={[styles.pin, active && styles.pinSelected]}><Text style={[styles.pinText, active && styles.pinTextSelected]}>{group.length > 1 && !active ? `${group.length}×` : number}</Text></View>
        </Pressable>;
      })}
    </View>
    <View style={styles.mapCaption}><Icon name="pin" size={14} color={colors.textDim} /><Text style={styles.small}>{points.length} venues plotted · select a pin or a room below</Text></View>
  </View>;
}

export default function DiscoverVenues({ region = "Worldwide", homeCity = "", venueDirectoryIndex = EMPTY, tourDates = EMPTY, session, onOpenVenue, onOpenEvent, onOpenVenues }) {
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const [query, setQuery] = useState("");
  const [chosenCity, setChosenCity] = useState(null);
  const [chosenVenue, setChosenVenue] = useState(null);
  const [visible, setVisible] = useState(8);
  const [cityLimit, setCityLimit] = useState(6);
  const cities = useMemo(() => buildDiscoverVenueCities(venueDirectoryIndex, tourDates, { region, countryForCity }), [venueDirectoryIndex, tourDates, region]);
  const matching = useMemo(() => filterDiscoverVenueCities(cities, query), [cities, query]);
  const homeValue = session?.home || { city: homeCity };
  const home = venueHomePlaceId({ ...homeValue, city: String(homeValue.city || "").split(",")[0], label: homeValue.city }, matching);
  const city = matching.find(row => row.id === chosenCity) || matching.find(row => row.id === home) || matching[0];
  const cityChoices = city ? [city, ...matching.filter(row => row.id !== city.id)].slice(0, cityLimit) : [];
  const venues = city?.venues || EMPTY;
  const matchingVenue = findDiscoverVenueMatch(venues, query);
  const selected = venues.find(row => row.id === chosenVenue) || matchingVenue || venues[0];
  const shownVenues = matchingVenue && !chosenVenue ? [matchingVenue, ...venues.filter(row => row.id !== matchingVenue.id)].slice(0, visible) : venues.slice(0, visible);
  const selectCity = (id) => { setChosenCity(id); setChosenVenue(null); setVisible(8); };
  const selectVenue = (id) => { setChosenVenue(id); const index = venues.findIndex(row => row.id === id); setVisible(current => Math.max(current, index + 1)); };
  return <View style={styles.root}>
    <View style={styles.heading}>
      <View style={styles.flex}><Text style={styles.eyebrow}>ROOMS. CITIES. LIVE MUSIC.</Text><Text style={styles.title} accessibilityRole="header">Find a place. Find a show.</Text><Text style={styles.body}>Explore a city’s venues, then see what’s on their stages.</Text></View>
      <Pressable onPress={() => onOpenVenues?.(region)} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>Full venue directory</Text><Icon name="external" size={16} color={colors.amber} /></Pressable>
    </View>
    <View style={styles.search}><Icon name="search" size={18} color={colors.textDim} /><TextInput accessibilityLabel="Find a city or venue" placeholder="Find a city or venue" placeholderTextColor={colors.textFaint} value={query}
      onChangeText={value => { setQuery(value); setChosenCity(null); setChosenVenue(null); setVisible(8); setCityLimit(6); }} style={styles.input} maxLength={100} autoCorrect={false} autoCapitalize="none" />
      {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear city search" onPress={() => setQuery("")} style={styles.clear}><Icon name="x" size={18} color={colors.textDim} /></Pressable>}
    </View>
    <View style={styles.cityChoices}>
      {cityChoices.map(row => <Pressable key={row.id} onPress={() => selectCity(row.id)} accessibilityRole="button" accessibilityState={{ selected: row.id === city?.id }} aria-pressed={row.id === city?.id}
        accessibilityLabel={`Explore ${row.city}, ${row.region}`} style={state => [styles.cityChoice, row.id === city?.id && styles.citySelected, ...feedback(state)]}>
        <Text style={[styles.cityName, row.id === city?.id && styles.accent]}>{row.city}</Text><Text style={styles.small}>{row.region}</Text>
      </Pressable>)}
      {matching.length > cityLimit && cityLimit < 60 && <Pressable onPress={() => setCityLimit(current => Math.min(current + 12, 60))} accessibilityRole="button" style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>More cities</Text></Pressable>}
    </View>
    {!city ? <View style={styles.empty}><Text style={styles.subtitle}>No matching venues in {region}</Text><Text style={styles.body}>Try another city or venue name, change the country above, or open the full directory.</Text></View> : <>
      <View style={styles.cityHeading}><View style={styles.flex}><Text style={styles.cityTitle} accessibilityRole="header">{city.city}</Text><Text style={styles.body}>{city.region}</Text></View><Text style={styles.count}>{venues.length} venues · {city.shows.length} listed shows</Text></View>
      <View style={[styles.explorer, compact && styles.explorerCompact]}>
        <VenueMap venues={venues} selected={selected?.id} onSelect={selectVenue} city={city.city} compact={compact} />
        <View style={[styles.legend, compact && styles.columnChild]}>
          <View style={styles.legendHeading}><Text style={styles.eyebrow}>THE VENUE LIST</Text><Text style={styles.small}>Most listed shows first</Text></View>
          <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {shownVenues.map(venue => { const index = venues.indexOf(venue); return <Pressable key={venue.id} onPress={() => selectVenue(venue.id)} accessibilityRole="button" accessibilityState={{ selected: selected?.id === venue.id }} aria-pressed={selected?.id === venue.id}
              accessibilityLabel={`Select venue ${index + 1}: ${venue.name}`} style={state => [styles.venueRow, selected?.id === venue.id && styles.venueSelected, ...feedback(state)]}>
              <Text style={[styles.rowNumber, selected?.id === venue.id && styles.accent]}>{String(index + 1).padStart(2, "0")}</Text><View style={styles.flex}><Text style={styles.venueName}>{venue.name}</Text><Text style={styles.small}>{venue.shows.length ? `${venue.shows.length} listed show${venue.shows.length === 1 ? "" : "s"}` : "No upcoming dates in this snapshot"}{!venue.coord ? " · Not mapped" : ""}</Text></View><Icon name="chevron-right" size={16} color={selected?.id === venue.id ? colors.amber : colors.textFaint} />
            </Pressable>; })}
            {visible < venues.length && <Pressable accessibilityRole="button" onPress={() => setVisible(current => current + 12)} style={state => [styles.textButton, ...feedback(state)]}><Text style={styles.link}>Show more venues ({venues.length - visible})</Text></Pressable>}
          </ScrollView>
        </View>
      </View>
      {selected && <View style={styles.selected} accessibilityLiveRegion="polite">
        <View style={styles.heading}><View style={styles.flex}><Text style={styles.eyebrow}>SELECTED VENUE</Text><Text style={styles.subtitle}>{selected.name}</Text><Text style={styles.body}>{selected.place}</Text></View>
          <Pressable onPress={() => onOpenVenue?.(selected)} accessibilityRole="button" accessibilityLabel={`View venue ${selected.name}`} style={state => [styles.openVenue, ...feedback(state)]}><Text style={styles.link}>View venue</Text><Icon name="external" size={18} color={colors.amber} /></Pressable></View>
        {selected.shows.length ? selected.shows.slice(0, 3).map(event => <ShowRow key={event.id || `${event.artist}|${event.date}`} event={event} onOpen={onOpenEvent} />)
          : <Text style={styles.small}>No upcoming shows loaded for this room. Open its profile for venue details.</Text>}
      </View>}
      {!!city.shows.length && <View style={styles.calendar}><View style={styles.heading}><Text style={styles.subtitle} accessibilityRole="header">Coming up in {city.city}</Text><Text style={styles.small}>Across this city’s venues</Text></View>
        {city.shows.slice(0, 6).map(event => <ShowRow key={event.id || `${event.venue}|${event.artist}|${event.date}`} event={event} onOpen={onOpenEvent} />)}
      </View>}
      <Text style={styles.footnote}>Shows are drawn from the currently loaded listings, not a popularity score. Missing coordinates never become guessed map pins.</Text>
    </>}
  </View>;
}

function ShowRow({ event, onOpen }) {
  const date = eventDateMeta(event.date);
  return <Pressable onPress={() => onOpen?.(event)} accessibilityRole="button" accessibilityLabel={`View ${event.artist || event.eventName} at ${event.venue}, ${event.date}`} style={state => [styles.showRow, ...feedback(state)]}>
    <View style={styles.date}><Text style={styles.dateMonth}>{date.month}</Text><Text style={styles.dateDay}>{date.day}</Text></View><View style={styles.flex}><Text style={styles.venueName}>{event.eventName || event.artist || "Live show"}</Text><Text style={styles.small}>{event.venue} · {date.label || event.date}</Text></View><Icon name="chevron-right" size={17} color={colors.textFaint} />
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { gap: space(5), minWidth: 0 }, columnChild: { flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: "auto" }, flex: { flex: 1, minWidth: 0 }, heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(4), justifyContent: "space-between" },
  eyebrow: { fontFamily: mono, fontSize: 10, letterSpacing: 1.3, color: colors.amber, fontWeight: "800" }, title: { fontFamily: displayFont, color: colors.text, fontSize: 30, fontWeight: "800", marginVertical: space(2) },
  body: { fontFamily: font, fontSize: 14, lineHeight: 21, color: colors.textDim }, small: { fontFamily: font, fontSize: 12, lineHeight: 18, color: colors.textDim }, link: { fontFamily: font, fontSize: 13, fontWeight: "800", color: colors.amber }, accent: { color: colors.amber },
  textButton: { minHeight: 44, paddingHorizontal: space(2), flexDirection: "row", alignItems: "center", gap: space(2), borderRadius: radius.sm }, hover: { backgroundColor: colors.surfaceAlt }, pressed: { opacity: .8 },
  search: { flexDirection: "row", alignItems: "center", gap: space(3), borderBottomWidth: 1, borderColor: colors.line, paddingHorizontal: space(3), backgroundColor: colors.surface }, input: { minHeight: 52, flex: 1, minWidth: 0, color: colors.text, fontFamily: font, fontSize: 15 }, clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  cityChoices: { flexDirection: "row", flexWrap: "wrap", gap: space(2) }, cityChoice: { minHeight: 58, paddingHorizontal: space(4), paddingVertical: space(2), borderRadius: radius.sm, borderBottomWidth: 2, borderColor: "transparent" }, citySelected: { backgroundColor: colors.surface, borderColor: colors.amber }, cityName: { color: colors.text, fontFamily: font, fontSize: 15, fontWeight: "700" },
  cityHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(3) }, cityTitle: { color: colors.text, fontFamily: displayFont, fontSize: 26, fontWeight: "800" }, count: { fontFamily: mono, fontSize: 12, color: colors.textDim },
  explorer: { flexDirection: "row", alignItems: "stretch", gap: space(5) }, explorerCompact: { flexDirection: "column" }, mapColumn: { flex: 1.4, minWidth: 0 }, map: { width: "100%", aspectRatio: 640 / 420, backgroundColor: colors.surface, borderRadius: radius.md, overflow: "hidden", position: "relative" },
  mapCaption: { flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2) }, gridLine: { position: "absolute", backgroundColor: colors.lineSoft }, plotLabel: { position: "absolute", bottom: 12, left: 12, right: 12, fontSize: 9, fontFamily: mono, color: colors.textFaint },
  pinTarget: { position: "absolute", width: 44, height: 44, marginLeft: -22, marginTop: -22, alignItems: "center", justifyContent: "center", borderRadius: radius.pill }, pin: { width: 29, height: 29, borderRadius: radius.pill, backgroundColor: colors.bgElev, borderColor: colors.amber, borderWidth: 1, alignItems: "center", justifyContent: "center" }, pinSelected: { width: 36, height: 36, borderWidth: 3, backgroundColor: colors.surfaceAlt }, pinText: { fontFamily: mono, fontSize: 11, color: colors.text, fontWeight: "800" }, pinTextSelected: { color: colors.amber },
  legend: { flex: 1, minWidth: 0 }, legendCompact: { flex: 0 }, legendHeading: { minHeight: 36, flexDirection: "row", flexWrap: "wrap", gap: space(2), justifyContent: "space-between" }, list: { maxHeight: 330 }, venueRow: { flexDirection: "row", alignItems: "center", gap: space(3), minHeight: 68, paddingHorizontal: space(3), paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.lineSoft }, venueSelected: { backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.amber }, rowNumber: { fontFamily: mono, fontSize: 12, color: colors.textFaint, minWidth: 22 }, venueName: { fontFamily: font, fontSize: 14, lineHeight: 20, color: colors.text, fontWeight: "700" },
  selected: { padding: space(5), gap: space(3), backgroundColor: colors.surface, borderRadius: radius.md }, subtitle: { color: colors.text, fontFamily: displayFont, fontSize: 21, lineHeight: 28, fontWeight: "800" }, openVenue: { minHeight: 44, paddingHorizontal: space(4), gap: space(2), flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.amber, borderRadius: radius.sm },
  calendar: { gap: space(2) }, showRow: { flexDirection: "row", alignItems: "center", gap: space(4), paddingVertical: space(3), minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.lineSoft }, date: { width: 44, alignItems: "center" }, dateMonth: { fontFamily: mono, fontSize: 10, color: colors.amber }, dateDay: { fontFamily: displayFont, fontSize: 22, fontWeight: "800", color: colors.text }, footnote: { color: colors.textFaint, fontFamily: font, fontSize: 11, lineHeight: 17 }, empty: { gap: space(3), paddingVertical: space(5) },
});
