import useNativeTabContentReady from "../../hooks/useNativeTabContentReady";
import { ScrollView } from "../../components/NativeTabScroll";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, font, radius, space } from "../../theme";
import Button from "../../components/Button";
import FestivalCard from "./FestivalCard";
import { readFestivals } from "./festivalApi.mjs";
import { festivalMonths } from "./festivalFormat.mjs";
import { currentFestivalEditions } from "./festivalPresentation.ios.mjs";
import useFestivalDay from "./useFestivalDay";
import useFestivalResource from "./useFestivalResource";

export default function FestivalsPanel({ region = "Worldwide", onOpenFestival, registerRefresh }) {
  const country = region === "Worldwide" ? "" : region;
  const load = useCallback(signal => readFestivals({ country, signal }), [country]);
  const resource = useFestivalResource(`festivals:${country}`, load);
  useNativeTabContentReady(!!resource.data || !!resource.error);
  const today = useFestivalDay();
  const [monthKey, setMonthKey] = useState(null);
  useEffect(() => { registerRefresh?.(resource.refresh); return () => registerRefresh?.(null); }, [registerRefresh, resource.refresh]);
  const upcoming = useMemo(() => currentFestivalEditions(resource.data?.upcoming, today), [resource.data, today]);
  const months = useMemo(() => festivalMonths(upcoming), [upcoming]);
  const activeMonth = months.some(month => month.key === monthKey) ? monthKey : null;
  const shown = activeMonth ? months.filter(month => month.key === activeMonth) : months;
  const open = edition => onOpenFestival?.(edition.festivalSlug, edition.id);
  return <View style={styles.root}>
    <View style={styles.header}>
      <Text style={styles.kicker}>{country ? region : "Around the world"}</Text>
      <Text style={styles.title} accessibilityRole="header">Find your next festival</Text>
      <Text style={styles.detail}>Explore the dates, places and lineups currently listed on Mshpit.</Text>
    </View>
    {resource.error ? <View style={styles.message}>
      <Text style={styles.detail} accessibilityRole="alert">{resource.data ? "Could not refresh festivals. Previously loaded dates are still shown." : "Festivals could not load. Check your connection and try again."}</Text>
      <Button title="Try again" small variant="secondary" onPress={resource.reload} />
    </View> : null}
    {!resource.data && !resource.error ? <View style={styles.message}><ActivityIndicator color={colors.amber} /><Text style={styles.detail}>Loading festivals…</Text></View> : null}
    {resource.data && !upcoming.length ? <View style={styles.message}><Text style={styles.detail}>{country ? `No upcoming festival dates are listed in ${region}.` : "No upcoming festival dates are listed."}</Text></View> : null}
    {months.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Festival months">
      {[{ key: null, short: "All dates" }, ...months].map(month => <Pressable key={month.key || "all"} onPress={() => setMonthKey(month.key)}
        style={[styles.chip, activeMonth === month.key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: activeMonth === month.key }}>
        <Text style={[styles.chipText, activeMonth === month.key && styles.chipTextOn]}>{month.short}</Text>
      </Pressable>)}
    </ScrollView> : null}
    {shown.map(month => <View key={month.key} style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{month.title}</Text>
      {month.editions.map(edition => <FestivalCard key={edition.id} edition={edition} onOpen={open} />)}
    </View>)}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: space(5), minWidth: 0 }, header: { gap: space(2), paddingVertical: space(2) },
  kicker: { color: colors.amber, fontFamily: font, fontSize: 13, fontWeight: "700" }, title: { color: colors.text, fontFamily: displayFont, fontSize: 30, lineHeight: 36, fontWeight: "900" },
  detail: { color: colors.textDim, fontFamily: font, fontSize: 14, lineHeight: 21 },
  message: { gap: space(3), padding: space(4), backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.md },
  chips: { gap: space(2) }, chip: { minHeight: 44, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 15 },
  chipOn: { backgroundColor: colors.amber, borderColor: colors.amber }, chipText: { color: colors.text, fontFamily: font, fontSize: 14, fontWeight: "700" }, chipTextOn: { color: colors.bg },
  section: { gap: space(3) }, sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 21, fontWeight: "800" },
});
