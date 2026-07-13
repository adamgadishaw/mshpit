import { useMemo, useState, useEffect, useRef, useCallback, memo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Platform, Animated, Easing } from "react-native";
import Svg, { Path, Circle, Defs, RadialGradient, Stop, Ellipse, G } from "react-native-svg";
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

// A cute, springy genre donut: each genre is a rounded-cap arc with a little gap,
// so it reads like soft candy segments. Tapping a slice pops it outward with a
// bouncy scale + glow and dims the rest. Memoized + geometry-cached so it doesn't
// re-render (or recompute) when unrelated screen state changes = no lag.
const web = Platform.OS === "web";
const arcPath = (cx, cy, rad, start, end) => {
  const large = end - start > Math.PI ? 1 : 0;
  const x0 = cx + rad * Math.cos(start), y0 = cy + rad * Math.sin(start);
  const x1 = cx + rad * Math.cos(end), y1 = cy + rad * Math.sin(end);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rad} ${rad} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const GenreDonut = memo(function GenreDonut({ data, size = 200, centerTop, centerSub, activeGenre, onSlice }) {
  const cx = size / 2, cy = size / 2;
  const STROKE = 24, R = size / 2 - STROKE / 2 - 6;
  const GAP = 0.055; // radians of breathing room between segments

  // Gentle scale + fade entrance whenever the dataset changes (region switch).
  const grow = useRef(new Animated.Value(0)).current;
  const sig = data.map((d) => d.genre).join("|");
  useEffect(() => {
    grow.setValue(0);
    Animated.timing(grow, { toValue: 1, duration: 480, easing: Easing.out(Easing.back(1.4)), useNativeDriver: web ? false : true }).start();
  }, [sig]);
  const scale = grow.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });

  const segs = useMemo(() => {
    let a0 = -Math.PI / 2;
    return data.map((d, i) => {
      const frac = Math.min(0.9999, Math.max(0.001, d.pct));
      const a1 = a0 + frac * Math.PI * 2;
      const s = a0 + GAP / 2, e = Math.max(a0 + GAP / 2 + 0.02, a1 - GAP / 2);
      a0 = a1;
      return { genre: d.genre, color: PALETTE[i % PALETTE.length], d: arcPath(cx, cy, R, s, e) };
    });
  }, [sig, size]);

  const activeColor = (segs.find((s) => s.genre === activeGenre) || {}).color || PALETTE[0];
  return (
    <Animated.View style={{ width: size, height: size, opacity: grow, transform: [{ scale }] }}>
      <Svg width={size} height={size}>
        {/* faint track so the ring reads as a full circle even with gaps */}
        <Circle cx={cx} cy={cy} r={R} stroke={colors.bgElev} strokeWidth={STROKE} fill="none" opacity={0.5} />
        {segs.map((s, i) => {
          const on = s.genre === activeGenre;
          const dim = activeGenre && activeGenre !== "Other" && !on;
          return (
            <Path
              key={s.genre + i}
              d={s.d}
              stroke={s.color}
              strokeWidth={on ? STROKE + 7 : STROKE}
              strokeLinecap="round"
              fill="none"
              opacity={dim ? 0.4 : 1}
              onPress={() => onSlice?.(s.genre)}
              style={web ? { cursor: "pointer", transformOrigin: "50% 50%", transform: on ? "scale(1.09)" : "scale(1)", transition: "transform .32s cubic-bezier(.34,1.56,.64,1), stroke-width .22s, opacity .22s", filter: on ? `drop-shadow(0 0 7px ${s.color})` : "none" } : null}
            />
          );
        })}
      </Svg>
      <View style={[styles.donutCenter, styles.noPointerEvents]}>
        <Text style={[styles.donutNum, activeGenre && activeGenre !== "Other" && { color: activeColor, fontSize: 20 }]} numberOfLines={1}>
          {activeGenre && activeGenre !== "Other" ? activeGenre : centerTop}
        </Text>
        <Text style={styles.donutSub}>{activeGenre && activeGenre !== "Other" ? "tap to explore" : centerSub}</Text>
      </View>
    </Animated.View>
  );
});

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

