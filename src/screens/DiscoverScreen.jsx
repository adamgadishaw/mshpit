import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import Badge from "../components/Badge";
import { proxied, isHttp } from "../lib/img";

// Distinct hues for the genre pie — theme accents first (adapt per preset), then
// a couple of fixed extras for variety.
const PALETTE = [colors.amber, colors.cool, colors.magenta, colors.good, colors.gold, "#9B7BFF", "#4FD0E0", "#E8794B"];
const initialsOf = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const artistUser = (name, photo) => ({ avatarUri: photo && isHttp(photo) ? proxied(photo, 220) : photo || null, initials: initialsOf(name), avatarColor: colors.amber });

// A drawn donut of genre share. No chart lib — react-native-svg arcs, one ring.
function GenreDonut({ data, size = 168 }) {
  const cx = size / 2, cy = size / 2, W = Math.round(size * 0.17), r = (size - W) / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;
  const segs = data.map((d, i) => {
    const len = Math.max(0, d.pct) * C;
    const seg = { color: PALETTE[i % PALETTE.length], len, offset: -acc * C };
    acc += d.pct;
    return seg;
  });
  const lead = data[0];
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} stroke={colors.lineSoft} strokeWidth={W} fill="none" />
        <G originX={cx} originY={cy} rotation={-90}>
          {segs.map((s, i) => (
            <Circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              stroke={s.color}
              strokeWidth={W}
              fill="none"
              strokeDasharray={[s.len, C - s.len]}
              strokeDashoffset={s.offset}
              strokeLinecap="butt"
            />
          ))}
        </G>
      </Svg>
      <View style={styles.donutCenter} pointerEvents="none">
        <Text style={styles.donutPct}>{lead ? Math.round(lead.pct * 100) : 0}%</Text>
        <Text style={styles.donutLead} numberOfLines={1}>{lead ? lead.genre : "—"}</Text>
      </View>
    </View>
  );
}

// One podium plinth (rank 1/2/3).
function Plinth({ row, rank, onPress }) {
  const h = rank === 1 ? 78 : rank === 2 ? 54 : 40;
  const size = rank === 1 ? 74 : 58;
  return (
    <Pressable style={styles.plinthCol} onPress={onPress}>
      <View style={styles.plinthAvatar}>
        <Avatar user={artistUser(row.name, row.photo)} size={size} />
        <View style={styles.plinthBadge}><Badge type={`rank${rank}`} size={rank === 1 ? 28 : 22} /></View>
      </View>
      <Text style={[styles.plinthName, rank === 1 && styles.plinthName1]} numberOfLines={1}>{row.name}</Text>
      {!!row.genre && <Text style={styles.plinthGenre} numberOfLines={1}>{row.genre}</Text>}
      <View style={[styles.plinthBlock, { height: h }, rank === 1 && styles.plinthBlock1]}>
        <Text style={[styles.plinthRank, rank === 1 && styles.plinthRank1]}>{rank}</Text>
      </View>
    </Pressable>
  );
}

