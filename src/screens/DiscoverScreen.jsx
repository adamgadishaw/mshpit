import { useMemo, useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Platform } from "react-native";
import Svg, { Path, Circle, Defs, RadialGradient, Stop, Ellipse } from "react-native-svg";
import { colors, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import { countryForCity } from "../geo";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import Badge from "../components/Badge";
import { proxied, isHttp } from "../lib/img";

// Distinct hues for the genre pie, theme accents first (adapt per preset), then
// a couple of fixed extras.
const PALETTE = [colors.amber, colors.cool, colors.magenta, colors.good, colors.gold, "#9B7BFF", "#4FD0E0", "#E8794B"];
const RING = { 1: colors.gold, 2: "#C7CDD6", 3: "#D08A55" };
const initialsOf = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const artistUser = (name, photo) => ({ avatarUri: photo && isHttp(photo) ? proxied(photo, 240) : photo || null, initials: initialsOf(name), avatarColor: colors.amber });
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));
const metricOf = (r) => (r.popularity != null ? `POP ${r.popularity}` : r.followers != null ? `${fmt(r.followers)} fans` : r.rating != null ? `★ ${r.rating.toFixed(1)}` : r.genre || "");
// Soft glow behind the #1 avatar (web only, RN shadows don't tint on native).
const glow = (color, on) => (on && Platform.OS === "web" ? { boxShadow: `0 0 26px ${color}66, 0 6px 18px rgba(0,0,0,0.5)` } : null);

// A drawn donut of genre share, filled wedges (crisp, reliable on web) with a
// gap stroke in the panel colour so slices read as separate.
function GenreDonut({ data, size = 188, centerTop, centerSub }) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 3, r = R * 0.62;
  const pt = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
  let a0 = -Math.PI / 2;
  const wedges = data.map((d, i) => {
    const frac = Math.min(0.9999, Math.max(0.0001, d.pct));
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
    const d1 = `M${x0} ${y0}A${R} ${R} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${large} 0 ${x3} ${y3}Z`;
    a0 = a1;
    return { d: d1, color: PALETTE[i % PALETTE.length] };
  });
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {data.length === 1 ? (
          <Circle cx={cx} cy={cy} r={(R + r) / 2} stroke={PALETTE[0]} strokeWidth={R - r} fill="none" />
        ) : (
          wedges.map((w, i) => <Path key={i} d={w.d} fill={w.color} stroke={colors.surface} strokeWidth={2} strokeLinejoin="round" />)
        )}
      </Svg>
      <View style={styles.donutCenter} pointerEvents="none">
        <Text style={styles.donutNum}>{centerTop}</Text>
        <Text style={styles.donutSub}>{centerSub}</Text>
      </View>
    </View>
  );
}

// One podium plinth (rank 1/2/3). The step blocks sit flush at the bottom to form
// a single connected podium; the avatar + medal float above it.
function Plinth({ row, rank, onPress }) {
  const first = rank === 1;
  const h = first ? 92 : rank === 2 ? 60 : 44;
  const size = first ? 100 : 76;
  const ring = RING[rank];
  return (
    <Pressable style={[styles.plinthCol, first && styles.plinthCol1]} onPress={onPress}>
      <View style={[styles.avatarRing, { width: size + 6, height: size + 6, borderColor: ring }, glow(ring, first)]}>
        <Avatar user={artistUser(row.name, row.photo)} size={size} />
        <View style={styles.plinthMedal}><Badge type={`rank${rank}`} size={first ? 32 : 24} /></View>
      </View>
      <Text style={[styles.plinthName, first && styles.plinthName1]} numberOfLines={1}>{row.name}</Text>
      {!!row.genre && <Text style={styles.plinthGenre} numberOfLines={1}>{row.genre}</Text>}
      <View style={[styles.block, { height: h }, first && styles.block1]}>
        <Text style={[styles.blockRank, { color: ring }, first && styles.blockRank1]}>{rank}</Text>
      </View>
    </Pressable>
  );
}

