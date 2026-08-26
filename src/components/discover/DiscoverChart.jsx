import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, font, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";
import Avatar from "../Avatar";
import { proxied, isHttp } from "../../lib/img";
import { compactDiscoverNumber, discoverSectionState, filterDiscoverRows } from "../../domain/discoverView.mjs";
import { SectionHeading } from "./DiscoverPrimitives";
import { PublicPressableLink } from "../PublicWebLinks";
import { artistPath } from "../../domain/urls.mjs";

const initialsOf = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
const artistUser = (row) => ({ avatarUri: row?.photo && isHttp(row.photo) ? proxied(row.photo, 240) : row?.photo || null, initials: initialsOf(row?.name), avatarColor: colors.amber });

function SearchBox({ value, onChange }) {
  return (
    <View style={styles.searchBox}>
      <Icon name="search" size={18} color={colors.textDim} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder="Filter artists, genres, or songs"
        placeholderTextColor={colors.textFaint}
        accessibilityLabel="Filter the current Discover chart"
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {!!value && <Pressable style={styles.clearSearch} onPress={() => onChange("")} accessibilityRole="button" accessibilityLabel="Clear chart filter" hitSlop={8}><Icon name="x" size={15} color={colors.textDim} /></Pressable>}
    </View>
  );
}

function ChartMetric({ row, source }) {
  const value = source === "plays" ? row?.plays : row?.popularity ?? row?.followers ?? row?.rating;
  const label = source === "plays" ? "plays" : row?.popularity != null ? "pop" : row?.followers != null ? "fans" : row?.rating != null ? "rating" : "rank";
  const displayValue = source === "plays" && row?.playsApproximate
    ? `${compactDiscoverNumber(value)}+`
    : compactDiscoverNumber(value);
  return (
    <View style={styles.chartMetric} accessible accessibilityLabel={`${displayValue} ${label}`}>
      <Text style={styles.chartMetricValue}>{displayValue}</Text>
      <Text style={styles.chartMetricLabel}>{label}</Text>
    </View>
  );
}

function ArtistChartRow({ row, index, source, onOpen, onPlay, onAdd, narrow }) {
  const rank = Number(row?.rank) || index + 1;
  const topThree = rank <= 3;
  return (
    <View style={[styles.chartRow, narrow && styles.chartRowNarrow, index > 0 && styles.chartRowBorder, rank === 1 && styles.chartRowLead]}>
      <View style={[styles.rankBadge, topThree && styles.rankBadgeTop]}><Text style={[styles.rankText, topThree && styles.rankTextTop]}>{rank}</Text></View>
      <Avatar user={artistUser(row)} size={narrow ? 40 : rank === 1 ? 52 : 44} />
      <PublicPressableLink href={artistPath(row)} onNavigate={() => onOpen?.(row)} style={styles.chartRowMain} accessibilityLabel={`Open ${row.name}${row.genre ? `, ${row.genre}` : ""}`}>
        <Text style={[styles.chartArtist, rank === 1 && styles.chartArtistLead]} numberOfLines={1}>{row.name}</Text>
        <Text style={styles.chartMeta} numberOfLines={1}>{[row.genre || "Artist", row.topTrack?.title].filter(Boolean).join(" · ")}</Text>
      </PublicPressableLink>
      {!!row.topTrack && (
        <View style={styles.trackActions}>
          <Pressable style={styles.trackButton} onPress={() => onAdd?.(row)} accessibilityRole="button" accessibilityLabel={`Add ${row.topTrack.title} by ${row.name} to a playlist`} hitSlop={4}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>
          <Pressable style={[styles.trackButton, styles.playButton]} onPress={() => onPlay?.(row)} accessibilityRole="button" accessibilityLabel={`Play ${row.topTrack.title} by ${row.name}`} hitSlop={4}><Icon name="play" size={13} color={colors.amber} /></Pressable>
        </View>
      )}
      {!narrow && <ChartMetric row={row} source={source} />}
    </View>
  );
}

