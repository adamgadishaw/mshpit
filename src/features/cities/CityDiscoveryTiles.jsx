import { useCallback, useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import CityDirectoryTiles from "../../components/cities/CityDirectoryTiles";
import CityDirectoryRail from "../../components/cities/CityDirectoryRail";
import Button from "../../components/Button";
import { colors, font, radius, space } from "../../theme";
import { readCityDirectory } from "./cityApi.mjs";
import useCityResource from "./useCityResource";

export default function CityDiscoveryTiles({ country = "", query = "", limit = 8, onOpenCity, title = true, registerRefresh, layout = "grid" }) {
  const load = useCallback((signal) => readCityDirectory({ country, query, limit, signal }), [country, query, limit]);
  const resource = useCityResource(`cities:${country}:${query}:${limit}`, load, { delay: query ? 220 : 0 });
  useEffect(() => {
    registerRefresh?.(resource.refresh);
    return () => registerRefresh?.(null);
  }, [registerRefresh, resource.refresh]);
  const copy = resource.data?.copy || {};
  const cities = Array.isArray(resource.data?.cities) ? resource.data.cities : [];
  const Directory = layout === "rail" ? CityDirectoryRail : CityDirectoryTiles;
  return <View style={styles.root}>
    {resource.error ? <View style={styles.message}>
      <Text style={styles.error} accessibilityRole="alert">{copy.loadError || "City guides could not load."}</Text>
      <Button small variant="secondary" title={copy.retry || "Try again"} onPress={resource.reload} />
    </View> : null}
    {!resource.data && !resource.error ? <View style={styles.message} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.amber} /><Text style={styles.detail}>{copy.loading || "Loading city guides…"}</Text></View> : null}
    {resource.data && !cities.length ? <View style={styles.message}><Text style={styles.detail}>{copy.noCities || "No cities found."}</Text></View> : null}
    <Directory cities={cities} copy={copy} onOpenCity={onOpenCity} title={title} />
  </View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, gap: space(3) },
  message: { alignItems: "center", gap: space(3), padding: space(5), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.surface },
  detail: { color: colors.textDim, fontFamily: font, fontSize: 13, textAlign: "center" },
  error: { color: colors.danger, fontFamily: font, fontSize: 13, textAlign: "center" },
});
