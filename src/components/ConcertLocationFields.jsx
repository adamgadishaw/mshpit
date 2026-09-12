import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, mono, radius } from "../theme";
import { LIMITS } from "../domain/validation.mjs";
import Icon from "./Icon";

const EMPTY_SEARCH = Object.freeze({ query: "", status: "idle", cities: [] });
const cityLabel = (city) => [city.city, city.region, city.country].filter(Boolean).join(", ");

// These fields describe the concert, never the member's home. The directory is
// an optional spelling aid; a failed search cannot prevent a manual location.
export default function ConcertLocationFields({ city = "", eventAddress = "", onCityChange, onEventAddressChange, readCities }) {
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [search, setSearch] = useState(EMPTY_SEARCH);
  const activeRequest = useRef(null);
  const query = city.trim();
  useEffect(() => {
    if (!searchEnabled || query.length < 2) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const timer = setTimeout(async () => {
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setSearch({ query, status: "loading", cities: [] });
      try {
        const payload = await readCities({ query, limit: 5, signal: controller.signal });
        if (controller.signal.aborted || activeRequest.current !== controller) return;
        const cities = (Array.isArray(payload?.cities) ? payload.cities : [])
          .filter((candidate) => candidate && typeof candidate.city === "string" && candidate.city.trim()
            && typeof candidate.country === "string" && candidate.country.trim())
          .slice(0, 5);
        setSearch({ query, status: "ready", cities });
      } catch {
        if (!controller.signal.aborted && activeRequest.current === controller) {
          setSearch({ query, status: "error", cities: [] });
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (activeRequest.current === controller) activeRequest.current = null;
    };
  }, [query, searchEnabled, readCities]);

  const stopSearch = () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setSearchEnabled(false);
  };
  const changeCity = (value) => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setSearch(EMPTY_SEARCH);
    setSearchEnabled(true);
    onCityChange(value);
  };
  const visibleSearch = searchEnabled && search.query === query ? search : EMPTY_SEARCH;
  return (
    <View style={styles.fields}>
      <Text style={styles.label}>CITY</Text>
      <TextInput
        style={styles.input}
        placeholder="City, region, country"
        placeholderTextColor={colors.textFaint}
        value={city}
        onChangeText={changeCity}
        maxLength={LIMITS.city}
        autoComplete="off"
        accessibilityLabel="Concert city, region and country"
        accessibilityHint="Choose a city or type it yourself. A city is enough if you don't know the venue."
      />
      {visibleSearch.status === "loading" && <Text style={styles.hint} accessibilityLiveRegion="polite">Finding cities…</Text>}
      {visibleSearch.cities.length > 0 && (
        <View style={styles.results}>
          {visibleSearch.cities.map((candidate) => {
            const label = cityLabel(candidate);
            return (
              <Pressable
                key={`${candidate.countryCode || candidate.country}/${candidate.citySlug || label}`}
                style={styles.result}
                accessibilityRole="button"
                accessibilityLabel={`Use ${label}`}
                onPress={() => { stopSearch(); onCityChange(label); }}
              >
                <Icon name="pin" size={16} color={colors.cool} />
                <Text style={styles.resultText}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {visibleSearch.status === "error" ? (
        <Text style={styles.hint} accessibilityLiveRegion="polite">City search is unavailable. You can still type the city, region and country.</Text>
      ) : visibleSearch.status === "ready" && !visibleSearch.cities.length ? (
        <Text style={styles.hint} accessibilityLiveRegion="polite">No matching city? Keep the city, region and country you entered.</Text>
      ) : <Text style={styles.hint}>No known venue? A city is enough. Include the region and country to help place your concert.</Text>}
      <Text style={styles.label}>PUBLIC EVENT ADDRESS <Text style={styles.optional}>optional</Text></Text>
      <TextInput
        style={styles.input}
        placeholder="Street address of the event"
        placeholderTextColor={colors.textFaint}
        value={eventAddress}
        onChangeText={onEventAddressChange}
        onFocus={stopSearch}
        maxLength={LIMITS.eventAddress}
        autoComplete="off"
        accessibilityLabel="Public event address, optional"
        accessibilityHint="Visible on the post. Do not add a private home address. Include the concert city."
      />
      <Text style={styles.hint}>Visible on your post. Don't add a private home address. Without a recognized venue, the map uses the city area, not this exact address.</Text>
      {!!eventAddress.trim() && !city.trim() && (
        <Text style={styles.error} accessibilityLiveRegion="polite">Add the city for this address before posting.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { minWidth: 0, marginTop: 12, marginBottom: 16 },
  label: { color: colors.textDim, fontFamily: mono, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 },
  optional: { color: colors.textFaint, fontFamily: undefined, fontWeight: "500", letterSpacing: 0 },
  input: { minHeight: 48, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15, color: colors.text, minWidth: 0 },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 7, marginBottom: 14 },
  results: { marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, overflow: "hidden" },
  result: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: colors.surface, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft },
  resultText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: -6, marginBottom: 8 },
});
