import { use, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { colors, radius, space } from "../theme";
import { CityNavigationContext } from "../components/cities/CityNavigationContext";
import { cityText } from "../components/cities/cityPresentation.mjs";
import CityDirectoryCard from "../components/cities/CityDirectoryCard";
import ScreenHeader from "../components/ScreenHeader";
import Button from "../components/Button";
import { readCityCopy, readCityDirectory } from "../features/cities/cityApi.mjs";
import useCityResource from "../features/cities/useCityResource";
import { isLoadCancellation } from "../domain/loadState.mjs";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";

export default function CityDirectoryScreen({ accountId, onClose, onOpenCity }) {
  const openFromContext = use(CityNavigationContext);
  const openCity = onOpenCity || openFromContext;
  const { width } = useWindowDimensions();
  const columns = width >= 1080 ? 3 : width >= 620 ? 2 : 1;
  const [query, setQuery] = useState("");
  const search = query.trim();
  const load = useCallback((signal) => readCityDirectory({ query: search, limit: 30, signal }), [search]);
  const resource = useCityResource(`city-directory:${search}`, load, { delay: 200 });
  const loadCopy = useCallback((signal) => readCityCopy({ signal }), []);
  const copyResource = useCityResource("city-directory-copy", loadCopy);
  const [extra, setExtra] = useState({ scope: null, cities: [], nextCursor: null, loading: false, error: "" });
  const controllerRef = useRef(null);
  const { refresh: refreshCities, refreshing } = useScopedRefresh({
    scope: refreshScope(accountId, "city-directory", search),
    task: async ({ signal }) => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setExtra((current) => ({ ...current, loading: false, error: "" }));
      return Promise.all([resource.refresh({ signal }), copyResource.refresh({ signal })]);
    },
  });
  useEffect(() => () => controllerRef.current?.abort(), [search, resource.data]);
  const current = extra.scope === resource.data ? extra : { cities: [], nextCursor: resource.data?.nextCursor, loading: false, error: "" };
  const copy = resource.data?.copy || copyResource.data?.copy || {};
  const t = (key, values) => cityText(copy, key, values);
  const cities = [...(resource.data?.cities || []), ...current.cities];
  const more = async () => {
    if (!current.nextCursor || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const scope = resource.data;
    setExtra({ ...current, scope, loading: true, error: "" });
    try {
      const page = await readCityDirectory({ query: search, limit: 30, cursor: current.nextCursor, signal: controller.signal });
      if (controller.signal.aborted) return;
      const seen = new Set(cities.map((city) => `${city.countryCode}:${city.citySlug}`));
      setExtra({ scope, cities: [...current.cities, ...page.cities.filter((city) => !seen.has(`${city.countryCode}:${city.citySlug}`))], nextCursor: page.nextCursor, loading: false, error: "" });
    } catch (error) {
      if (!isLoadCancellation(error, controller.signal)) setExtra({ ...current, scope, loading: false, error: error?.message || t("loadError") });
    } finally { if (controllerRef.current === controller) controllerRef.current = null; }
  };
  return <View style={styles.root}><ScreenHeader title={t("citiesTitle")} kicker={t("guideLabel")} onBack={onClose} />
    <VinylRefreshBoundary refreshing={refreshing} onRefresh={refreshCities} accessibilityLabel={t("refreshCitiesLabel")}>
    <FlatList key={columns} data={cities} numColumns={columns} keyExtractor={(city) => `${city.countryCode}:${city.citySlug}`} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} columnWrapperStyle={columns > 1 ? styles.columns : undefined} keyboardShouldPersistTaps="handled" initialNumToRender={15} maxToRenderPerBatch={12} windowSize={5}
      ListHeaderComponent={<View style={styles.header}><Text selectable style={styles.intro}>{t("citiesDescription")}</Text><TextInput accessibilityLabel={t("citySearchPlaceholder")} placeholder={t("citySearchPlaceholder")} placeholderTextColor={colors.textFaint} value={query} onChangeText={setQuery} maxLength={100} autoCapitalize="none" autoCorrect={false} style={styles.input} />{resource.error ? <View style={styles.message}><Text accessibilityRole="alert" style={styles.error}>{t("loadError")}</Text><Button title={t("retry")} variant="secondary" onPress={resource.reload} /></View> : null}</View>}
      ListEmptyComponent={resource.status === "loading" ? <ActivityIndicator color={colors.amber} /> : <Text style={styles.empty}>{t("noCities")}</Text>}
      renderItem={({ item }) => <CityDirectoryCard city={item} copy={copy} onOpenCity={openCity} />}
      ListFooterComponent={<View style={styles.footer}>{current.error ? <Text style={styles.error} accessibilityRole="alert">{current.error}</Text> : null}{current.nextCursor ? <Button title={t("showMore")} variant="secondary" onPress={more} loading={current.loading} /> : null}</View>} />
    </VinylRefreshBoundary>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg, minWidth: 0 }, content: { width: "100%", maxWidth: 1160, alignSelf: "center", padding: space(4), paddingBottom: space(13), gap: space(3) }, columns: { gap: space(3) }, header: { gap: space(4), paddingBottom: space(3) }, intro: { color: colors.textDim, fontSize: 16, lineHeight: 25, maxWidth: 720 }, input: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, minHeight: space(13), padding: space(4), fontSize: 16 }, footer: { gap: space(3), paddingTop: space(4) }, error: { color: colors.danger, lineHeight: 22 }, empty: { color: colors.textDim, paddingVertical: space(6) }, message: { gap: space(3) } });
