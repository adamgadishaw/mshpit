import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Easing, Platform } from "react-native";
import { colors, mono, radius, shadow, displayFont } from "../theme";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import SmartImage from "../components/SmartImage";
import SoundDonut, { DONUT_PALETTE } from "../components/SoundDonut";
import { BadgeRow } from "../components/Badge";
import { useStore, isStaff, isMod, isArtist } from "../store";
import { showDateMs, fmtCountdown } from "../lib/showTime";

const web = Platform.OS === "web";

// Staggered section entrance: each block fades up as the page mounts, so the
// dashboard feels alive instead of stamped onto the screen.
function Reveal({ delay = 0, children, style }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 430, delay, easing: Easing.out(Easing.cubic), useNativeDriver: !web }).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={[style, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// A chart row whose bar SWEEPS in to its share of the top count.
function SongBar({ rank, title, sub, count, max, art, onPress, delay = 0 }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 620, delay: 180 + delay, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = Math.max(5, Math.round((count / (max || 1)) * 100));
  return (
    <Pressable style={styles.songRow} onPress={onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={`${title}${sub ? " by " + sub : ""}, ${count} ${count === 1 ? "play" : "plays"}${onPress ? ", tap to play" : ""}`}>
      <Text style={styles.songRank}>{rank}</Text>
      {art ? <SmartImage uri={art} style={styles.songArt} contain={false} /> : <View style={[styles.songArt, styles.songArtEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>}
      <View style={{ flex: 1 }}>
        <View style={styles.songTop}>
          <Text style={styles.songTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.songCount}>{count}</Text>
        </View>
        {!!sub && <Text style={styles.songSub} numberOfLines={1}>{sub}</Text>}
        <View style={styles.songTrack}>
          <Animated.View style={[styles.songFill, { width: t.interpolate({ inputRange: [0, 1], outputRange: ["0%", `${pct}%`] }) }]} />
        </View>
      </View>
      {onPress && <View style={styles.songPlay}><Icon name="play" size={12} color={colors.amber} /></View>}
    </Pressable>
  );
}

// The You tab: the user's own page, profile-first like prime MySpace/Facebook -
// a hero identity card, then the sound (donut + podium + charts), the photo
// wall, plans, and a compact toolbelt. Every number is DERIVED from real
// activity; empty sections hide instead of padding the page.
export default function YouScreen({ feed, onLogin, onLogout, onAdmin, onAddTourDate, onRequestArtist, onEditProfile, onOpenProfile, onOpen, onActivity, onInbox, onCalendar, onOpenNearby, homeCity, onPlay, onOpenPhotos, onOpenArtist }) {
  const { session, logsByUser, unreadNotifications, inboxUnread, playHistory, genreOfArtist, goingFor, myPlaylists, loadMyPlaylists, userBadges, userPoints } = useStore();
  const mine = session ? logsByUser(session.id) : [];
  const notif = session ? unreadNotifications() : 0;
  const unread = session ? inboxUnread() : 0;

  useEffect(() => { if (session) loadMyPlaylists(); }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- listening analytics, all from the server-backed play history ----
  const sound = useMemo(() => {
    const plays = playHistory || [];
    const artists = {}; const songs = {}; const genres = {};
    for (const p of plays) {
      if (p.artist) {
        (artists[p.artist] ||= { name: p.artist, count: 0, art: null }).count += 1;
        if (p.art && !artists[p.artist].art) artists[p.artist].art = p.art;
        const g = genreOfArtist(p.artist);
        if (g) { const k = g.toLowerCase(); genres[k] = (genres[k] || 0) + 1; }
      }
      if (p.title) {
        const key = `${(p.artist || "").toLowerCase()}|${p.title.toLowerCase()}`;
        (songs[key] ||= { title: p.title, artist: p.artist, art: p.art || null, count: 0 }).count += 1;
        if (p.art && !songs[key].art) songs[key].art = p.art;
      }
    }
    const top = (m, n) => Object.values(m).sort((a, b) => b.count - a.count).slice(0, n);
    return {
      totalPlays: plays.length,
      topArtists: top(artists, 6),
      topSongs: top(songs, 5),
      genres: Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label: label.replace(/\b\w/g, (c) => c.toUpperCase()), count })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playHistory]);

  // ---- concert analytics, from the diary ----
  const live = useMemo(() => {
    const artists = new Set(); const venues = new Set(); const genres = {};
    let best = null;
    for (const l of mine) {
      if (l.artist) { artists.add(l.artist.toLowerCase()); const g = genreOfArtist(l.artist); if (g) { const k = g.toLowerCase(); genres[k] = (genres[k] || 0) + 1; } }
      if (l.venue) venues.add(l.venue.toLowerCase());
      if (best == null || (l.overall || 0) > best) best = l.overall || 0;
    }
    const topGenre = Object.entries(genres).sort((a, b) => b[1] - a[1])[0];
    return { artists: artists.size, venues: venues.size, topGenre: topGenre ? topGenre[0] : null, best };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);

  const gallery = useMemo(() => mine.flatMap((l) => (l.photos || []).map((uri) => ({ uri, postId: l.id }))), [mine]);

  const planned = session ? goingFor(session.id) : [];
  const upcoming = planned.filter((p) => { const t = showDateMs(p.date); return t != null && t - Date.now() > -86400000; });
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!upcoming.length) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [upcoming.length]);

  const playlists = myPlaylists || [];
  const playTrack = (t) => onPlay?.({ kind: "track", title: t.title, artist: t.artist, art: t.art || null });
  const playPlaylist = (pl) => { const q = (pl.tracks || []).filter((t) => t.title); if (q.length) onPlay?.(q[0], q); };

  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.loggedOut}>
          <View style={styles.loggedOutAvatar}>
            <Icon name="you" size={28} color={colors.textDim} />
          </View>
          <Text style={styles.heroName}>You&apos;re logged out</Text>
          <Text style={styles.heroHandle}>Log in to keep a diary and post reviews.</Text>
          <Pressable style={styles.primary} onPress={onLogin}>
            <Text style={styles.primaryTxt}>LOG IN / SIGN UP</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const roleLabel = session.role === "admin" ? "ADMIN" : session.role === "artist" ? "VERIFIED ARTIST" : "FAN";
  const year = new Date().getFullYear();
  const showsThisYear = mine.filter((l) => String(l.date || "").includes(String(year))).length;
  const points = userPoints(session);
  const badges = userBadges(session);
  const podium = sound.topArtists.slice(0, 3);
  const restArtists = sound.topArtists.slice(3, 6);
  const MEDAL = [colors.gold, "#c9ccd4", "#c98d5a"];

  // Compact toolbelt instead of a wall of menu rows.
  const tools = [
    { icon: "bell", label: "Activity", badge: notif, onPress: onActivity },
    { icon: "mail", label: "Inbox", badge: unread, onPress: onInbox },
    { icon: "calendar", label: "Calendar", onPress: onCalendar },
    { icon: "edit", label: "Edit profile", onPress: onEditProfile },
    isMod(session.role) && { icon: "shield", label: "Moderation", onPress: onAdmin },
    isArtist(session.role) && { icon: "calendar", label: "Tour dates", onPress: onAddTourDate },
    session.role === "fan" && { icon: "shield", label: "Artist account", onPress: onRequestArtist },
    { icon: "logout", label: "Log out", danger: true, onPress: onLogout },
  ].filter(Boolean);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* ---- HERO: the profile card (banner, avatar, identity, real stats) ---- */}
      <Reveal delay={0}>
        <View style={styles.hero}>
          <View style={styles.banner}>
            {session.banner
              ? <SmartImage uri={session.banner} style={StyleSheet.absoluteFill} contain={false} />
              : (
                <>
                  <View style={[styles.bannerGlow, { left: "-12%", top: -66, backgroundColor: "rgba(242,166,90,0.34)" }]} />
                  <View style={[styles.bannerGlow, { left: "36%", top: -78, backgroundColor: "rgba(90,140,242,0.26)" }]} />
                  <View style={[styles.bannerGlow, { right: "-10%", top: -60, backgroundColor: "rgba(214,79,150,0.30)" }]} />
                </>
              )}
            <View style={styles.bannerScrim} />
          </View>
          <View style={styles.heroBody}>
            <View style={styles.heroAvatarWrap}>
              <Avatar user={session} size={84} onPress={() => onOpenProfile?.(session.id)} />
            </View>
            <View style={styles.heroIdRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.heroNameRow}>
                  <Text style={styles.heroName}>{session.name}</Text>
                  <BadgeRow badges={badges} size={16} />
                </View>
                <Text style={styles.heroHandle}>@{session.handle} · <Text style={{ color: colors.amber }}>{roleLabel}</Text></Text>
              </View>
              <Pressable style={styles.pointsPill} onPress={() => onOpenProfile?.(session.id)} accessibilityRole="button" accessibilityLabel={`${points} points, view profile`}>
                <Icon name="star" size={12} color={colors.gold} />
                <Text style={styles.pointsTxt}>{points.toLocaleString()} pts</Text>
              </Pressable>
            </View>
            <View style={styles.heroStats}>
              {[[mine.length, "SHOWS"], [live.artists, "ARTISTS"], [live.venues, "VENUES"], [sound.totalPlays, "PLAYS"]].map(([v, l]) => (
                <View key={l} style={styles.heroStat}>
                  <Text style={styles.heroStatVal}>{v}</Text>
                  <Text style={styles.heroStatLabel}>{l}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.wrappedLine}>
              <Text style={{ color: colors.amber, fontWeight: "800" }}>{year} · </Text>
              {showsThisYear === 0 ? "No shows logged this year yet. The pit is waiting." : (
                <>
                  {showsThisYear} show{showsThisYear === 1 ? "" : "s"}
                  {live.topGenre ? ` · most-seen: ${live.topGenre.replace(/\b\w/g, (c) => c.toUpperCase())}` : ""}
                  {live.best ? <> · best night <Text style={{ color: colors.gold, fontFamily: mono }}>{live.best.toFixed(1)}</Text></> : null}
                </>
              )}
            </Text>
          </View>
        </View>
      </Reveal>

      {/* ---- NEAR YOU: local venues + upcoming shows, back on the You tab ---- */}
      {session && onOpenNearby && (
        <Reveal delay={50}>
          <Pressable style={styles.nearCard} onPress={onOpenNearby} accessibilityRole="button" accessibilityLabel={`Near you${homeCity ? `, ${homeCity}` : ""}`}>
            <View style={styles.nearIcon}><Icon name="pin" size={20} color={colors.amber} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.nearTitle} numberOfLines={1}>Near you{homeCity ? ` · ${homeCity}` : ""}</Text>
              <Text style={styles.nearSub} numberOfLines={1}>Local venues &amp; upcoming shows</Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.textDim} />
          </Pressable>
        </Reveal>
      )}

      {/* ---- YOUR SOUND: donut + legend, podium, song chart ---- */}
      <Reveal delay={90}>
        <Text style={styles.sectionLabel}>YOUR SOUND</Text>
        {sound.totalPlays === 0 ? (
          <View style={styles.card}><Text style={styles.emptyHint}>Play songs from any artist page and your charts build themselves.</Text></View>
        ) : (
          <View style={styles.card}>
            <View style={styles.donutRow}>
              <SoundDonut data={sound.genres.length ? sound.genres : [{ label: "Unsorted", count: sound.totalPlays }]} size={172} centerTop={String(sound.totalPlays)} centerSub="plays" />
              <View style={styles.legend}>
                {(sound.genres.length ? sound.genres : [{ label: "Unsorted", count: sound.totalPlays }]).map((g, i) => (
                  <View key={g.label} style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length] }]} />
                    <Text style={styles.legendTxt} numberOfLines={1}>{g.label}</Text>
                    <Text style={styles.legendCount}>{g.count}</Text>
                  </View>
                ))}
              </View>
            </View>

            {podium.length > 0 && (
              <>
                <Text style={styles.subLabel}>MOST PLAYED ARTISTS</Text>
                <View style={styles.podium}>
                  {podium.map((a, i) => (
                    <Pressable key={a.name} style={[styles.podiumTile, i === 0 && styles.podiumTop]} onPress={() => (onOpenArtist ? onOpenArtist(a.name) : playTrack({ title: a.name, artist: a.name, art: a.art }))} accessibilityRole="button" accessibilityLabel={`${a.name}, ${a.count} plays, open artist`}>
                      {a.art ? <SmartImage uri={a.art} style={styles.podiumArt} contain={false} /> : <View style={[styles.podiumArt, styles.songArtEmpty]}><Icon name="music" size={18} color={colors.textFaint} /></View>}
                      <View style={[styles.podiumMedal, { backgroundColor: MEDAL[i] }]}><Text style={styles.podiumMedalTxt}>{i + 1}</Text></View>
                      <Text style={styles.podiumName} numberOfLines={1}>{a.name}</Text>
                      <Text style={styles.podiumCount}>{a.count} {a.count === 1 ? "play" : "plays"}</Text>
                    </Pressable>
                  ))}
                </View>
                {restArtists.map((a, i) => (
                  <SongBar key={a.name} rank={i + 4} title={a.name} count={a.count} max={podium[0].count} art={a.art} delay={i * 90} onPress={() => (onOpenArtist ? onOpenArtist(a.name) : undefined)} />
                ))}
              </>
            )}

            {sound.topSongs.length > 0 && (
              <>
                <Text style={styles.subLabel}>MOST PLAYED SONGS</Text>
                {sound.topSongs.map((s, i) => (
                  <SongBar key={s.artist + s.title} rank={i + 1} title={s.title} sub={s.artist} count={s.count} max={sound.topSongs[0].count} art={s.art} delay={i * 90} onPress={onPlay ? () => playTrack(s) : undefined} />
                ))}
              </>
            )}
          </View>
        )}
      </Reveal>

      {/* ---- PHOTO WALL: feature-first, like an album preview ---- */}
      {gallery.length > 0 && (
        <Reveal delay={160}>
          <Text style={styles.sectionLabel}>YOUR PHOTO WALL · {gallery.length}</Text>
          <View style={styles.wall}>
            <SmartImage uri={gallery[0].uri} style={styles.wallFeature} contain={false}
              onPress={onOpenPhotos ? () => onOpenPhotos(gallery.map((x) => ({ uri: x.uri, by: session.name })), 0, gallery[0].postId) : undefined} />
            <View style={styles.wallSide}>
              {gallery.slice(1, 5).map((p, i) => (
                <SmartImage key={p.uri + i} uri={p.uri} style={styles.wallCell} contain={false}
                  onPress={onOpenPhotos ? () => onOpenPhotos(gallery.map((x) => ({ uri: x.uri, by: session.name })), i + 1, p.postId) : undefined} />
              ))}
            </View>
          </View>
          {gallery.length > 5 && (
            <Pressable onPress={onOpenPhotos ? () => onOpenPhotos(gallery.map((x) => ({ uri: x.uri, by: session.name })), 0, gallery[0].postId) : undefined}>
              <Text style={styles.wallMore}>See all {gallery.length} photos ›</Text>
            </Pressable>
          )}
        </Reveal>
      )}

      {/* ---- PLAYLISTS + GOING TO ---- */}
      {(playlists.length > 0 || upcoming.length > 0) && (
        <Reveal delay={220}>
          {playlists.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>PLAYLISTS · {playlists.length}</Text>
              {playlists.map((pl) => (
                <Pressable key={pl.id} style={styles.row} onPress={() => playPlaylist(pl)} accessibilityRole="button" accessibilityLabel={`Play playlist ${pl.name}`}>
                  <View style={styles.rowIcon}><Icon name="music" size={16} color={colors.amber} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{pl.name}</Text>
                    <Text style={styles.rowSub}>{(pl.tracks || []).length} songs</Text>
                  </View>
                  <Icon name="play" size={14} color={colors.amber} />
                </Pressable>
              ))}
            </>
          )}
          {upcoming.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>GOING TO · {upcoming.length}</Text>
              {upcoming.map((p) => {
                const left = showDateMs(p.date) - nowTick;
                return (
                  <Pressable key={p.key} style={styles.row} onPress={() => onOpen?.(p)}>
                    <View style={styles.rowIcon}><Icon name="calendar" size={15} color={colors.amber} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel} numberOfLines={1}>{p.artist}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>{p.venue}{p.date ? ` · ${p.date}` : ""}</Text>
                    </View>
                    <Text style={styles.goingT}>{left <= 0 ? "TONIGHT" : fmtCountdown(left)}</Text>
                  </Pressable>
                );
              })}
            </>
          )}
        </Reveal>
      )}

      {/* ---- TOOLBELT: one compact grid instead of stacked menu rows ---- */}
      <Reveal delay={280}>
        <Text style={styles.sectionLabel}>TOOLS</Text>
        <View style={styles.toolGrid}>
          {tools.map((t) => (
            <Pressable key={t.label} style={styles.tool} onPress={t.onPress} accessibilityRole="button" accessibilityLabel={t.label + (t.badge ? `, ${t.badge} new` : "")}>
              <View style={styles.toolIcon}>
                <Icon name={t.icon} size={17} color={t.danger ? colors.danger : colors.amber} />
                {t.badge > 0 && <View style={styles.toolBadge}><Text style={styles.toolBadgeTxt}>{t.badge}</Text></View>}
              </View>
              <Text style={[styles.toolLabel, t.danger && { color: colors.danger }]} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </Reveal>

      {/* ---- DIARY ---- */}
      <Reveal delay={340}>
        <Text style={styles.sectionLabel}>YOUR DIARY · {mine.length}</Text>
        {mine.length === 0 && <Text style={styles.emptyHint}>No shows yet. Tap the + to log your first one.</Text>}
        {mine.map((l) => {
          const parts = (l.date || "").split(" · ");
          return (
            <Pressable key={l.id} style={styles.row} onPress={() => onOpen?.(l)}>
              <View style={styles.diaryStub}>
                <Text style={styles.diaryStubMon}>{parts[1] || ""}</Text>
                <Text style={styles.diaryStubDay}>{parts[2] || ""}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel} numberOfLines={1}>{l.artist}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{l.venue} · {l.city}</Text>
              </View>
              <View style={styles.diaryScorePill}>
                <Icon name="star" size={11} color={colors.gold} />
                <Text style={styles.diaryScore}>{(l.overall || 0).toFixed(1)}</Text>
              </View>
            </Pressable>
          );
        })}
      </Reveal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  loggedOut: { alignItems: "center", marginTop: 60, gap: 6 },
  loggedOutAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center", marginTop: 22 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },

  // hero
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, overflow: "hidden", ...shadow.card },
  banner: { height: 96, backgroundColor: colors.bgElev, overflow: "hidden" },
  bannerGlow: { position: "absolute", width: 240, height: 190, borderRadius: 120, opacity: 0.85, ...(web ? { filter: "blur(38px)" } : null) },
  bannerScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(6,7,11,0.25)" },
  heroBody: { paddingHorizontal: 16, paddingBottom: 16 },
  heroAvatarWrap: { marginTop: -42, alignSelf: "flex-start", borderRadius: 46, borderWidth: 3, borderColor: colors.surface, ...shadow.card },
  heroIdRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 10 },
  heroNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  heroName: { color: colors.text, fontFamily: displayFont, fontSize: 22, fontWeight: "900", letterSpacing: -0.3 },
  heroHandle: { color: colors.textDim, fontSize: 13, marginTop: 3 },
  pointsPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.gold, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(232,182,90,0.08)" },
  pointsTxt: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "800" },
  heroStats: { flexDirection: "row", backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, marginTop: 14, paddingVertical: 12 },
  heroStat: { flex: 1, alignItems: "center" },
  heroStatVal: { color: colors.text, fontFamily: mono, fontSize: 19, fontWeight: "800" },
  heroStatLabel: { color: colors.textFaint, fontSize: 9.5, letterSpacing: 1.2, marginTop: 3, fontWeight: "800" },
  wrappedLine: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 12 },

  nearCard: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16, backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.amber, paddingHorizontal: 14, paddingVertical: 13, ...shadow.card },
  nearIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  nearTitle: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  nearSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginTop: 24, marginBottom: 10 },
  subLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 16, ...shadow.card },
  emptyHint: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },

  donutRow: { flexDirection: "row", alignItems: "center", gap: 18, flexWrap: "wrap" },
  legend: { flex: 1, minWidth: 150, gap: 8 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 },
  legendCount: { color: colors.textFaint, fontFamily: mono, fontSize: 11.5 },

  podium: { flexDirection: "row", gap: 10 },
  podiumTile: { flex: 1, backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 10, alignItems: "center" },
  podiumTop: { borderColor: colors.gold },
  podiumArt: { width: "100%", aspectRatio: 1, borderRadius: radius.sm },
  podiumMedal: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginTop: -13, borderWidth: 2, borderColor: colors.bgElev },
  podiumMedalTxt: { color: "#1A1206", fontFamily: mono, fontSize: 11, fontWeight: "900" },
  podiumName: { color: colors.text, fontSize: 12.5, fontWeight: "800", marginTop: 5, textAlign: "center" },
  podiumCount: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, marginTop: 2 },

  songRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  songRank: { color: colors.textFaint, fontFamily: mono, fontSize: 12, fontWeight: "800", width: 16, textAlign: "center" },
  songArt: { width: 34, height: 34, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  songArtEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.lineSoft },
  songTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  songTitle: { color: colors.text, fontSize: 13.5, fontWeight: "700", flex: 1 },
  songCount: { color: colors.textDim, fontFamily: mono, fontSize: 11 },
  songSub: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  songTrack: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden", marginTop: 5 },
  songFill: { height: 5, borderRadius: 3, backgroundColor: colors.amber },
  songPlay: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },

  wall: { flexDirection: "row", gap: 6, height: 232 },
  wallFeature: { flex: 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft },
  wallSide: { flex: 1, gap: 6 },
  wallCell: { flex: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft },
  wallMore: { color: colors.amber, fontSize: 13, fontWeight: "700", marginTop: 10 },

  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: colors.text, fontSize: 14.5, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  goingT: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },

  toolGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tool: { width: "23.5%", minWidth: 86, flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: 12, alignItems: "center", gap: 6 },
  toolIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  toolBadge: { position: "absolute", top: -4, right: -6, backgroundColor: colors.magenta, borderRadius: 9, minWidth: 17, height: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  toolBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800", fontFamily: mono },
  toolLabel: { color: colors.text, fontSize: 11.5, fontWeight: "700" },

  diaryStub: { width: 46, height: 46, borderRadius: 8, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  diaryStubMon: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "800" },
  diaryStubDay: { color: colors.textFaint, fontFamily: mono, fontSize: 11 },
  diaryScorePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  diaryScore: { color: colors.gold, fontFamily: mono, fontSize: 14, fontWeight: "700" },
});
