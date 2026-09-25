import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { memo, useMemo } from "react";
import { colors, displayFont, font, radius, shadow } from "../../theme";
import Icon from "../Icon";
import { SectionHeading } from "./DiscoverPrimitives";
import { DiscoverArtistGrid } from "./DiscoverArtistCard";
import { buildDiscoverArtistSpotlight, discoverGenreDistribution, discoverGenreLabel, rankDiscoverGenres } from "../../domain/discoverView.mjs";

const liveRatingLine = (row) => {
  const ratingCount = Math.max(0, Number(row?.ratingCount) || 0);
  const reviewCount = Math.max(0, Number(row?.reviewCount) || 0);
  const liveRating = Number(row?.avgRating);
  return ratingCount && Number.isFinite(liveRating)
    ? `${liveRating.toFixed(1)}/5 live · ${ratingCount} rating${ratingCount === 1 ? "" : "s"}${reviewCount ? ` · ${reviewCount} written` : ""}`
    : null;
};

function GenreArtistGroup({ title, detail, rows, empty, ranked = false, detailFor = null, onOpenArtist }) {
  return (
    <View style={styles.artistGroup}>
      <Text style={styles.groupTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.groupDetail}>{detail}</Text>
      {rows.length
        ? <DiscoverArtistGrid rows={rows} ranked={ranked} detailFor={detailFor} onOpen={onOpenArtist} />
        : <Text style={styles.groupEmpty}>{empty}</Text>}
    </View>
  );
}

