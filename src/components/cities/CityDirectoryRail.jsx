import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, space } from "../../theme";
import CityDirectoryCard from "./CityDirectoryCard";
import { cityText } from "./cityPresentation.mjs";

// Search keeps this preview to one row; Discover retains its full city grid.
export default function CityDirectoryRail({ cities = [], copy = {}, onOpenCity, title = true }) {
  if (!cities.length) return null;
  return <View style={styles.section}>
    {title ? <Text accessibilityRole="header" style={styles.heading}>{cityText(copy, "citiesTitle")}</Text> : null}
    <ScrollView horizontal style={styles.rail} contentContainerStyle={styles.content}
      testID="city-directory-rail" accessibilityLabel={cityText(copy, "citiesTitle")}
      showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" directionalLockEnabled>
      {cities.map((city) => <CityDirectoryCard key={`${city.countryCode}:${city.citySlug}`}
        city={city} copy={copy} onOpenCity={onOpenCity} compact style={styles.card} />)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: space(3), minWidth: 0, width: "100%" },
  heading: { color: colors.text, fontSize: 23, fontFamily: displayFont, fontWeight: "800" },
  rail: { flexGrow: 0, minWidth: 0, width: "100%" },
  content: { gap: space(3), paddingHorizontal: space(1), paddingBottom: space(2) },
  card: { flexShrink: 0 },
});
