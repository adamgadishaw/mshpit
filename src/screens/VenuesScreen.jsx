import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";

// Find venues by location, the same "attach a city" mental model as the profile
// city picker, but for browsing rooms. Cities carry a venue count; tap one to see
// its venues, or type to jump straight to a venue anywhere.
export default function VenuesScreen({ onClose, onOpenVenue }) {
  const { venuesByCity, searchVenues, session } = useStore();
  const [q, setQ] = useState("");
  const [city, setCity] = useState(null);
  const query = q.trim();

  const cities = useMemo(() => venuesByCity(), []);
  const homeCity = session?.home?.city;

  // Typed query → flat venue results across everywhere (skip the city level).
  const venueResults = useMemo(() => (query ? searchVenues(query) : []), [query]);

  // City list, home city pinned first.
  const cityList = useMemo(() => {
    if (!homeCity) return cities;
    const mine = cities.filter((c) => c.city === homeCity);
    const rest = cities.filter((c) => c.city !== homeCity);
    return [...mine, ...rest];
  }, [cities, homeCity]);

  const selected = city ? cities.find((c) => c.city === city) : null;

  const VenueRow = ({ v }) => (
    <Pressable style={styles.row} onPress={() => onOpenVenue?.(v.name)}>
      <View style={styles.vIcon}><Icon name="pin" size={16} color={colors.cool} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.vName}>{v.name}</Text>
        <Text style={styles.vPlace} numberOfLines={1}>{v.place || "-"}</Text>
      </View>
      {v.upcoming > 0 && (
        <View style={styles.upPill}><Text style={styles.upPillTxt}>{v.upcoming} upcoming</Text></View>
      )}
      <Icon name="chevron-right" size={18} color={colors.textDim} />
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        kicker="VENUES"
        title={selected ? selected.city : "Find venues"}
        onBack={selected && !query ? () => setCity(null) : onClose}
      />

      <View style={styles.fieldWrap}>
        <View style={styles.field}>
          <Icon name="search" size={18} color={colors.textDim} />
          <TextInput
            style={styles.input}
            placeholder="Search a venue or city"
            placeholderTextColor={colors.textFaint}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            maxLength={80}
          />
          {!!q && (
            <Pressable onPress={() => setQ("")} hitSlop={8}><Icon name="x" size={16} color={colors.textFaint} /></Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {query ? (
          <>
            <Text style={styles.sectionLabel}>VENUES · {venueResults.length}</Text>
            {venueResults.length === 0 && <Text style={styles.empty}>No venues match "{q}".</Text>}
            {venueResults.map((v) => <VenueRow key={v.name} v={v} />)}
          </>
        ) : selected ? (
          <>
            <Text style={styles.sectionLabel}>
              {selected.count} VENUE{selected.count === 1 ? "" : "S"}{selected.upcoming > 0 ? ` · ${selected.upcoming} UPCOMING` : ""}
            </Text>
            {selected.venues.map((v) => <VenueRow key={v.name} v={v} />)}
          </>
        ) : (
          <>
            <Text style={styles.hint}>Browse rooms by city, the number shows how many venues we track there.</Text>
            <Text style={styles.sectionLabel}>CITIES · {cityList.length}</Text>
            {cityList.map((c) => (
              <Pressable key={c.city + c.region} style={styles.cityRow} onPress={() => setCity(c.city)}>
                <View style={styles.cIcon}><Icon name="pin" size={16} color={colors.amber} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cName}>
                    {c.city}{c.city === homeCity ? <Text style={styles.homeTag}>  · home</Text> : null}
                  </Text>
                  {!!c.region && <Text style={styles.cRegion} numberOfLines={1}>{c.region}</Text>}
                </View>
                <View style={styles.countWrap}>
                  <Text style={styles.count}>{c.count}</Text>
                  <Text style={styles.countLabel}>venue{c.count === 1 ? "" : "s"}</Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.textDim} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  fieldWrap: { paddingHorizontal: 16, paddingBottom: 6 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  content: { padding: 16, paddingTop: 10, paddingBottom: 48 },
  hint: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 14, marginBottom: 10 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },
  cityRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  cIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  cName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  homeTag: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  cRegion: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  countWrap: { alignItems: "center", minWidth: 44 },
  count: { color: colors.amber, fontFamily: mono, fontSize: 18, fontWeight: "800" },
  countLabel: { color: colors.textFaint, fontSize: 9, letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  vIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  vName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  vPlace: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  upPill: { borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  upPillTxt: { color: colors.amber, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
});