function DiscoverChart({ rows, source, info, query, onQuery, onOpenArtist, onPlay, onAdd, compact, narrow }) {
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(() => filterDiscoverRows(rows, query), [rows, query]);
  const state = discoverSectionState({ status: "ready", rows: filtered, query });
  const limit = compact ? 8 : 12;
  const visible = query || expanded ? filtered : filtered.slice(0, limit);
  return (
    <View style={styles.panel}>
      <SectionHeading
        eyebrow="LIVE CHART"
        title={source === "plays" ? "What Pit is playing" : "Artists moving now"}
        detail={info?.label || (source === "plays" ? "Most played by members" : "Catalog popularity")}
        action={info?.live ? <View style={styles.livePill} accessible accessibilityLabel={source === "plays" ? "Live member chart" : "Current catalog chart"}><View style={styles.liveDot} /><Text style={styles.liveText}>{source === "plays" ? "LIVE" : "CURRENT"}</Text></View> : null}
      />
      <SearchBox value={query} onChange={onQuery} />
      {state === "no-results" ? (
        <View style={styles.inlineEmpty} accessibilityLiveRegion="polite">
          <Text style={styles.inlineEmptyTitle} selectable>No matches for “{query.trim()}”</Text>
          <Pressable style={styles.clearFilterButton} onPress={() => onQuery("")} accessibilityRole="button" accessibilityLabel="Clear chart filter"><Text style={styles.textButton}>Clear filter</Text></Pressable>
        </View>
      ) : state === "empty" ? (
        <View style={styles.inlineEmpty} accessibilityLiveRegion="polite">
          <Text style={styles.inlineEmptyTitle}>{source === "plays" ? "No member plays are ranked in this scene yet." : "No artists are ranked in this scene yet."}</Text>
        </View>
      ) : (
        <View style={styles.chartList}>{visible.map((row, index) => <ArtistChartRow key={`${row.name}_${row.rank || index}`} row={row} index={index} source={source} onOpen={onOpenArtist} onPlay={onPlay} onAdd={onAdd} narrow={narrow} />)}</View>
      )}
      {!query && filtered.length > limit && (
        <Pressable style={styles.expandButton} onPress={() => setExpanded((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={expanded ? "Show fewer chart artists" : `Show all ${filtered.length} chart artists`}>
          <Text style={styles.expandText}>{expanded ? "Show fewer" : `Show all ${filtered.length}`}</Text>
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={15} color={colors.amber} />
        </Pressable>
      )}
    </View>
  );
}

export default memo(DiscoverChart);

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, padding: 18, gap: 14, ...shadow.card },
  livePill: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.good },
  liveText: { color: colors.textDim, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  searchBox: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontFamily: font, fontSize: 14, paddingVertical: 0 },
  clearSearch: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt },
  inlineEmpty: { minHeight: 130, alignItems: "center", justifyContent: "center", gap: 7 },
  inlineEmptyTitle: { color: colors.textDim, fontFamily: font, fontSize: 13.5, textAlign: "center" },
  clearFilterButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  textButton: { color: colors.amber, fontFamily: font, fontSize: 13, fontWeight: "900", paddingVertical: 8 },
  chartList: { borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  chartRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 11, paddingVertical: 8 },
  chartRowNarrow: { gap: 7, paddingHorizontal: 8 },
  chartRowBorder: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  chartRowLead: { minHeight: 78, backgroundColor: `${colors.gold}0B` },
  rankBadge: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  rankBadgeTop: { borderWidth: 1, borderColor: colors.gold, backgroundColor: `${colors.gold}14` },
  rankText: { color: colors.textFaint, fontFamily: mono, fontSize: 11.5, fontWeight: "900", fontVariant: ["tabular-nums"] },
  rankTextTop: { color: colors.gold },
  chartRowMain: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" },
  chartArtist: { color: colors.text, fontFamily: font, fontSize: 14, fontWeight: "800" },
  chartArtistLead: { fontSize: 16, fontWeight: "900" },
  chartMeta: { color: colors.textDim, fontFamily: font, fontSize: 11.5, paddingTop: 2 },
  trackActions: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 },
  trackButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  playButton: { borderColor: colors.amber, paddingLeft: 2 },
  chartMetric: { minWidth: 42, alignItems: "flex-end" },
  chartMetricValue: { color: colors.text, fontFamily: mono, fontSize: 13, fontWeight: "900", fontVariant: ["tabular-nums"] },
  chartMetricLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase", paddingTop: 1 },
  expandButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  expandText: { color: colors.amber, fontFamily: font, fontSize: 13, fontWeight: "900" },
});