// Genres as one scrollable row of chips, most popular first, with the chosen
// genre's artists shown as photo cards below. No chart: a ring where "other"
// is most of the circle says nothing useful.
function DiscoverGenres({
  genres,
  selected,
  onSelect,
  total,
  rows,
  fallbackRows,
  attendanceRows,
  status,
  region,
  compact,
  onOpenArtist,
  onRetry,
}) {
  const distribution = useMemo(() => discoverGenreDistribution(rankDiscoverGenres(genres, fallbackRows), total, { limit: 12 }), [fallbackRows, genres, total]);
  const selectableGenres = distribution.genres;
  const verifiedTotal = distribution.verifiedTotal;
  const spotlight = useMemo(() => buildDiscoverArtistSpotlight({
    genreRows: rows,
    fallbackRows,
    attendanceRows,
    selectedGenre: selected,
    limit: 8,
  }), [attendanceRows, fallbackRows, rows, selected]);
  const reviewedRows = useMemo(() => (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.rankingGroup === "top-reviewed"), [rows]);
  const popularRows = useMemo(() => (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.rankingGroup === "popular"), [rows]);
  const hasRankedGenreRows = !!selected && (reviewedRows.length > 0 || popularRows.length > 0);
  const hasGenres = selectableGenres.length > 0;
  const selectedLabel = discoverGenreLabel(selected);
  const loadingArtists = !!selected && (status === "idle" || status === "loading") && !rows?.length;
  const spotlightTitle = spotlight.recentCount
    ? "From shows you attended"
    : selected ? "Popular in " + selectedLabel : "Popular now";

  return (
    <View style={styles.panel}>
      <SectionHeading
        title="Genres"
        detail={hasGenres
          ? verifiedTotal.toLocaleString() + " artists by genre in " + region + "."
          : "Genre information for " + region + " is not ready yet. You can still browse artists below."}
      />

      {hasGenres ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}
          accessibilityRole="radiogroup" accessibilityLabel={"Genres in " + region}>
          {selectableGenres.map((item) => {
            const active = item.genre === selected;
            return (
              <Pressable
                key={item.genre}
                style={({ hovered }) => [styles.chip, hovered && !active && styles.chipHover, active && styles.chipOn]}
                onPress={() => onSelect(item.genre)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={discoverGenreLabel(item.genre) + ", " + item.count + " artists"}
                accessibilityHint="Shows artists in this genre"
              >
                <Text style={[styles.chipName, active && styles.chipNameOn]} numberOfLines={1}>{discoverGenreLabel(item.genre)}</Text>
                <Text style={[styles.chipCount, active && styles.chipCountOn]}>{Number(item.count || 0).toLocaleString()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.tuningState} accessible>
          <Icon name="music" size={18} color={colors.amber} />
          <View style={styles.tuningCopy}>
            <Text style={styles.tuningTitle}>Genre information is not ready</Text>
            <Text style={styles.tuningDetail}>Artists appear here once their genre is available. You can still browse recent and popular artists.</Text>
          </View>
        </View>
      )}

      {loadingArtists ? (
        <View style={styles.genreLoading} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.amber} /><Text style={styles.stateCopy}>Loading artists...</Text></View>
      ) : status === "error" && selected ? (
        <View style={styles.genreLoading} accessibilityLiveRegion="assertive">
          <Text style={styles.emptyCopy} selectable>Could not load this genre right now.</Text>
          <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button" accessibilityLabel={"Retry loading " + selectedLabel}><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      ) : hasRankedGenreRows ? (
        <View style={styles.rankedGroups}>
          {reviewedRows.length ? (
            <GenreArtistGroup
              title="Top rated live"
              detail="Ranked with real Mshpit ratings and sample size, so one perfect score does not automatically win."
              rows={reviewedRows}
              ranked
              detailFor={liveRatingLine}
              empty={`No ${selectedLabel} artist has a qualifying live rating yet.`}
              onOpenArtist={onOpenArtist}
            />
          ) : null}
          <GenreArtistGroup
            title={`Popular in ${selectedLabel}`}
            detail="Popular catalog artists with a verified genre."
            rows={popularRows}
            empty={`No additional popular ${selectedLabel} artists are available yet.`}
            onOpenArtist={onOpenArtist}
          />
        </View>
      ) : spotlight.rows.length ? (
        <GenreArtistGroup
          title={spotlightTitle}
          detail={spotlight.recentCount ? "Starts with artists from your recent shows, then adds popular artists." : "Popular artists to start with."}
          rows={spotlight.rows}
          empty=""
          onOpenArtist={onOpenArtist}
        />
      ) : (
        <View style={styles.genreLoading}>
          <Text style={styles.emptyCopy}>More artist suggestions will appear as more information becomes available.</Text>
        </View>
      )}
    </View>
  );
}

export default memo(DiscoverGenres);

const styles = StyleSheet.create({
  panel: { minWidth: 0, width: "100%", borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, padding: 18, gap: 16, overflow: "hidden", ...shadow.card },
  chips: { gap: 8, paddingVertical: 2, paddingRight: 18 },
  chip: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "140ms", transitionProperty: "background-color, border-color" } }) },
  chipHover: { borderColor: colors.textFaint },
  chipOn: { backgroundColor: colors.surfaceAlt, borderColor: colors.amber },
  chipName: { color: colors.textDim, fontFamily: font, fontSize: 13.5, fontWeight: "700" },
  chipNameOn: { color: colors.text },
  chipCount: { color: colors.textFaint, fontFamily: font, fontSize: 12, fontVariant: ["tabular-nums"] },
  chipCountOn: { color: colors.amber },
  tuningState: { width: "100%", minHeight: 84, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber + "44", backgroundColor: colors.amber + "0D" },
  tuningCopy: { flex: 1, minWidth: 0 },
  tuningTitle: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "900" },
  tuningDetail: { color: colors.textDim, fontFamily: font, fontSize: 11, lineHeight: 16, paddingTop: 3 },
  rankedGroups: { gap: 22 },
  artistGroup: { gap: 8 },
  groupTitle: { color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "800" },
  groupDetail: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, marginBottom: 4 },
  groupEmpty: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  genreLoading: { minHeight: 160, alignItems: "center", justifyContent: "center", gap: 9 },
  stateCopy: { color: colors.textDim, fontFamily: font, fontSize: 12.5 },
  emptyCopy: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, textAlign: "center" },
  retryButton: { minHeight: 44, paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.amber, fontFamily: font, fontSize: 12.5, fontWeight: "900" },
});
