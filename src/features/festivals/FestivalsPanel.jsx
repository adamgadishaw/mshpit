import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, displayFont, font, mono, radius, space } from "../../theme";
import Button from "../../components/Button";
import FestivalBackdrop from "./FestivalBackdrop";
import FestivalCard from "./FestivalCard";
import Rise from "./Rise";
import { readFestivals } from "./festivalApi.mjs";
import { festivalAccent, festivalCountdown, festivalDateRange, festivalMonths, festivalPlace, festivalSummary, lineupIsNew } from "./festivalFormat.mjs";
import useFestivalResource from "./useFestivalResource";

// Discover's Festivals tab and the /festivals page: upcoming festival
// editions, kept apart from regular shows. A marquee with the next festival,
// fresh lineups, then every edition month by month with a month filter.
export default function FestivalsPanel({ region = "Worldwide", onOpenFestival, registerRefresh }) {
  const country = region === "Worldwide" ? "" : region;
  const load = useCallback((signal) => readFestivals({ country, signal }), [country]);
  const resource = useFestivalResource(`festivals:${country}`, load);
  const [monthKey, setMonthKey] = useState(null);
  useEffect(() => {
    registerRefresh?.(resource.refresh);
    return () => registerRefresh?.(null);
  }, [registerRefresh, resource.refresh]);
  const upcoming = useMemo(() => (Array.isArray(resource.data?.upcoming) ? resource.data.upcoming : []), [resource.data]);
  const months = useMemo(() => festivalMonths(upcoming), [upcoming]);
  const summary = useMemo(() => festivalSummary(upcoming), [upcoming]);
  const fresh = upcoming.filter((edition) => lineupIsNew(edition)).slice(0, 6);
  const activeMonth = months.some((month) => month.key === monthKey) ? monthKey : null;
  const shown = activeMonth ? months.filter((month) => month.key === activeMonth) : months;
  const open = (edition) => onOpenFestival?.(edition.festivalSlug, edition.id);
  let order = 0;
  return <View style={styles.root}>
    <Marquee region={country ? region : ""} summary={summary} onOpen={open} />
    {resource.error ? <View style={styles.message}>
      <Text style={styles.error} accessibilityRole="alert">Festivals could not load. Check your connection and try again.</Text>
      <Button small variant="secondary" title="Try again" onPress={resource.reload} />
    </View> : null}
    {!resource.data && !resource.error ? <View style={styles.message} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.amber} /><Text style={styles.detail}>Loading festivals...</Text>
    </View> : null}
    {resource.data && !upcoming.length ? <View style={styles.message}>
      <Text style={styles.detail}>{country ? `No upcoming festivals listed in ${region} yet. New dates appear here as soon as tickets are listed.` : "No upcoming festivals listed yet. New dates appear here as soon as tickets are listed."}</Text>
    </View> : null}
    {months.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthChips}
      accessibilityLabel="Show festivals by month">
      {[{ key: null, short: "All dates", editions: upcoming }, ...months].map((month) => {
        const on = activeMonth === month.key;
        return <Pressable key={month.key || "all"} onPress={() => setMonthKey(month.key)} style={[styles.monthChip, on && styles.monthChipOn]}
          accessibilityRole="button" accessibilityState={{ selected: on }} aria-pressed={on} accessibilityLabel={`${month.key ? month.title : "All dates"}, ${month.editions.length} ${month.editions.length === 1 ? "festival" : "festivals"}`}>
          <Text style={[styles.monthChipText, on && styles.monthChipTextOn]}>{month.short}</Text>
          <Text style={[styles.monthChipCount, on && styles.monthChipTextOn]}>{month.editions.length}</Text>
        </Pressable>;
      })}
    </ScrollView> : null}
    {fresh.length && !activeMonth ? <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">Lineups just announced</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {fresh.map((edition) => <Rise key={`fresh:${edition.id}`} index={order++} style={styles.railItem}><FestivalCard edition={edition} onOpen={open} size="small" /></Rise>)}
      </ScrollView>
    </View> : null}
    {shown.map((month) => <View key={month.key} style={styles.section}>
      <View style={styles.monthHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{month.title}</Text>
        <Text style={styles.monthCount}>{month.editions.length === 1 ? "1 festival" : `${month.editions.length} festivals`}</Text>
      </View>
      <Grid items={month.editions} renderItem={(edition, itemStyle) => <Rise key={edition.id} index={order++} style={itemStyle}><FestivalCard edition={edition} onOpen={open} size="small" /></Rise>} />
    </View>)}
  </View>;
}

