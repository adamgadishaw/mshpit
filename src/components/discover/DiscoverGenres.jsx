import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { memo } from "react";
import { colors, font, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";
import Avatar from "../Avatar";
import { proxied, isHttp } from "../../lib/img";
import { SectionHeading } from "./DiscoverPrimitives";

const GENRE_COLORS = [colors.amber, colors.cool, colors.magenta, colors.good, colors.gold, "#9B7BFF", "#4FD0E0", "#E8794B"];
const initialsOf = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
const artistUser = (row) => ({ avatarUri: row?.photo && isHttp(row.photo) ? proxied(row.photo, 240) : row?.photo || null, initials: initialsOf(row?.name), avatarColor: colors.amber });

function GenreArtist({ row, index, onOpen, onPlay, onAdd }) {
  return (
    <View style={[styles.genreArtistRow, index > 0 && styles.genreArtistBorder]}>
      <Text style={styles.genreRank}>{index + 1}</Text>
      <Avatar user={artistUser(row)} size={40} />
      <Pressable style={styles.genreArtistMain} onPress={() => onOpen?.(row.name)} accessibilityRole="button" accessibilityLabel={`Open ${row.name}`}>
        <Text style={styles.genreArtistName} numberOfLines={1}>{row.name}</Text>
        <Text style={styles.genreArtistTrack} numberOfLines={1}>{row.topTrack?.title || row.genre || "Artist"}</Text>
      </Pressable>
      {!!row.topTrack && (
        <View style={styles.trackActions}>
          <Pressable style={styles.trackButton} onPress={() => onAdd?.(row)} accessibilityRole="button" accessibilityLabel={`Add ${row.topTrack.title} by ${row.name} to a playlist`} hitSlop={4}><Icon name="plus" size={14} color={colors.textDim} /></Pressable>
          <Pressable style={[styles.trackButton, styles.playButton]} onPress={() => onPlay?.(row)} accessibilityRole="button" accessibilityLabel={`Play ${row.topTrack.title} by ${row.name}`} hitSlop={4}><Icon name="play" size={12} color={colors.amber} /></Pressable>
        </View>
      )}
    </View>
  );
}

function DiscoverGenres({ genres, selected, onSelect, total, rows, status, region, onOpenArtist, onPlay, onAdd, onRetry }) {
  const selectedData = genres.find((item) => item.genre === selected);
  const selectableGenres = genres.filter((item) => item.genre !== "Other");
  return (
    <View style={styles.panel}>
      <SectionHeading eyebrow="EXPLORE BY SOUND" title="Genres in this scene" detail={`${Number(total || 0).toLocaleString()} artists across ${region}`} />
      {selectableGenres.length ? <View style={styles.genreGrid} accessibilityRole="list" accessibilityLabel={`Genres in ${region}`}>
        {selectableGenres.map((item, index) => {
          const active = item.genre === selected;
          const tint = GENRE_COLORS[index % GENRE_COLORS.length];
          return (
            <Pressable
              key={item.genre}
              style={[styles.genreChip, active && { borderColor: tint, backgroundColor: `${tint}18` }]}
              onPress={() => onSelect(active ? null : item.genre)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${item.genre}, ${item.count} artists, ${Math.round(item.pct * 100)} percent`}
              accessibilityHint={active ? "Closes the ranked artist list" : "Loads ranked artists in this genre"}
            >
              <View style={[styles.genreSwatch, { backgroundColor: tint }]} />
              <View style={styles.genreChipCopy}>
                <Text style={[styles.genreName, active && { color: tint }]} numberOfLines={1}>{item.genre}</Text>
                <Text style={styles.genreCount}>{item.count.toLocaleString()} / {Math.round(item.pct * 100)}%</Text>
              </View>
              {active && <Icon name="check" size={15} color={tint} />}
            </Pressable>
          );
        })}
      </View> : <Text style={styles.genreEmpty}>A genre breakdown is not available for this scene yet.</Text>}
      {!!selected && (
        <View style={styles.genreDetail} accessibilityLiveRegion="polite">
          <View style={styles.genreDetailHead}>
              <View style={styles.genreDetailCopy}>
                <Text style={styles.genreDetailEyebrow} numberOfLines={2}>TOP IN {selected.toUpperCase()}</Text>
              <Text style={styles.genreDetailCount}>{selectedData?.count?.toLocaleString() || 0} artists in this view</Text>
            </View>
            <Pressable style={styles.closeGenre} onPress={() => onSelect(null)} accessibilityRole="button" accessibilityLabel={`Close ${selected} results`}><Icon name="x" size={15} color={colors.textDim} /></Pressable>
          </View>
          {status === "loading" ? (
            <View style={styles.genreLoading}><ActivityIndicator color={colors.amber} /><Text style={styles.stateCopy}>Loading top artists...</Text></View>
          ) : status === "error" ? (
            <View style={styles.genreLoading} accessibilityLiveRegion="assertive">
              <Text style={styles.genreEmpty} selectable>Could not load this genre right now.</Text>
              <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button" accessibilityLabel={`Retry loading ${selected}`}><Text style={styles.retryText}>Try again</Text></Pressable>
            </View>
          ) : rows.length ? (
            rows.slice(0, 8).map((row, index) => <GenreArtist key={row.name} row={row} index={index} onOpen={onOpenArtist} onPlay={onPlay} onAdd={onAdd} />)
          ) : (
            <Text style={styles.genreEmpty}>No ranked artists are available for this genre and region yet.</Text>
          )}
        </View>
      )}
    </View>
  );
}

export default memo(DiscoverGenres);

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, padding: 18, gap: 14, ...shadow.card },
  genreGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  genreChip: { flexBasis: "48%", flexGrow: 1, minWidth: 140, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 11, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  genreSwatch: { width: 10, height: 30, borderRadius: 5, flexShrink: 0 },
  genreChipCopy: { flex: 1, minWidth: 0 },
  genreName: { color: colors.text, fontFamily: font, fontSize: 13, fontWeight: "900" },
  genreCount: { color: colors.textDim, fontFamily: mono, fontSize: 9.5, paddingTop: 3 },
  genreDetail: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 14 },
  genreDetailHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 8 },
  genreDetailCopy: { flex: 1, minWidth: 0 },
  genreDetailEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  genreDetailCount: { color: colors.textDim, fontFamily: font, fontSize: 11.5, paddingTop: 3 },
  closeGenre: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev },
  genreLoading: { minHeight: 100, alignItems: "center", justifyContent: "center", gap: 8 },
  stateCopy: { color: colors.textDim, fontFamily: font, fontSize: 12.5 },
  genreEmpty: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, paddingVertical: 22, textAlign: "center" },
  retryButton: { minHeight: 44, paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.amber, fontFamily: font, fontSize: 12.5, fontWeight: "900" },
  genreArtistRow: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  genreArtistBorder: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  genreRank: { width: 22, color: colors.textFaint, fontFamily: mono, fontSize: 11, fontWeight: "900", textAlign: "center" },
  genreArtistMain: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" },
  genreArtistName: { color: colors.text, fontFamily: font, fontSize: 13.5, fontWeight: "800" },
  genreArtistTrack: { color: colors.textDim, fontFamily: font, fontSize: 11, paddingTop: 2 },
  trackActions: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 },
  trackButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  playButton: { borderColor: colors.amber, paddingLeft: 2 },
});
