import { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, displayFont, space } from "../../theme";
import CityDirectoryCard from "./CityDirectoryCard";
import { cityText } from "./cityPresentation.mjs";
import { discoveryGridLayout } from "../../domain/discoveryGridLayout.mjs";

export default function CityDirectoryTiles({ cities = [], copy = {}, onOpenCity, title = true }) {
  const { width } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(null);
  const layout = discoveryGridLayout(containerWidth ?? Math.min(width, 1040) - (width < 620 ? 28 : 48));
  if (!cities.length) return null;
  return <View style={styles.section}>
    {title ? <Text accessibilityRole="header" style={styles.heading}>{cityText(copy, "citiesTitle")}</Text> : null}
    <View style={[styles.grid, { gap: layout.gap }]} onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}>
      {cities.map((city) => <View key={`${city.countryCode}:${city.citySlug}`} style={[styles.tile, { width: layout.tileWidth }]}>
        <CityDirectoryCard city={city} copy={copy} onOpenCity={onOpenCity} compact style={styles.card} />
      </View>)}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: space(3), minWidth: 0 }, heading: { color: colors.text, fontSize: 23, fontFamily: displayFont, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", minWidth: 0, width: "100%" },
  tile: { minWidth: 0, maxWidth: "100%" }, card: { width: "100%", flex: 1 },
});
