import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, space } from "../../theme";
import CityDirectoryCard from "./CityDirectoryCard";
import { cityText } from "./cityPresentation.mjs";

export default function CityDirectoryTiles({ cities = [], copy = {}, onOpenCity, title = true }) {
  if (!cities.length) return null;
  return <View style={styles.section}>
    {title ? <Text accessibilityRole="header" style={styles.heading}>{cityText(copy, "citiesTitle")}</Text> : null}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {cities.map((city) => <CityDirectoryCard key={`${city.countryCode}:${city.citySlug}`} city={city} copy={copy} onOpenCity={onOpenCity} compact />)}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: space(3), minWidth: 0 }, heading: { color: colors.text, fontSize: 23, fontFamily: displayFont, fontWeight: "800" },
  row: { gap: space(3), paddingBottom: space(2) },
});
