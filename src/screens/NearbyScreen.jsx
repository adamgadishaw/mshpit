import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { colors, mono, radius as rad } from "../theme";
import { useStore } from "../store";
import { cityCoords } from "../data";
import Icon from "../components/Icon";
import ConcertMap from "../components/ConcertMap";
import LocationPicker from "../components/LocationPicker";
import ScreenHeader from "../components/ScreenHeader";

const RADII = [25, 50, 75, 150];

function TicketAction({ show }) {
  if (show.soldOut) {
    return (
      <View style={styles.soldOut}>
        <Text style={styles.soldOutTxt}>SOLD OUT</Text>
      </View>
    );
  }
  return (
    <Pressable style={styles.ticketBtn} onPress={() => Linking.openURL(show.ticketUrl)}>
      <Icon name="ticket" size={14} color="#1A1206" />
      <Text style={styles.ticketTxt}>Tickets</Text>
    </Pressable>
  );
}

export default function NearbyScreen({ onClose, onOpenVenue, onOpenArtist }) {
  const { session, localVenues, regionShows } = useStore();
  const [center, setCenter] = useState(session?.home || null);
  const [km, setKm] = useState(75);
  const [tab, setTab] = useState("venues");
  const [pickingCity, setPickingCity] = useState(false);

  if (pickingCity) {
    return (
      <LocationPicker
        onClose={() => setPickingCity(false)}
        onSelect={(place) => {
          const c = cityCoords[place.city];
          setCenter({ city: place.city, lat: c?.lat ?? null, lng: c?.lng ?? null });
          setPickingCity(false);
        }}
      />
    );
  }

  const hasCoords = center && center.lat != null;
  const venues = localVenues(km, center);
  const shows = regionShows(km, center);
  const mapPoints = venues.map((v) => ({ name: v.name, lat: v.coord.lat, lng: v.coord.lng }));

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="DISCOVER" title="Near you" onBack={onClose} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* choose which city to browse */}
        <Pressable style={styles.cityBtn} onPress={() => setPickingCity(true)}>
          <Icon name="pin" size={16} color={colors.amber} />
          <Text style={styles.cityTxt}>{center?.city || "Pick a city"}</Text>
          <Text style={styles.cityChange}>change</Text>
          <Icon name="chevron-right" size={16} color={colors.textDim} />
        </Pressable>

        {/* radius toggle */}
        <View style={styles.radii}>
          {RADII.map((r) => (
            <Pressable key={r} style={[styles.radChip, km === r && styles.radChipOn]} onPress={() => setKm(r)}>
              <Text style={[styles.radTxt, km === r && styles.radTxtOn]}>{r} km</Text>
            </Pressable>
          ))}
        </View>

        {!hasCoords && <Text style={styles.empty}>No coordinates for {center?.city || "this city"} yet - pick a major city.</Text>}

        {hasCoords && (
          <View style={styles.mapWrap}>
            <ConcertMap points={mapPoints} highlight={{ lat: center.lat, lng: center.lng }} label={center.city} onOpenVenue={onOpenVenue} />
            <Text style={styles.mapCaption}>{venues.length} venues · {shows.length} shows within {km} km</Text>
          </View>
        )}

        {hasCoords && (
          <View style={styles.segment}>
            <Seg label={`Venues · ${venues.length}`} on={tab === "venues"} onPress={() => setTab("venues")} />
            <Seg label={`Shows · ${shows.length}`} on={tab === "shows"} onPress={() => setTab("shows")} />
          </View>
        )}

        {hasCoords && tab === "venues" &&
          venues.map((v) => (
            <Pressable key={v.name} style={styles.row} onPress={() => onOpenVenue?.(v.name)}>
              <View style={styles.venueIcon}>
                <Icon name="pin" size={18} color={colors.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{v.name}</Text>
                <Text style={styles.sub}>{v.place}</Text>
                {v.upcoming > 0 && <Text style={styles.upcoming}>{v.upcoming} upcoming</Text>}
              </View>
              <Text style={styles.dist}>{v.distanceKm.toFixed(0)} km</Text>
              <Icon name="chevron-right" size={18} color={colors.textDim} />
            </Pressable>
          ))}
        {hasCoords && tab === "venues" && venues.length === 0 && <Text style={styles.empty}>No venues within {km} km.</Text>}

        {hasCoords && tab === "shows" &&
          shows.map((s) => (
            <View key={s.id} style={styles.row}>
              <Pressable style={{ flex: 1 }} onPress={() => onOpenArtist?.(s.artist)}>
                <Text style={styles.title}>{s.artist}</Text>
                <Pressable onPress={() => onOpenVenue?.(s.venue)}>
                  <Text style={styles.sub}>{s.venue} · {s.distanceKm.toFixed(0)} km</Text>
                </Pressable>
                <Text style={styles.date}>{s.date}{s.genre ? `  · ${s.genre}` : ""}</Text>
              </Pressable>
              <TicketAction show={s} />
            </View>
          ))}
        {hasCoords && tab === "shows" && shows.length === 0 && <Text style={styles.empty}>No upcoming shows within {km} km.</Text>}
      </ScrollView>
    </View>
  );
}

function Seg({ label, on, onPress }) {
  return (
    <Pressable style={[styles.seg, on && styles.segOn]} onPress={onPress}>
      <Text style={[styles.segTxt, on && styles.segTxtOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8 },
  backBtn: { flexDirection: "row", alignItems: "center", width: 56 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 40 },
  cityBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: rad.md, borderWidth: 1, borderColor: colors.amber, paddingHorizontal: 14, paddingVertical: 13 },
  cityTxt: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "700" },
  cityChange: { color: colors.amber, fontSize: 12, fontWeight: "600" },
  radii: { flexDirection: "row", gap: 8, marginTop: 12 },
  radChip: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  radChipOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  radTxt: { color: colors.textDim, fontSize: 12, fontFamily: mono },
  radTxtOn: { color: colors.amber, fontWeight: "800" },
  mapWrap: { marginTop: 16 },
  mapCaption: { color: colors.textFaint, fontSize: 12, marginTop: 8, textAlign: "center", fontFamily: mono },
  segment: { flexDirection: "row", gap: 8, marginTop: 18, marginBottom: 6 },
  seg: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  segOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  segTxt: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  segTxtOn: { color: colors.amber, fontWeight: "700" },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", marginTop: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: rad.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginTop: 10 },
  venueIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  upcoming: { color: colors.amber, fontSize: 12, marginTop: 4 },
  date: { color: colors.amber, fontFamily: mono, fontSize: 12, marginTop: 6 },
  dist: { color: colors.textFaint, fontFamily: mono, fontSize: 12 },
  ticketBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.amberStrong, borderRadius: rad.pill, paddingHorizontal: 14, paddingVertical: 9 },
  ticketTxt: { color: "#1A1206", fontSize: 13, fontWeight: "800" },
  soldOut: { borderWidth: 1, borderColor: colors.danger, borderRadius: rad.pill, paddingHorizontal: 12, paddingVertical: 8 },
  soldOutTxt: { color: colors.danger, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
});
