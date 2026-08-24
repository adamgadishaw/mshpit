import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";
import { afterpartySearches } from "../lib/afterparty";
import Icon from "./Icon";

const typeIcon = (type) => (type === "food" ? "food" : type === "activity" ? "star" : "drink");

export default function NearbyAfterparty({ log, coord }) {
  const [mapsError, setMapsError] = useState("");
  const nearbySearches = afterpartySearches(coord);

  const openSearch = async (url) => {
    setMapsError("");
    try {
      await Linking.openURL(url);
    } catch {
      setMapsError("Google Maps could not be opened. Try again from your browser or maps app.");
    }
  };

  return (
    <View>
      <Text style={styles.title}>AFTER THE SHOW</Text>
      <Text style={styles.sub}>EXPLORE NEAR THE VENUE</Text>
      {nearbySearches.length > 0 ? (
        <>
          <Text style={styles.nearbyNote}>
            Opens live Google Maps results. Verify hours, distance, age rules, and accessibility before you go.
          </Text>
          {nearbySearches.map((search) => (
            <Pressable
              key={search.id}
              style={({ pressed }) => [styles.spot, pressed && styles.spotPressed]}
              onPress={() => { void openSearch(search.url); }}
              accessibilityRole="link"
              accessibilityLabel={`Search Google Maps for ${search.label} near ${log.venue || "the venue"}`}
            >
              <View style={styles.spotIcon}>
                <Icon name={typeIcon(search.type)} size={16} color={colors.amber} />
              </View>
              <View style={styles.spotCopy}>
                <Text style={styles.spotName}>{search.label}</Text>
                <Text style={styles.spotMeta}>{search.description}</Text>
              </View>
              <View style={styles.linkBtn}>
                <Text style={styles.linkTxt}>Search Maps</Text>
                <Icon name="external" size={13} color={colors.amber} />
              </View>
            </Pressable>
          ))}
          {!!mapsError && <Text style={styles.error} accessibilityRole="alert" selectable>{mapsError}</Text>}
        </>
      ) : (
        <View style={styles.unavailable} accessibilityRole="text">
          <Icon name="pin" size={17} color={colors.textDim} />
          <View style={styles.spotCopy}>
            <Text style={styles.unavailableTitle}>Nearby search unavailable</Text>
            <Text style={styles.unavailableText}>Pit does not have a verified location for this venue, so it will not guess at nearby businesses or hours.</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: 0.5 },
  sub: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 16, marginBottom: 10 },
  nearbyNote: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  spot: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  spotPressed: { opacity: 0.76 },
  spotIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  spotCopy: { flex: 1 },
  spotName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  spotMeta: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7 },
  linkTxt: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 4 },
  unavailable: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 13 },
  unavailableTitle: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  unavailableText: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 3 },
});
