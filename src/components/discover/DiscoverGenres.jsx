import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { memo, useMemo } from "react";
import { colors, displayFont, font, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";
import Avatar from "../Avatar";
import SoundDonut, { DONUT_PALETTE } from "../SoundDonut";
import { proxied, isHttp } from "../../lib/img";
import { SectionHeading } from "./DiscoverPrimitives";
import { PublicPressableLink } from "../PublicWebLinks";
import { artistPath } from "../../domain/urls.mjs";
import { buildDiscoverArtistSpotlight, discoverGenreDistribution } from "../../domain/discoverView.mjs";

const initialsOf = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
const artistUser = (row) => ({ avatarUri: row?.photo && isHttp(row.photo) ? proxied(row.photo, 240) : row?.photo || null, initials: initialsOf(row?.name), avatarColor: colors.amber });

function GenreArtist({ row, index, onOpen, onPlay, onAdd }) {
  const detail = [row.discoveryReason, row.topTrack?.title].filter(Boolean).join(" · ") || row.genre || "Artist";
  return (
    <View style={[styles.artistRow, index > 0 && styles.artistBorder]}>
      <View style={styles.artistRank}><Text style={styles.artistRankText}>{index + 1}</Text></View>
      <Avatar user={artistUser(row)} size={42} />
      <PublicPressableLink href={artistPath(row)} onNavigate={() => onOpen?.(row)} style={styles.artistMain} accessibilityLabel={"Open " + row.name}>
        <Text style={styles.artistName} numberOfLines={1}>{row.name}</Text>
        <Text style={styles.artistDetail} numberOfLines={1}>{detail}</Text>
      </PublicPressableLink>
      {!!row.topTrack && (onAdd || onPlay) && (
        <View style={styles.trackActions}>
          {onAdd && <Pressable style={styles.trackButton} onPress={() => onAdd(row)} accessibilityRole="button" accessibilityLabel={"Add " + row.topTrack.title + " by " + row.name + " to a playlist"} hitSlop={4}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>}
          {onPlay && <Pressable style={[styles.trackButton, styles.playButton]} onPress={() => onPlay(row)} accessibilityRole="button" accessibilityLabel={"Play " + row.topTrack.title + " by " + row.name} hitSlop={4}><Icon name="play" size={12} color={colors.amber} /></Pressable>}
        </View>
      )}
    </View>
  );
}

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
  onPlay,
  onAdd,
  onRetry,
}) {
  const distribution = useMemo(() => discoverGenreDistribution(genres, total), [genres, total]);
  const selectableGenres = distribution.genres;
  const selectedData = selectableGenres.find((item) => item.genre === selected) || null;
  const verifiedTotal = distribution.verifiedTotal;
  const remainderCount = distribution.remainderCount;
  const chartData = selectableGenres.map((item, index) => ({
    label: item.genre,
    count: Number(item.count) || 0,
    color: DONUT_PALETTE[index % DONUT_PALETTE.length],
  })).concat(remainderCount ? [{
    label: "Other",
    count: remainderCount,
    color: DONUT_PALETTE[DONUT_PALETTE.length - 1],
  }] : []);
  const spotlight = useMemo(() => buildDiscoverArtistSpotlight({
    genreRows: rows,
    fallbackRows,
    attendanceRows,
    selectedGenre: selected,
    limit: 6,
  }), [attendanceRows, fallbackRows, rows, selected]);
  const hasGenres = chartData.length > 0;
  const loadingArtists = !!selected && (status === "idle" || status === "loading") && !rows?.length;
  const spotlightTitle = spotlight.recentCount
    ? "From shows you attended"
    : selected ? "Popular in " + selected : "Popular now";
  const spotlightDetail = spotlight.recentCount
    ? "Starts with artists from your recent shows, then adds popular artists."
    : selected ? "Popular artists in " + selected + "." : "Popular artists to start with.";

  return (
    <View style={styles.panel}>
      <SectionHeading
        eyebrow="BROWSE BY GENRE"
        title="Genres"
        detail={hasGenres
          ? verifiedTotal.toLocaleString() + " artists grouped by genre in " + region + "."
          : "Genre information for " + region + " is not ready yet. You can still browse artists below."}
      />

      <View style={[styles.experience, compact && styles.experienceCompact]}>
        <View style={[styles.mapCard, compact && styles.compactCard]}>
          <SoundDonut
            data={chartData}
            size={compact ? 164 : 184}
            selected={selected}
            centerTop={hasGenres ? String(selectableGenres.length) : "Not ready"}
            centerSub="genres"
          />

          {hasGenres ? (
            <View style={styles.legend} accessibilityLabel={"Genres in " + region}>
              {selectableGenres.map((item, index) => {
                const active = item.genre === selected;
                const tint = DONUT_PALETTE[index % DONUT_PALETTE.length];
                return (
                  <Pressable
                    key={item.genre}
                    style={[styles.legendItem, active && { borderColor: tint, backgroundColor: tint + "16" }]}
                    onPress={() => onSelect(item.genre)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={item.genre + ", " + item.count + " artists, " + Math.round(item.pct * 100) + " percent"}
                    accessibilityHint="Shows artists in this genre"
                  >
                    <View style={[styles.legendDot, { backgroundColor: tint }]} />
                    <View style={styles.legendCopy}>
                      <Text style={[styles.legendName, active && { color: tint }]} numberOfLines={1}>{item.genre}</Text>
                      <Text style={styles.legendValue}>{Math.round(item.pct * 100)}% · {Number(item.count || 0).toLocaleString()}</Text>
                    </View>
                    {active && <Icon name="check" size={13} color={tint} />}
                  </Pressable>
                );
              })}
              {!!remainderCount && (
                <View
                  style={[styles.legendItem, styles.legendItemMuted]}
                  accessible
                  accessibilityLabel={"Other genres, " + remainderCount + " artists, " + Math.round((remainderCount / verifiedTotal) * 100) + " percent"}
                >
                  <View style={[styles.legendDot, { backgroundColor: DONUT_PALETTE[DONUT_PALETTE.length - 1] }]} />
                  <View style={styles.legendCopy}>
                    <Text style={styles.legendName} numberOfLines={1}>Other genres</Text>
                    <Text style={styles.legendValue}>{Math.round((remainderCount / verifiedTotal) * 100)}% · {remainderCount.toLocaleString()}</Text>
                  </View>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.tuningState} accessible>
              <Icon name="music" size={18} color={colors.amber} />
              <View style={styles.tuningCopy}>
                <Text style={styles.tuningTitle}>Genre information is not ready</Text>
                <Text style={styles.tuningDetail}>Artists appear here once their genre is available. You can still browse recent and popular artists.</Text>
              </View>
            </View>
          )}
        </View>

        <View style={[styles.spotlightCard, compact && styles.compactCard]}>
          <View style={styles.spotlightHead}>
            <View style={styles.spotlightHeadCopy}>
              <Text style={styles.spotlightEyebrow}>{selectedData ? selectedData.genre.toUpperCase() + " ARTISTS" : "ARTISTS TO TRY"}</Text>
              <Text style={styles.spotlightTitle}>{spotlightTitle}</Text>
              <Text style={styles.spotlightDetail}>{spotlightDetail}</Text>
            </View>
            {!!spotlight.recentCount && <View style={styles.personalPill}><Text style={styles.personalPillText}>FROM YOUR SHOWS</Text></View>}
          </View>

          {loadingArtists ? (
            <View style={styles.genreLoading} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.amber} /><Text style={styles.stateCopy}>Loading artists...</Text></View>
          ) : status === "error" && selected ? (
            <View style={styles.genreLoading} accessibilityLiveRegion="assertive">
              <Text style={styles.emptyCopy} selectable>Could not load this genre right now.</Text>
              <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button" accessibilityLabel={"Retry loading " + selected}><Text style={styles.retryText}>Try again</Text></Pressable>
            </View>
          ) : spotlight.rows.length ? (
            <View style={styles.artistList}>
              {spotlight.rows.map((row, index) => <GenreArtist key={row.name + "_" + index} row={row} index={index} onOpen={onOpenArtist} onPlay={onPlay} onAdd={onAdd} />)}
            </View>
          ) : (
            <View style={styles.genreLoading}>
              <Text style={styles.emptyCopy}>More artist suggestions will appear as more information becomes available.</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

export default memo(DiscoverGenres);

const styles = StyleSheet.create({
  panel: { minWidth: 0, width: "100%", borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, padding: 18, gap: 14, overflow: "hidden", ...shadow.card },
  experience: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "stretch", gap: 12 },
  experienceCompact: { flexDirection: "column" },
  compactCard: { width: "100%", flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  mapCard: { flex: 0.9, minWidth: 0, padding: 14, alignItems: "center", gap: 13, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  legend: { width: "100%", minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  legendItem: { flexBasis: "47%", flexGrow: 1, minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, paddingVertical: 7, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  legendItemMuted: { opacity: 0.78 },
  legendDot: { width: 9, height: 28, borderRadius: 5, flexShrink: 0 },
  legendCopy: { flex: 1, minWidth: 0 },
  legendName: { color: colors.text, fontFamily: font, fontSize: 12, fontWeight: "900" },
  legendValue: { color: colors.textDim, fontFamily: mono, fontSize: 8.5, paddingTop: 3 },
  tuningState: { width: "100%", minHeight: 84, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber + "44", backgroundColor: colors.amber + "0D" },
  tuningCopy: { flex: 1, minWidth: 0 },
  tuningTitle: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "900" },
  tuningDetail: { color: colors.textDim, fontFamily: font, fontSize: 11, lineHeight: 16, paddingTop: 3 },
  spotlightCard: { flex: 1.15, minWidth: 0, padding: 14, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  spotlightHead: { minHeight: 70, flexDirection: "row", alignItems: "flex-start", gap: 10, paddingBottom: 10 },
  spotlightHeadCopy: { flex: 1, minWidth: 0 },
  spotlightEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  spotlightTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, lineHeight: 22, fontWeight: "900", paddingTop: 3 },
  spotlightDetail: { color: colors.textDim, fontFamily: font, fontSize: 11, lineHeight: 16, paddingTop: 3 },
  personalPill: { minHeight: 26, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.good + "18", borderWidth: 1, borderColor: colors.good + "55" },
  personalPillText: { color: colors.good, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  artistList: { borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  artistRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, paddingVertical: 7 },
  artistBorder: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  artistRank: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.amber + "12", borderWidth: 1, borderColor: colors.amber + "44" },
  artistRankText: { color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "900" },
  artistMain: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" },
  artistName: { color: colors.text, fontFamily: font, fontSize: 13.5, fontWeight: "900" },
  artistDetail: { color: colors.textDim, fontFamily: font, fontSize: 10.5, paddingTop: 2 },
  trackActions: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 },
  trackButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  playButton: { borderColor: colors.amber, paddingLeft: 2 },
  genreLoading: { minHeight: 160, alignItems: "center", justifyContent: "center", gap: 9 },
  stateCopy: { color: colors.textDim, fontFamily: font, fontSize: 12.5 },
  emptyCopy: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, textAlign: "center" },
  retryButton: { minHeight: 44, paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.amber, fontFamily: font, fontSize: 12.5, fontWeight: "900" },
});