// The top of the page: a lit stage with the headline numbers and the next
// festival to start.
function Marquee({ region, summary, onOpen }) {
  const narrow = useWindowDimensions().width < 620;
  const next = summary.next;
  const countdown = next ? festivalCountdown(next) : null;
  return <View style={[styles.marquee, narrow && styles.marqueeNarrow]}>
    <FestivalBackdrop accent={festivalAccent(next?.festivalSlug || "festivals")} beams />
    <View style={styles.marqueeBody}>
      <Rise index={0}><Text style={styles.marqueeKicker}>{region ? `Festival season in ${region}` : "Festival season"}</Text></Rise>
      <Rise index={1}><Text style={[styles.marqueeTitle, narrow && styles.marqueeTitleNarrow]} accessibilityRole="header">Festivals</Text></Rise>
      <Rise index={2}><Text style={styles.marqueeCopy}>Dates, lineups by day and who's going. New editions show up here as soon as tickets go on sale.</Text></Rise>
      {summary.festivals ? <Rise index={3} style={styles.marqueeStats}>
        <BigStat value={summary.festivals} label={summary.festivals === 1 ? "festival ahead" : "festivals ahead"} />
        {summary.newLineups ? <BigStat value={summary.newLineups} label={summary.newLineups === 1 ? "new lineup" : "new lineups"} /> : null}
        {summary.countries > 1 ? <BigStat value={summary.countries} label="countries" /> : null}
      </Rise> : null}
    </View>
    {next && countdown ? <Rise index={4} style={styles.nextWrap}>
      <Pressable onPress={() => onOpen(next)} style={({ hovered, pressed }) => [styles.next, hovered && styles.nextHover, pressed && styles.pressed]}
        accessibilityRole="link" accessibilityLabel={`${countdown.live ? "Happening now" : "Next up"}: ${next.name}, ${festivalDateRange(next.startDate, next.endDate)}, ${countdown.label}`}>
        <Text style={styles.nextKicker}>{countdown.live ? "Happening now" : "Next up"}</Text>
        <Text style={styles.nextName} numberOfLines={2}>{next.name}</Text>
        <Text style={styles.nextWhen}>{festivalDateRange(next.startDate, next.endDate)}</Text>
        {festivalPlace(next) ? <Text style={styles.nextWhere} numberOfLines={1}>{festivalPlace(next)}</Text> : null}
        {!countdown.live ? <View style={styles.nextCount}><Text style={styles.nextCountText}>{countdown.label}</Text></View> : null}
      </Pressable>
    </Rise> : null}
  </View>;
}

// Even columns at least 260 wide, so a lone card in a month keeps the same
// size as the rest instead of stretching across the page.
const GRID_GAP = space(3);
const GRID_MIN = 260;
function Grid({ items, renderItem }) {
  const [width, setWidth] = useState(0);
  const columns = width ? Math.max(1, Math.floor((width + GRID_GAP) / (GRID_MIN + GRID_GAP))) : 0;
  const itemStyle = columns ? [styles.gridCell, { width: Math.floor((width - GRID_GAP * (columns - 1)) / columns) }] : styles.gridItem;
  return <View style={styles.grid} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {items.map((item) => renderItem(item, itemStyle))}
  </View>;
}

function BigStat({ value, label }) {
  return <View style={styles.bigStat}>
    <Text style={styles.bigStatValue}>{Number(value).toLocaleString("en-US")}</Text>
    <Text style={styles.bigStatLabel}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, gap: space(5) },
  detail: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 19 },
  marquee: { minHeight: 250, borderRadius: radius.lg, overflow: "hidden", flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: space(4), padding: space(5), backgroundColor: "#0B0A10" },
  marqueeNarrow: { minHeight: 0, padding: space(4), gap: space(3) },
  marqueeTitleNarrow: { fontSize: 36, lineHeight: 40 },
  marqueeBody: { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 0, gap: space(2) },
  marqueeKicker: { color: "rgba(255,255,255,0.86)", fontFamily: mono, fontSize: 12, fontWeight: "900", letterSpacing: 1.2 },
  marqueeTitle: { color: "#FFFFFF", fontFamily: displayFont, fontSize: 44, lineHeight: 48, fontWeight: "900", textShadowColor: "rgba(0,0,0,0.35)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 12 },
  marqueeCopy: { color: "rgba(255,255,255,0.9)", fontFamily: font, fontSize: 14.5, lineHeight: 21, maxWidth: 460 },
  marqueeStats: { flexDirection: "row", flexWrap: "wrap", gap: space(4), marginTop: space(2) },
  bigStat: { gap: 0 },
  bigStatValue: { color: "#FFFFFF", fontFamily: displayFont, fontSize: 28, lineHeight: 32, fontWeight: "900" },
  bigStatLabel: { color: "rgba(255,255,255,0.8)", fontFamily: font, fontSize: 12, fontWeight: "800" },
  nextWrap: { flexGrow: 1, flexBasis: 220, maxWidth: 340, minWidth: 0 },
  next: { gap: 3, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", backgroundColor: "rgba(8,8,12,0.55)", padding: space(4) },
  nextHover: { borderColor: "rgba(255,255,255,0.7)" },
  pressed: { opacity: 0.85 },
  nextKicker: { color: "rgba(255,255,255,0.78)", fontFamily: mono, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  nextName: { color: "#FFFFFF", fontFamily: displayFont, fontSize: 21, lineHeight: 25, fontWeight: "900" },
  nextWhen: { color: "#FFFFFF", fontFamily: font, fontSize: 13.5, fontWeight: "800" },
  nextWhere: { color: "rgba(255,255,255,0.78)", fontFamily: font, fontSize: 12.5 },
  nextCount: { alignSelf: "flex-start", marginTop: space(2), borderRadius: radius.pill, backgroundColor: "#FFFFFF", paddingHorizontal: 10, paddingVertical: 4 },
  nextCountText: { color: "#111114", fontFamily: font, fontSize: 12, fontWeight: "900" },
  monthChips: { gap: space(2), paddingVertical: 2 },
  monthChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 8 },
  monthChipOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  monthChipText: { color: colors.text, fontFamily: font, fontSize: 13, fontWeight: "800" },
  monthChipCount: { color: colors.textFaint, fontFamily: mono, fontSize: 11.5, fontWeight: "900" },
  monthChipTextOn: { color: colors.bg },
  section: { gap: space(3) },
  monthHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space(2) },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 20, fontWeight: "900" },
  monthCount: { color: colors.textFaint, fontFamily: font, fontSize: 12.5, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  gridItem: { flexGrow: 1, flexBasis: GRID_MIN, minWidth: 0, flexDirection: "row" },
  gridCell: { minWidth: 0, flexDirection: "row" },
  rail: { gap: space(3) },
  railItem: { width: 280, flexDirection: "row" },
  message: { alignItems: "center", gap: space(3), padding: space(5), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.surface },
  error: { color: colors.danger, fontFamily: font, fontSize: 13, textAlign: "center" },
});