export default function DiscoverScreen({ onOpenTopRated, onOpenArtist, onOpenNearby, onOpenFanClubs, onOpenVenues, onOpenPhotos, onPlay }) {
  const { session, chartTop, chartInfo, catalogCountries, topGenres, topPhotos, discoverStats, loadMembers, memberCount, topArtistsBy, topSongsBy, resolveSpotifyTrack } = useStore();
  useEffect(() => { loadMembers(); }, []); // pull the live member count + directory

  const chart = useMemo(() => chartTop(10), []);
  const info = useMemo(() => chartInfo(), []);
  const stats = useMemo(() => discoverStats(), []);
  // Default the genre pie to the signed-in user's OWN country (Toronto → Canada),
  // not a global/US default. Their country leads the chip row.
  const homeCountry = countryForCity(session?.home?.city);
  const countries = useMemo(() => {
    const all = catalogCountries(1);
    const homeEntry = all.find((c) => c.country === homeCountry);
    const top = catalogCountries(14);
    const ordered = [{ country: "Worldwide", count: stats.artists }];
    if (homeEntry) ordered.push(homeEntry);
    top.forEach((c) => c.country !== homeCountry && ordered.push(c));
    const seen = new Set();
    return ordered.filter((c) => !seen.has(c.country) && seen.add(c.country)).slice(0, 10);
  }, [homeCountry]);

  const [region, setRegion] = useState("Worldwide");
  const touched = useRef(false);
  // Once we know the user's country (session may hydrate async), snap to it -
  // unless they've already picked a region themselves.
  useEffect(() => {
    if (touched.current || !homeCountry) return;
    if (countries.some((c) => c.country === homeCountry)) setRegion(homeCountry);
  }, [homeCountry, countries]);
  const pickRegion = (c) => { touched.current = true; setRegion(c); };

  const genres = useMemo(() => topGenres(region === "Worldwide" ? null : region, 6), [region]);
  const photos = useMemo(() => topPhotos(12), []);

  // Explore-by-genre: pick a genre (in the current region) to see its top artists
  // and songs, so you can dig past the global top 100.
  const [genre, setGenre] = useState(null);
  const country = region === "Worldwide" ? null : region;
  const genreChips = useMemo(() => topGenres(country, 12).filter((g) => g.genre !== "Other"), [region]);
  const genreArtists = useMemo(() => (genre ? topArtistsBy({ genre, country, n: 12 }) : []), [genre, region]);
  const genreSongs = useMemo(() => (genre ? topSongsBy({ genre, country, n: 10 }) : []), [genre, region]);
  const playSong = async (s) => {
    const url = s.url || (await resolveSpotifyTrack(s.title, s.artist));
    if (url) onPlay?.({ kind: "track", url, title: s.title, artist: s.artist, art: s.art }, null);
  };
  // Default to the region's top genre so the section always shows something; keep
  // the picked genre across region changes when it still exists there.
  useEffect(() => { if (genreChips.length && !genreChips.some((g) => g.genre === genre)) setGenre(genreChips[0].genre); }, [genreChips]);

  const podium = chart.slice(0, 3);
  const rest = chart.slice(3);
  const photoUris = photos.map((p) => p.uri);
  const regionCount = countries.find((c) => c.country === region)?.count || 0;
  const regionGenreCount = genres.length;

  const STAT_TILES = [
    { k: "members", label: "MEMBERS", icon: "you", tint: colors.gold },
    { k: "artists", label: "ARTISTS", icon: "music", tint: colors.amber },
    { k: "venues", label: "VENUES", icon: "pin", tint: colors.cool },
    { k: "genres", label: "GENRES", icon: "discover", tint: colors.magenta },
  ];

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>MUSIC INTELLIGENCE</Text>
      <Text style={styles.title}>Discover</Text>
      <Text style={styles.tagline}>The live-music charts, mapped.</Text>

      <View style={styles.tiles}>
        {STAT_TILES.map((t) => (
          <View key={t.k} style={styles.tile}>
            <View style={[styles.tileIcon, { borderColor: t.tint }]}><Icon name={t.icon} size={15} color={t.tint} /></View>
            <Text style={styles.tileNum}>{(stats[t.k] || 0).toLocaleString()}</Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      {/* Chart podium, the hero */}
      {podium.length === 3 && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>THE CHART</Text>
            <View style={styles.sourcePill}>
              <View style={[styles.dotLive, { backgroundColor: info.live ? colors.good : colors.gold }]} />
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
                  <Avatar user={artistUser(r.name, r.photo)} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rankName} numberOfLines={1}>{r.name}</Text>
                    {!!r.genre && <Text style={styles.rankGenre} numberOfLines={1}>{r.genre}</Text>}
                  </View>
                  <Text style={styles.rankMetric} numberOfLines={1}>{metricOf(r)}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Genre share by region */}
      {genres.length > 0 && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>GENRE SHARE</Text>
            <Text style={styles.panelSub}>{regionGenreCount} genres tracked</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionRow}>
            {countries.map((c) => {
              const on = c.country === region;
              return (
                <Pressable key={c.country} style={[styles.regionChip, on && styles.regionChipOn]} onPress={() => pickRegion(c.country)}>
                  <Text style={[styles.regionTxt, on && styles.regionTxtOn]} numberOfLines={1}>{c.country}</Text>
                  <Text style={[styles.regionCount, on && styles.regionCountOn]}>{c.count.toLocaleString()}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.regionHead}>
            <Icon name="globe" size={15} color={colors.good} />
            <Text style={styles.regionName}>{region}</Text>
            <Text style={styles.regionMeta}>· {regionCount.toLocaleString()} artists</Text>
          </View>

          <View style={styles.chartRow}>
            <GenreDonut data={genres} centerTop={regionCount.toLocaleString()} centerSub="artists" />
            <View style={styles.legend}>
              {genres.map((g, i) => (
                <View key={g.genre} style={styles.legendRow}>
                  <View style={[styles.swatch, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
                  <Text style={styles.legendName} numberOfLines={1}>{g.genre}</Text>
                  <Text style={styles.legendCount}>{g.count}</Text>
                  <Text style={styles.legendPct}>{Math.round(g.pct * 100)}%</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* Explore by genre: top artists + songs in a genre and region */}
      {genreChips.length > 0 && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>EXPLORE BY GENRE</Text>
            <Text style={styles.panelSub}>{region}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionRow}>
            {genreChips.map((g) => {
              const on = g.genre === genre;
              return (
                <Pressable key={g.genre} style={[styles.regionChip, on && styles.regionChipOn]} onPress={() => setGenre(g.genre)}>
                  <Text style={[styles.regionTxt, on && styles.regionTxtOn]}>{g.genre}</Text>
                  <Text style={[styles.regionCount, on && styles.regionCountOn]}>{g.count}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {genreArtists.length > 0 && (
            <>
              <Text style={styles.subLabel}>TOP {(genre || "").toUpperCase()} ARTISTS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gArtistRow}>
                {genreArtists.map((a, i) => (
                  <Pressable key={a.name} style={styles.gArtist} onPress={() => onOpenArtist?.(a.name)}>
                    <Avatar user={artistUser(a.name, a.photo)} size={66} />
                    <View style={styles.gRank}><Text style={styles.gRankTxt}>{i + 1}</Text></View>
                    <Text style={styles.gArtistName} numberOfLines={1}>{a.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

          {genreSongs.length > 0 && (
            <>
              <Text style={styles.subLabel}>TOP {(genre || "").toUpperCase()} SONGS</Text>
              {genreSongs.map((s, i) => (
                <Pressable key={s.title + s.artist} style={styles.gSong} onPress={() => playSong(s)}>
                  <Text style={styles.gSongRank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gSongTitle} numberOfLines={1}>{s.title}</Text>
                    <Pressable onPress={() => onOpenArtist?.(s.artist)}><Text style={styles.gSongArtist} numberOfLines={1}>{s.artist}</Text></Pressable>
                  </View>
                  <View style={styles.gSongPlay}><Icon name="play" size={13} color={colors.amber} /></View>
                </Pressable>
              ))}
            </>
          )}
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
                <Image source={{ uri: isHttp(p.uri) ? proxied(p.uri, 480) : p.uri }} style={styles.photoImg} resizeMode="cover" />
                <View style={styles.photoMeta}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.photoArtist} numberOfLines={1}>{p.artist}</Text>
                    {!!p.venue && <Text style={styles.photoVenue} numberOfLines={1}>{p.venue}</Text>}
                  </View>
                  {p.likes > 0 && (
                    <View style={styles.photoLikes}><Icon name="heart" size={12} color={colors.magenta} filled /><Text style={styles.photoLikesTxt}>{p.likes}</Text></View>
                  )}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 44, maxWidth: 900, width: "100%", alignSelf: "center" },
  kicker: { color: colors.amber, fontSize: 11, letterSpacing: 2.5, fontWeight: "800", fontFamily: mono },
  title: { color: colors.text, fontSize: 30, fontWeight: "900", letterSpacing: -0.6, marginTop: 4 },
  tagline: { color: colors.textDim, fontSize: 13.5, marginTop: 3 },

  tiles: { flexDirection: "row", gap: 10, marginTop: 18 },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: 14, paddingHorizontal: 12, ...shadow.card },
  tileIcon: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  tileNum: { color: colors.text, fontSize: 22, fontWeight: "900", fontFamily: mono, letterSpacing: -0.5 },
  tileLabel: { color: colors.textFaint, fontSize: 9.5, letterSpacing: 1.2, fontWeight: "800", marginTop: 3 },

  panel: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.lineSoft, padding: 18, marginTop: 16, ...shadow.card },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  panelTitle: { color: colors.text, fontSize: 13, letterSpacing: 2, fontWeight: "900" },
  panelSub: { color: colors.textDim, fontSize: 11.5 },
  sourcePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.bgElev, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5, borderWidth: 1, borderColor: colors.lineSoft },
  dotLive: { width: 7, height: 7, borderRadius: 4 },
  sourceTxt: { color: colors.textDim, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.3 },

  podium: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 4, paddingTop: 8 },
  plinthCol: { flex: 1, alignItems: "center", maxWidth: 160 },
  plinthCol1: { zIndex: 2 },
  avatarRing: { borderRadius: 999, borderWidth: 3, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  plinthMedal: { position: "absolute", bottom: -5, right: -7 },
  plinthName: { color: colors.text, fontSize: 13.5, fontWeight: "800", marginTop: 12, textAlign: "center" },
  plinthName1: { fontSize: 16 },
  plinthGenre: { color: colors.amber, fontSize: 10, fontWeight: "800", fontFamily: mono, letterSpacing: 0.6, textTransform: "uppercase", marginTop: 3 },
  block: { alignSelf: "stretch", marginTop: 12, borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft, borderBottomWidth: 0, alignItems: "center", justifyContent: "center" },
  block1: { backgroundColor: colors.surfaceAlt, borderColor: colors.gold, borderTopWidth: 2 },
  blockRank: { fontFamily: mono, fontSize: 24, fontWeight: "900", opacity: 0.9 },
  blockRank1: { fontSize: 34, opacity: 1 },

  rankList: { marginTop: 18, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 8 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  rankNum: { color: colors.textFaint, fontFamily: mono, fontSize: 13, fontWeight: "800", width: 22 },
  rankName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  rankGenre: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  rankMetric: { color: colors.textDim, fontSize: 11, fontWeight: "700", fontFamily: mono },

  regionRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  subLabel: { color: colors.textFaint, fontSize: 10.5, letterSpacing: 1.2, fontWeight: "800", marginTop: 16, marginBottom: 8 },
  gArtistRow: { flexDirection: "row", gap: 14, paddingVertical: 2, paddingRight: 8 },
  gArtist: { width: 74, alignItems: "center" },
  gRank: { position: "absolute", top: 0, left: 2, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  gRankTxt: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "800" },
  gArtistName: { color: colors.text, fontSize: 11.5, fontWeight: "700", marginTop: 6, textAlign: "center" },
  gSong: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  gSongRank: { color: colors.textFaint, fontFamily: mono, fontSize: 13, fontWeight: "800", width: 22, textAlign: "center" },
  gSongTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  gSongArtist: { color: colors.textDim, fontSize: 11.5, marginTop: 1 },
  gSongPlay: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center" },
  regionChip: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.bgElev, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, paddingVertical: 8 },
  regionChipOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  regionTxt: { color: colors.textDim, fontSize: 12.5, fontWeight: "700" },
  regionTxtOn: { color: "#1A1206" },
  regionCount: { color: colors.textFaint, fontSize: 10, fontFamily: mono, fontWeight: "800" },
  regionCountOn: { color: "rgba(26,18,6,0.7)" },

  regionHead: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 14, marginBottom: 4 },
  regionName: { color: colors.text, fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  regionMeta: { color: colors.textDim, fontSize: 12.5, fontWeight: "600" },

  chartRow: { flexDirection: "row", alignItems: "center", gap: 20, flexWrap: "wrap", justifyContent: "center", marginTop: 8 },
  donutCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  donutNum: { color: colors.text, fontSize: 24, fontWeight: "900", fontFamily: mono, letterSpacing: -0.5 },
  donutSub: { color: colors.textDim, fontSize: 11, fontWeight: "700", marginTop: -1, textTransform: "uppercase", letterSpacing: 1 },
  legend: { flex: 1, minWidth: 170, gap: 10 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendName: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 },
  legendCount: { color: colors.textFaint, fontSize: 11, fontFamily: mono, width: 34, textAlign: "right" },
  legendPct: { color: colors.textDim, fontSize: 12.5, fontFamily: mono, fontWeight: "800", width: 40, textAlign: "right" },

  photoRow: { flexDirection: "row", gap: 12, paddingVertical: 2 },
  photoTile: { width: 190, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  photoImg: { width: "100%", height: 190 },
  photoMeta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 9 },
  photoArtist: { color: colors.text, fontSize: 12.5, fontWeight: "700" },
  photoVenue: { color: colors.textDim, fontSize: 10.5, marginTop: 1 },
  photoLikes: { flexDirection: "row", alignItems: "center", gap: 3 },
  photoLikesTxt: { color: colors.textDim, fontSize: 11.5, fontWeight: "700", fontFamily: mono },
});