export default function DiscoverScreen({ onOpenTopRated, onOpenArtist, onOpenNearby, onOpenFanClubs, onOpenVenues, onOpenPhotos }) {
  const { chartTop, chartInfo, catalogCountries, topGenres, topPhotos, discoverStats } = useStore();

  const chart = useMemo(() => chartTop(10), []);
  const info = useMemo(() => chartInfo(), []);
  const stats = useMemo(() => discoverStats(), []);
  const countries = useMemo(() => [{ country: "Worldwide", count: stats.artists }, ...catalogCountries(14)].slice(0, 9), []);
  const [region, setRegion] = useState("Worldwide");
  const genres = useMemo(() => topGenres(region === "Worldwide" ? null : region, 6), [region]);
  const photos = useMemo(() => topPhotos(12), []);

  const podium = chart.slice(0, 3);
  const rest = chart.slice(3);
  const photoUris = photos.map((p) => p.uri);

  const STAT_TILES = [
    { k: "artists", label: "ARTISTS", icon: "music", tint: colors.amber },
    { k: "venues", label: "VENUES", icon: "pin", tint: colors.cool },
    { k: "countries", label: "COUNTRIES", icon: "globe", tint: colors.good },
    { k: "genres", label: "GENRES", icon: "discover", tint: colors.magenta },
  ];

  const HUBS = [
    { icon: "trophy", tint: colors.gold, title: "Best rated", onPress: onOpenTopRated },
    { icon: "pin", tint: colors.amber, title: "Near you", onPress: onOpenNearby },
    { icon: "comment", tint: colors.magenta, title: "Fan clubs", onPress: onOpenFanClubs },
    { icon: "search", tint: colors.cool, title: "Find venues", onPress: onOpenVenues },
  ].filter((h) => h.onPress);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>MUSIC INTELLIGENCE</Text>
      <Text style={styles.title}>Discover</Text>

      {/* KPI tiles — the data-center vitals */}
      <View style={styles.tiles}>
        {STAT_TILES.map((t) => (
          <View key={t.k} style={styles.tile}>
            <View style={[styles.tileIcon, { borderColor: t.tint }]}><Icon name={t.icon} size={14} color={t.tint} /></View>
            <Text style={styles.tileNum}>{(stats[t.k] || 0).toLocaleString()}</Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      {/* Chart podium — top 3 */}
      {podium.length === 3 && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>THE CHART · TOP 3</Text>
            <View style={styles.sourcePill}>
              <View style={[styles.dotLive, { backgroundColor: info.live ? colors.good : colors.textFaint }]} />
              <Text style={styles.sourceTxt}>{info.label}</Text>
            </View>
          </View>
          <View style={styles.podium}>
            <Plinth row={podium[1]} rank={2} onPress={() => onOpenArtist?.(podium[1].name)} />
            <Plinth row={podium[0]} rank={1} onPress={() => onOpenArtist?.(podium[0].name)} />
            <Plinth row={podium[2]} rank={3} onPress={() => onOpenArtist?.(podium[2].name)} />
          </View>
          {rest.length > 0 && (
            <View style={styles.rankList}>
              {rest.map((r) => (
                <Pressable key={r.name} style={styles.rankRow} onPress={() => onOpenArtist?.(r.name)}>
                  <Text style={styles.rankNum}>{r.rank}</Text>
                  <Avatar user={artistUser(r.name, r.photo)} size={26} />
                  <Text style={styles.rankName} numberOfLines={1}>{r.name}</Text>
                  <Text style={styles.rankGenre} numberOfLines={1}>{r.genre || ""}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Genre share by region — the pies */}
      {genres.length > 0 && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>TOP GENRES BY REGION</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionRow}>
            {countries.map((c) => {
              const on = c.country === region;
              return (
                <Pressable key={c.country} style={[styles.regionChip, on && styles.regionChipOn]} onPress={() => setRegion(c.country)}>
                  <Text style={[styles.regionTxt, on && styles.regionTxtOn]} numberOfLines={1}>{c.country}</Text>
                  <Text style={[styles.regionCount, on && styles.regionTxtOn]}>{c.count}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.chartRow}>
            <GenreDonut data={genres} />
            <View style={styles.legend}>
              {genres.map((g, i) => (
                <View key={g.genre} style={styles.legendRow}>
                  <View style={[styles.swatch, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
                  <Text style={styles.legendName} numberOfLines={1}>{g.genre}</Text>
                  <Text style={styles.legendPct}>{Math.round(g.pct * 100)}%</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* Top uploaded photos */}
      {photos.length > 0 && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>TOP PHOTOS</Text>
            <Text style={styles.panelSub}>Most-liked from the community</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {photos.map((p, i) => (
              <Pressable key={p.logId + "_" + i} style={styles.photoTile} onPress={() => onOpenPhotos?.(photoUris, i)}>
                <Image source={{ uri: isHttp(p.uri) ? proxied(p.uri, 320) : p.uri }} style={styles.photoImg} resizeMode="cover" />
                <View style={styles.photoMeta}>
                  <Text style={styles.photoArtist} numberOfLines={1}>{p.artist}</Text>
                  {p.likes > 0 && (
                    <View style={styles.photoLikes}><Icon name="heart" size={11} color={colors.magenta} filled /><Text style={styles.photoLikesTxt}>{p.likes}</Text></View>
                  )}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Explore shortcuts */}
      <Text style={styles.sectionLabel}>EXPLORE</Text>
      <View style={styles.hubRow}>
        {HUBS.map((h) => (
          <Pressable key={h.title} style={styles.hub} onPress={h.onPress}>
            <View style={[styles.hubIcon, { borderColor: h.tint }]}><Icon name={h.icon} size={16} color={h.tint} /></View>
            <Text style={styles.hubTitle}>{h.title}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 44 },
  kicker: { color: colors.amber, fontSize: 11, letterSpacing: 2, fontWeight: "800", fontFamily: mono },
  title: { color: colors.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.5, marginTop: 4 },

  tiles: { flexDirection: "row", gap: 8, marginTop: 16 },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: 12, paddingHorizontal: 8, alignItems: "flex-start", ...shadow.card },
  tileIcon: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  tileNum: { color: colors.text, fontSize: 20, fontWeight: "900", fontFamily: mono },
  tileLabel: { color: colors.textFaint, fontSize: 9, letterSpacing: 1, fontWeight: "800", marginTop: 2 },

  panel: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.lineSoft, padding: 16, marginTop: 16, ...shadow.card },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  panelTitle: { color: colors.text, fontSize: 12.5, letterSpacing: 1.5, fontWeight: "800" },
  panelSub: { color: colors.textDim, fontSize: 11 },
  sourcePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.bgElev, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  dotLive: { width: 7, height: 7, borderRadius: 4 },
  sourceTxt: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },

  podium: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 8 },
  plinthCol: { flex: 1, alignItems: "center", maxWidth: 130 },
  plinthAvatar: { position: "relative" },
  plinthBadge: { position: "absolute", bottom: -4, right: -6 },
  plinthName: { color: colors.text, fontSize: 12.5, fontWeight: "800", marginTop: 10, textAlign: "center" },
  plinthName1: { fontSize: 14 },
  plinthGenre: { color: colors.textDim, fontSize: 10, marginTop: 1, textAlign: "center" },
  plinthBlock: { alignSelf: "stretch", marginTop: 8, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderBottomWidth: 0, alignItems: "center", justifyContent: "center" },
  plinthBlock1: { backgroundColor: colors.surfaceAlt, borderColor: colors.gold },
  plinthRank: { color: colors.textDim, fontFamily: mono, fontSize: 22, fontWeight: "900" },
  plinthRank1: { color: colors.gold, fontSize: 28 },

  rankList: { marginTop: 16, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 6 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  rankNum: { color: colors.textFaint, fontFamily: mono, fontSize: 12, fontWeight: "800", width: 20 },
  rankName: { color: colors.text, fontSize: 13.5, fontWeight: "700", flex: 1 },
  rankGenre: { color: colors.textDim, fontSize: 11 },

  regionRow: { flexDirection: "row", gap: 8, paddingBottom: 12 },
  regionChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.bgElev, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 7 },
  regionChipOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  regionTxt: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  regionTxtOn: { color: "#1A1206" },
  regionCount: { color: colors.textFaint, fontSize: 10, fontFamily: mono, fontWeight: "800" },

  chartRow: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "center" },
  donutCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  donutPct: { color: colors.text, fontSize: 26, fontWeight: "900", fontFamily: mono },
  donutLead: { color: colors.textDim, fontSize: 11, fontWeight: "700", marginTop: -2, maxWidth: 90, textAlign: "center" },
  legend: { flex: 1, minWidth: 150, gap: 8 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendName: { color: colors.text, fontSize: 12.5, fontWeight: "600", flex: 1 },
  legendPct: { color: colors.textDim, fontSize: 12, fontFamily: mono, fontWeight: "800" },

  photoRow: { flexDirection: "row", gap: 10, paddingBottom: 4 },
  photoTile: { width: 150, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  photoImg: { width: "100%", height: 150 },
  photoMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 8 },
  photoArtist: { color: colors.text, fontSize: 12, fontWeight: "700", flex: 1 },
  photoLikes: { flexDirection: "row", alignItems: "center", gap: 3 },
  photoLikesTxt: { color: colors.textDim, fontSize: 11, fontWeight: "700", fontFamily: mono },

  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginTop: 24, marginBottom: 10 },
  hubRow: { flexDirection: "row", gap: 8 },
  hub: { flex: 1, alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: 14 },
  hubIcon: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  hubTitle: { color: colors.text, fontSize: 11.5, fontWeight: "700" },
});
