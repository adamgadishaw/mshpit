import { useCallback } from "react";
import { ActivityIndicator, View } from "react-native";
import CityDirectoryTiles from "../../components/cities/CityDirectoryTiles";
import { colors } from "../../theme";
import { readCityDirectory } from "./cityApi.mjs";
import useCityResource from "./useCityResource";

export default function CityDiscoveryTiles({ country = "", query = "", limit = 8, onOpenCity, title = true }) {
  const load = useCallback((signal) => readCityDirectory({ country, query, limit, signal }), [country, query, limit]);
  const resource = useCityResource(`cities:${country}:${query}:${limit}`, load, { delay: query ? 220 : 0 });
  if (!resource.data) return resource.status === "loading" ? <View style={{ padding: 12 }}><ActivityIndicator color={colors.amber} /></View> : null;
  return <CityDirectoryTiles cities={resource.data.cities} copy={resource.data.copy} onOpenCity={onOpenCity} title={title} />;
}
