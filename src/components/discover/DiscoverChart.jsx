import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, font, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";
import { discoverSectionState, filterDiscoverRows } from "../../domain/discoverView.mjs";
import { SectionHeading } from "./DiscoverPrimitives";
import { DiscoverArtistGrid } from "./DiscoverArtistCard";

function SearchBox({ value, onChange }) {
  return (
    <View style={styles.searchBox}>
      <Icon name="search" size={18} color={colors.textDim} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder="Search artists, genres, or songs"
        placeholderTextColor={colors.textFaint}
        accessibilityLabel="Search this artist list"
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {!!value && <Pressable style={styles.clearSearch} onPress={() => onChange("")} accessibilityRole="button" accessibilityLabel="Clear artist search" hitSlop={8}><Icon name="x" size={15} color={colors.textDim} /></Pressable>}
    </View>
  );
}

function DiscoverChart({ rows, source, info, query, onQuery, onOpenArtist, compact }) {
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(() => filterDiscoverRows(rows, query), [rows, query]);
  const state = discoverSectionState({ status: "ready", rows: filtered, query });
  const limit = compact ? 8 : 12;
  const visible = query || expanded ? filtered : filtered.slice(0, limit);
  return (
    <View style={styles.panel}>
      <SectionHeading
        title={source === "plays" ? "What members are playing" : "Popular artists"}
        detail={source === "plays" ? "Most played by members" : "Based on current artist popularity"}
        action={info?.live ? <View style={styles.livePill} accessible accessibilityLabel={source === "plays" ? "Live member list" : "Current artist list"}><View style={styles.liveDot} /><Text style={styles.liveText}>{source === "plays" ? "LIVE" : "CURRENT"}</Text></View> : null}
      />
      <SearchBox value={query} onChange={onQuery} />
      {state === "no-results" ? (
        <View style={styles.inlineEmpty} accessibilityLiveRegion="polite">
          <Text style={styles.inlineEmptyTitle} selectable>No matches for “{query.trim()}”</Text>
          <Pressable style={styles.clearFilterButton} onPress={() => onQuery("")} accessibilityRole="button" accessibilityLabel="Clear artist search"><Text style={styles.textButton}>Clear search</Text></Pressable>
        </View>
      ) : state === "empty" ? (
        <View style={styles.inlineEmpty} accessibilityLiveRegion="polite">
          <Text style={styles.inlineEmptyTitle}>{source === "plays" ? "No member listening activity here yet." : "No popular artists are listed here yet."}</Text>
        </View>
      ) : (
        <DiscoverArtistGrid rows={visible} ranked={!query} onOpen={onOpenArtist} />
      )}
      {!query && filtered.length > limit && (
        <Pressable style={styles.expandButton} onPress={() => setExpanded((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={expanded ? "Show fewer artists" : `Show all ${filtered.length} artists`}>
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
  expandButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  expandText: { color: colors.amber, fontFamily: font, fontSize: 13, fontWeight: "900" },
});