export default function DiscoverScreen({ onOpenTopRated, onOpenArtist, onOpenNearby, onOpenFanClubs, onOpenVenues, onOpenPhotos, onPlay, onOpenProfile }) {
  const { session, discoverChart, discoverGenres, discoverCountries, topPhotos, discoverStats, loadMembers, memberCount, resolveDeezerPreview, friendsListening, loadFriendsListening } = useStore();

  const homeCountry = countryForCity(session?.home?.city);
  const [region, setRegion] = useState("Worldwide");
  const touched = useRef(false);
  const pickRegion = (c) => { touched.current = true; setRegion(c); };

  // The chart source: Deezer-tracked popularity, or what Pit users actually play.
  const [chartBy, setChartBy] = useState("popularity");
  const [chart, setChart] = useState([]);
  const [chartInfo, setChartInfo] = useState({ label: "By popularity", live: true });

  const [countries, setCountries] = useState([{ country: "Worldwide" }]);
  const [genres, setGenres] = useState([]);
  const [genreTotal, setGenreTotal] = useState(0);
  const [genre, setGenre] = useState(null);       // selected genre (pie slice / legend)
  const [genreRows, setGenreRows] = useState([]); // top artists in that genre (+ topTrack)

  const photos = useMemo(() => topPhotos(12), []);
  const stats = useMemo(() => discoverStats(), []);

  useEffect(() => { loadMembers(); loadFriendsListening(); }, []);

  // Region chips: Worldwide + the user's home country + the biggest scenes (live DB).
  useEffect(() => {
    let live = true;
    discoverCountries({ min: 5 }).then(({ countries: cs }) => {
      if (!live) return;
      const ordered = [{ country: "Worldwide" }];
      const home = cs.find((c) => c.country === homeCountry);
      if (home) ordered.push(home);
      cs.forEach((c) => c.country !== homeCountry && ordered.push(c));
      const seen = new Set();
      setCountries(ordered.filter((c) => !seen.has(c.country) && seen.add(c.country)).slice(0, 12));
      if (!touched.current && home) setRegion(homeCountry);
    });
    return () => { live = false; };
  }, [homeCountry]);

  // Chart reloads on source or region change.
  useEffect(() => {
    let live = true;
    discoverChart({ by: chartBy, country: region, limit: 24 }).then((r) => { if (live) { setChart(r.rows || []); setChartInfo({ label: r.label, live: r.live }); } });
    return () => { live = false; };
  }, [chartBy, region]);

  // Genre share reloads on region change; reset the selected genre.
  useEffect(() => {
    let live = true;
    discoverGenres({ country: region, n: 8 }).then((g) => { if (live) { setGenres(g.genres || []); setGenreTotal(g.total || 0); setGenre((cur) => (g.genres || []).some((x) => x.genre === cur && x.genre !== "Other") ? cur : ((g.genres || []).find((x) => x.genre !== "Other")?.genre || null)); } });
    return () => { live = false; };
  }, [region]);

  // Selected genre's top artists (each carries a lead track for the songs list).
  useEffect(() => {
    if (!genre) { setGenreRows([]); return; }
    let live = true;
    discoverChart({ genre, country: region, limit: 12 }).then((r) => { if (live) setGenreRows(r.rows || []); });
    return () => { live = false; };
  }, [genre, region]);

  const playSong = async (s) => {
    let url = s.url, preview = s.preview;
    if (!url && !preview) preview = await resolveDeezerPreview(s.title, s.artist);
    if (url || preview) onPlay?.({ kind: "track", url: url || null, preview: preview || null, title: s.title, artist: s.artist, art: s.art || null });
  };
  const playTop = (r) => r.topTrack && playSong({ title: r.topTrack.title, artist: r.name, url: r.topTrack.url, preview: r.topTrack.preview, art: r.photo });
  // Stable so the memoized donut skips re-renders; tapping the active slice clears it.
  const selectGenre = useCallback((g) => { if (g === "Other") return; setGenre((cur) => (cur === g ? null : g)); }, []);

  const podium = chart.slice(0, 3);
  const rest = chart.slice(3);
  const photoUris = photos.map((p) => p.uri);
  const regionCount = region === "Worldwide" ? genreTotal : (countries.find((c) => c.country === region)?.count || genreTotal);
  const genreSongs = genreRows.filter((r) => r.topTrack).map((r) => ({ title: r.topTrack.title, artist: r.name, url: r.topTrack.url, preview: r.topTrack.preview, art: r.photo }));

  const STAT_TILES = [
    { k: "members", label: "MEMBERS", icon: "you", tint: colors.gold, val: memberCount || stats.members },
    { k: "artists", label: "ARTISTS", icon: "music", tint: colors.amber, val: genreTotal || stats.artists },
    { k: "venues", label: "VENUES", icon: "pin", tint: colors.cool, val: stats.venues },
    { k: "genres", label: "GENRES", icon: "discover", tint: colors.magenta, val: genres.filter((g) => g.genre !== "Other").length || stats.genres },
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
            <Text style={styles.tileNum}>{(t.val || 0).toLocaleString()}</Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      {/* Friends listening: the latest track from each person you follow */}
      {friendsListening.length > 0 && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>FRIENDS LISTENING</Text>
            <Text style={styles.panelSub}>Latest plays</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.flRow}>
            {friendsListening.map((f) => (
              <View key={f.user.id} style={styles.flCard}>
                <Pressable onPress={() => onOpenProfile?.(f.user.id)} style={{ alignItems: "center" }}>
                  <Avatar user={f.user} size={46} />
                  <Text style={styles.flName} numberOfLines={1}>{f.user.name}</Text>
                </Pressable>
                <Pressable style={styles.flTrack} onPress={() => playSong({ title: f.track.title, artist: f.track.artist, url: f.track.url, art: f.track.art })}>
                  <Icon name="play" size={11} color={colors.amber} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.flTitle} numberOfLines={1}>{f.track.title}</Text>
                    <Text style={styles.flArtist} numberOfLines={1}>{f.track.artist}</Text>
                  </View>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Chart podium, the hero */}
      {podium.length === 3 && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>THE CHART</Text>
            <View style={styles.sourcePill}>
              <View style={[styles.dotLive, { backgroundColor: colors.good }]} />
              <Text style={styles.sourceTxt}>{region === "Worldwide" ? "Live" : region}</Text>
            </View>
          </View>

          {/* Which chart: the popularity chart (Deezer) or what Pit plays. */}
          <View style={styles.segRow}>
            <Pressable style={[styles.seg, chartBy === "popularity" && styles.segOn]} onPress={() => setChartBy("popularity")}>
              <Text style={[styles.segTxt, chartBy === "popularity" && styles.segTxtOn]}>Popularity</Text>
            </Pressable>
            <Pressable style={[styles.seg, chartBy === "plays" && styles.segOn]} onPress={() => setChartBy("plays")}>
              <Text style={[styles.segTxt, chartBy === "plays" && styles.segTxtOn]}>On Pit</Text>
            </Pressable>
          </View>
          <Text style={styles.chartNote}>{chartBy === "plays" ? "Ranked by how much Pit members are playing them right now." : "Popularity is a 0 to 100 score from Deezer fan reach. Higher means a bigger global following."}</Text>

          <View style={styles.podium}>
            <Plinth row={podium[1]} rank={2} onPress={() => onOpenArtist?.(podium[1].name)} />
            <Plinth row={podium[0]} rank={1} onPress={() => onOpenArtist?.(podium[0].name)} />
            <Plinth row={podium[2]} rank={3} onPress={() => onOpenArtist?.(podium[2].name)} />
          </View>

          {rest.length > 0 && (
            <View style={styles.rankList}>
              {rest.map((r) => (
                <View key={r.name} style={styles.rankRow}>
                  <Text style={styles.rankNum}>{r.rank}</Text>
                  <Avatar user={artistUser(r.name, r.photo)} size={38} />
                  <Pressable style={{ flex: 1 }} onPress={() => onOpenArtist?.(r.name)}>
                    <Text style={styles.rankName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.rankGenre} numberOfLines={1}>
                      {r.genre || "Artist"}{r.topTrack ? "  ·  " + r.topTrack.title : ""}
                    </Text>
                  </Pressable>
                  {r.topTrack && (
                    <Pressable style={styles.rankPlay} onPress={() => playTop(r)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Play ${r.topTrack.title}`}>
                      <Icon name="play" size={13} color={colors.amber} />
                    </Pressable>
                  )}
                  <View style={styles.metricChip}>
                    <Text style={styles.metricNum}>{r.plays != null ? r.plays : (r.popularity != null ? r.popularity : (r.followers != null ? fmt(r.followers) : "-"))}</Text>
                    <Text style={styles.metricLbl}>{r.plays != null ? "plays" : (r.popularity != null ? "pop" : "fans")}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
          <Pressable style={styles.checkOut} onPress={() => onOpenArtist?.(podium[0].name)}>
            <Text style={styles.checkOutTxt}>Check out #1: {podium[0].name}</Text>
            <Icon name="chevron-right" size={15} color={colors.amber} />
          </Pressable>
        </View>
      )}

      {/* Genre share by region — tap a slice or legend row to explore that genre */}
      {genres.length > 0 && (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>GENRES</Text>
            <Text style={styles.panelSub}>Tap a slice to explore</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionRow}>
            {countries.map((c) => {
              const on = c.country === region;
              return (
                <Pressable key={c.country} style={[styles.regionChip, on && styles.regionChipOn]} onPress={() => pickRegion(c.country)}>
                  <Text style={[styles.regionTxt, on && styles.regionTxtOn]} numberOfLines={1}>{c.country}</Text>
                  {c.count != null && <Text style={[styles.regionCount, on && styles.regionCountOn]}>{c.count.toLocaleString()}</Text>}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.chartRow}>
            <GenreDonut data={genres} centerTop={regionCount.toLocaleString()} centerSub="artists" activeGenre={genre} onSlice={selectGenre} />
            <View style={styles.legend}>
              {genres.map((g, i) => {
                const on = g.genre === genre;
                return (
                  <Pressable key={g.genre} style={[styles.legendRow, on && styles.legendRowOn]} onPress={() => selectGenre(g.genre)}>
                    <View style={[styles.swatch, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
                    <Text style={[styles.legendName, on && { color: colors.amber, fontWeight: "800" }]} numberOfLines={1}>{g.genre}</Text>
                    <Text style={styles.legendCount}>{g.count}</Text>
                    <Text style={styles.legendPct}>{Math.round(g.pct * 100)}%</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Selected genre: its top artists + songs (the "pop-out" detail) */}
          {genre && genreRows.length > 0 && (
            <View style={styles.genreDetail}>
              <Text style={styles.subLabel}>TOP {genre.toUpperCase()} ARTISTS{region !== "Worldwide" ? " · " + region.toUpperCase() : ""}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gArtistRow}>
                {genreRows.map((a, i) => (
                  <Pressable key={a.name} style={styles.gArtist} onPress={() => onOpenArtist?.(a.name)}>
                    <Avatar user={artistUser(a.name, a.photo)} size={66} />
                    <View style={styles.gRank}><Text style={styles.gRankTxt}>{i + 1}</Text></View>
                    <Text style={styles.gArtistName} numberOfLines={1}>{a.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              {genreSongs.length > 0 && (
                <>
                  <Text style={styles.subLabel}>TOP {genre.toUpperCase()} SONGS</Text>
                  {genreSongs.slice(0, 8).map((s, i) => (
                    <View key={s.title + s.artist} style={styles.gSong}>
                      <Text style={styles.gSongRank}>{i + 1}</Text>
                      <Pressable style={{ flex: 1 }} onPress={() => playSong(s)}>
                        <Text style={styles.gSongTitle} numberOfLines={1}>{s.title}</Text>
                        <Text style={styles.gSongArtist} numberOfLines={1}>{s.artist}</Text>
                      </Pressable>
                      <Pressable style={styles.gSongPlay} onPress={() => playSong(s)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Play ${s.title}`}><Icon name="play" size={13} color={colors.amber} /></Pressable>
                    </View>
                  ))}
                </>
              )}
            </View>
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
  noPointerEvents: { pointerEvents: "none" },
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

  segRow: { flexDirection: "row", gap: 6, backgroundColor: colors.bgElev, borderRadius: radius.pill, padding: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.lineSoft },
  seg: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.pill },
  segOn: { backgroundColor: colors.amberStrong },
  segTxt: { color: colors.textDim, fontSize: 12.5, fontWeight: "800" },
  segTxtOn: { color: "#1A1206" },
  chartNote: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, marginTop: 8 },

  rankList: { marginTop: 16, borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 8 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7 },
  rankNum: { color: colors.textFaint, fontFamily: mono, fontSize: 13, fontWeight: "800", width: 22 },
  rankName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  rankGenre: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  rankPlay: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center", paddingLeft: 2 },
  metricChip: { alignItems: "center", minWidth: 40 },
  metricNum: { color: colors.text, fontFamily: mono, fontSize: 14, fontWeight: "800" },
  metricLbl: { color: colors.textFaint, fontSize: 8.5, letterSpacing: 1, fontWeight: "800", marginTop: 1 },
  checkOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 14, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.06)" },
  checkOutTxt: { color: colors.amber, fontSize: 13.5, fontWeight: "800" },

  regionRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  subLabel: { color: colors.textFaint, fontSize: 10.5, letterSpacing: 1.2, fontWeight: "800", marginTop: 16, marginBottom: 8 },
  flRow: { flexDirection: "row", gap: 12, paddingVertical: 2, paddingRight: 8 },
  flCard: { width: 150, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, alignItems: "center", gap: 8 },
  flName: { color: colors.text, fontSize: 12.5, fontWeight: "700", marginTop: 6, maxWidth: 124, textAlign: "center" },
  flTrack: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 6, alignSelf: "stretch" },
  flTitle: { color: colors.text, fontSize: 11.5, fontWeight: "700" },
  flArtist: { color: colors.textDim, fontSize: 10, marginTop: 1 },
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
  legend: { flex: 1, minWidth: 170, gap: 4 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm, ...(Platform.OS === "web" ? { cursor: "pointer" } : null) },
  legendRowOn: { backgroundColor: colors.bgElev },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  genreDetail: { marginTop: 6, borderTopWidth: 1, borderTopColor: colors.lineSoft },
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
