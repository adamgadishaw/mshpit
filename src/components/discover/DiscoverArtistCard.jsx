import { memo, useState } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";

import { colors, displayFont, font, radius } from "../../theme";
import { proxied, isHttp } from "../../lib/img";
import { artistInitials } from "../../domain/artistInitials.mjs";
import { discoverGenreLabel } from "../../domain/discoverView.mjs";
import { artistPath } from "../../domain/urls.mjs";
import { PublicPressableLink } from "../PublicWebLinks";

// A small, stable colour wash per artist so a missing photo still looks
// designed instead of empty. Hues stay muted to sit on the graphite theme.
const WASHES = ["#3B2A1E", "#1E2B3B", "#2F1E3B", "#1E3B2E", "#3B1E27", "#2B2F1E"];
const washFor = (name) => WASHES[[...String(name || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0) % WASHES.length];

function ArtistPhoto({ row, size }) {
  const [failed, setFailed] = useState(false);
  const uri = !failed && row?.photo ? (isHttp(row.photo) ? proxied(row.photo, size * 2) : row.photo) : null;
  if (uri) {
    return (
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk"
        recyclingKey={uri} accessible={false} onError={() => setFailed(true)} />
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, styles.wash, { backgroundColor: washFor(row?.name) }]}>
      <Text style={styles.washInitials} numberOfLines={1}>{artistInitials(row?.name)}</Text>
    </View>
  );
}

// Photo-first artist card for Discover grids.
export const DiscoverArtistCard = memo(function DiscoverArtistCard({ row, rank = null, detail = null, width, onOpen }) {
  const genre = discoverGenreLabel(row?.genre);
  const line = detail ?? [genre, row?.topTrack?.title].filter(Boolean).join(" · ");
  return (
    <PublicPressableLink href={artistPath(row)} onNavigate={() => onOpen?.(row)}
      style={({ hovered, pressed }) => [styles.card, { width }, hovered && styles.cardHover, pressed && styles.cardPressed]}
      accessibilityLabel={`Open ${row.name}${genre ? `, ${genre}` : ""}`}>
      <View style={styles.photo}>
        <ArtistPhoto row={row} size={Math.round(width)} />
        {rank != null ? <View style={styles.rank}><Text style={styles.rankText}>{rank}</Text></View> : null}
      </View>
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
        {line ? <Text style={styles.detail} numberOfLines={1}>{line}</Text> : null}
      </View>
    </PublicPressableLink>
  );
});

// Lays cards out in 2 to 4 columns depending on the space available.
export function DiscoverArtistGrid({ rows, ranked = false, detailFor = null, onOpen, maxColumns = 4 }) {
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const available = width || Math.min(windowWidth - 60, 900);
  const columns = Math.max(2, Math.min(maxColumns, Math.floor(available / 190) || 2));
  const gap = 12;
  const cardWidth = Math.floor((available - gap * (columns - 1)) / columns);
  return (
    <View style={styles.grid} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {rows.map((row, index) => (
        <DiscoverArtistCard key={`${row.name}_${index}`} row={row} rank={ranked ? Number(row?.rank) || index + 1 : null}
          detail={detailFor ? detailFor(row) : null} width={cardWidth} onOpen={onOpen} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: { borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "140ms", transitionProperty: "border-color, transform" }, default: {} }) },
  cardHover: { borderColor: colors.line, transform: [{ translateY: -2 }] },
  cardPressed: { opacity: 0.88 },
  photo: { width: "100%", aspectRatio: 1, backgroundColor: colors.surfaceAlt },
  wash: { alignItems: "center", justifyContent: "center" },
  washInitials: { color: "rgba(255,255,255,0.78)", fontFamily: displayFont, fontSize: 38, fontWeight: "800", letterSpacing: -1 },
  rank: { position: "absolute", top: 8, left: 8, minWidth: 26, height: 26, paddingHorizontal: 7, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(9,9,11,0.72)" },
  rankText: { color: colors.text, fontFamily: font, fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  copy: { paddingHorizontal: 11, paddingTop: 9, paddingBottom: 11, gap: 2 },
  name: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "800" },
  detail: { color: colors.textDim, fontFamily: font, fontSize: 12 },
});
