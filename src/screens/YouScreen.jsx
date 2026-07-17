import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius, shadow } from "../theme";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import SmartImage from "../components/SmartImage";
import { useStore, isStaff, isMod, isArtist } from "../store";
import { showDateMs, fmtCountdown } from "../lib/showTime";

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({ icon, label, sub, onPress, danger }) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <View style={styles.actionIcon}>
        <Icon name={icon} size={18} color={danger ? colors.danger : colors.amber} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!sub && <Text style={styles.actionSub}>{sub}</Text>}
      </View>
      {!danger && <Icon name="chevron-right" size={18} color={colors.textDim} />}
    </Pressable>
  );
}

// Horizontal count bar for the listening charts: width is the row's share of
// the top count, so the #1 row always reads full and the rest scale honestly.
function CountBar({ rank, title, sub, count, max, unit, onPress, art }) {
  return (
    <Pressable style={styles.chartRow} onPress={onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={`${title}, ${count} ${unit}${onPress ? ", tap to play" : ""}`}>
      <Text style={styles.chartRank}>{rank}</Text>
      {art !== undefined && (art ? <SmartImage uri={art} style={styles.chartArt} contain={false} /> : <View style={[styles.chartArt, styles.chartArtEmpty]}><Icon name="music" size={12} color={colors.textFaint} /></View>)}
      <View style={{ flex: 1 }}>
        <View style={styles.chartTop}>
          <Text style={styles.chartTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.chartCount}>{count} {unit}</Text>
        </View>
        {!!sub && <Text style={styles.chartSub} numberOfLines={1}>{sub}</Text>}
        <View style={styles.chartTrack}>
          <View style={[styles.chartFill, { width: `${Math.max(4, Math.round((count / (max || 1)) * 100))}%` }]} />
        </View>
      </View>
      {onPress && <Icon name="play" size={13} color={colors.amber} />}
    </Pressable>
  );
}

// The You tab: the user's own analytics page. Everything on it is DERIVED from
// real activity (logged shows, server-backed play history, uploaded photos,
// saved playlists, Going pins) - nothing is ever fabricated to look busy.
export default function YouScreen({ feed, onLogin, onLogout, onAdmin, onAddTourDate, onRequestArtist, onEditProfile, onOpenProfile, onOpen, onActivity, onInbox, onCalendar, onPlay, onOpenPhotos, onOpenArtist }) {
  const { session, logsByUser, unreadNotifications, inboxUnread, playHistory, genreOfArtist, goingFor, myPlaylists, loadMyPlaylists } = useStore();
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
        // Case-fold so "Pop" and "pop" count as one genre, not two chips.
        if (g) { const k = g.toLowerCase(); genres[k] = (genres[k] || 0) + 1; }
      }
      if (p.title) {
        const key = `${(p.artist || "").toLowerCase()}|${p.title.toLowerCase()}`;
        (songs[key] ||= { title: p.title, artist: p.artist, art: p.art || null, count: 0 }).count += 1;
        if (p.art && !songs[key].art) songs[key].art = p.art;
      }
    }
    const top = (m) => Object.values(m).sort((a, b) => b.count - a.count).slice(0, 5);
    return {
      totalPlays: plays.length,
      topArtists: top(artists),
      topSongs: top(songs),
      topGenres: Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 4),
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

  // ---- gallery: every photo the user has posted ----
  const gallery = useMemo(() => mine.flatMap((l) => (l.photos || []).map((uri) => ({ uri, postId: l.id }))), [mine]);

  // ---- upcoming: Going pins with a live countdown (shared showTime math) ----
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
  const playArtistTop = (a) => onPlay?.({ kind: "track", title: a.name, artist: a.name, art: a.art || null });
  const playPlaylist = (pl) => { const q = (pl.tracks || []).filter((t) => t.title); if (q.length) onPlay?.(q[0], q); };

  // Logged out - show a login prompt instead of a fake profile.
  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.loggedOut}>
          <View style={styles.avatar}>
            <Icon name="you" size={28} color={colors.textDim} />
          </View>
          <Text style={styles.name}>You&apos;re logged out</Text>
          <Text style={styles.handle}>Log in to keep a diary and post reviews.</Text>
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

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.profile}>
        <Avatar user={session} size={64} onPress={() => onOpenProfile?.(session.id)} />
        <Text style={styles.name}>{session.name}</Text>
        <Text style={styles.handle}>@{session.handle}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleTxt}>{roleLabel}</Text>
        </View>
        <Pressable style={styles.viewProfile} onPress={() => onOpenProfile?.(session.id)}>
          <Text style={styles.viewProfileTxt}>View my profile</Text>
        </Pressable>
      </View>

      {/* Real counts only: shows logged, distinct artists seen, distinct rooms. */}
      <View style={styles.statsRow}>
        <Stat value={mine.length} label="SHOWS" />
        <Stat value={live.artists} label="ARTISTS" />
        <Stat value={live.venues} label="VENUES" />
      </View>

      <View style={styles.recap}>
        <View style={styles.recapKickerRow}>
          <Icon name="star" size={12} color={colors.amber} />
          <Text style={styles.recapKicker}>WRAPPED</Text>
        </View>
        <Text style={styles.recapTitle}>{year} in Concerts</Text>
        <Text style={styles.recapBody}>
          {showsThisYear === 0 ? "No shows logged this year yet. The pit is waiting." : (
            <>
              {showsThisYear} show{showsThisYear === 1 ? "" : "s"} so far
              {live.topGenre ? ` · most-seen genre: ${live.topGenre}` : ""}
              {live.best ? <> · best night rated <Text style={{ color: colors.gold }}>{live.best.toFixed(1)}</Text></> : null}
            </>
          )}
        </Text>
      </View>

      {/* ---- YOUR SOUND: the listening analytics ---- */}
      <Text style={styles.sectionLabel}>YOUR SOUND · {sound.totalPlays} PLAYS</Text>
      {sound.totalPlays === 0 ? (
        <Text style={styles.emptyHint}>Play songs from any artist page and your charts build themselves.</Text>
      ) : (
        <>
          {sound.topGenres.length > 0 && (
            <View style={styles.genreRow}>
              {sound.topGenres.map(([g, n], i) => (
                <View key={g} style={[styles.genreChip, i === 0 && styles.genreChipTop]}>
                  <Text style={[styles.genreTxt, i === 0 && { color: "#1A1206" }]}>{g.replace(/\b\w/g, (c) => c.toUpperCase())}</Text>
                  <Text style={[styles.genreCount, i === 0 && { color: "#1A1206" }]}>{n}</Text>
                </View>
              ))}
            </View>
          )}
          {sound.topArtists.length > 0 && (
            <View style={styles.chartCard}>
              <Text style={styles.chartLabel}>MOST PLAYED ARTISTS</Text>
              {sound.topArtists.map((a, i) => (
                <CountBar key={a.name} rank={i + 1} title={a.name} count={a.count} max={sound.topArtists[0].count} unit={a.count === 1 ? "play" : "plays"} art={a.art} onPress={onOpenArtist ? () => onOpenArtist(a.name) : () => playArtistTop(a)} />
              ))}
            </View>
          )}
          {sound.topSongs.length > 0 && (
            <View style={styles.chartCard}>
              <Text style={styles.chartLabel}>MOST PLAYED SONGS</Text>
              {sound.topSongs.map((s, i) => (
                <CountBar key={s.artist + s.title} rank={i + 1} title={s.title} sub={s.artist} count={s.count} max={sound.topSongs[0].count} unit={s.count === 1 ? "play" : "plays"} art={s.art} onPress={onPlay ? () => playTrack(s) : undefined} />
              ))}
            </View>
          )}
        </>
      )}

      {/* ---- YOUR GALLERY: every photo you've posted, opens the viewer ---- */}
      {gallery.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>YOUR GALLERY · {gallery.length}</Text>
          <View style={styles.galleryGrid}>
            {gallery.slice(0, 12).map((p, i) => (
              <SmartImage key={p.uri + i} uri={p.uri} style={styles.galleryCell} contain={false}
                onPress={onOpenPhotos ? () => onOpenPhotos(gallery.map((x) => ({ uri: x.uri, by: session.name })), i, p.postId) : undefined} />
            ))}
          </View>
        </>
      )}

      {/* ---- PLAYLISTS ---- */}
      {playlists.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>PLAYLISTS · {playlists.length}</Text>
          {playlists.map((pl) => (
            <Pressable key={pl.id} style={styles.playlistRow} onPress={() => playPlaylist(pl)} accessibilityRole="button" accessibilityLabel={`Play playlist ${pl.name}`}>
              <View style={styles.actionIcon}><Icon name="music" size={16} color={colors.amber} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionLabel} numberOfLines={1}>{pl.name}</Text>
                <Text style={styles.actionSub}>{(pl.tracks || []).length} songs</Text>
              </View>
              <Icon name="play" size={14} color={colors.amber} />
            </Pressable>
          ))}
        </>
      )}

      {/* ---- GOING TO: live countdowns ---- */}
      {upcoming.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>GOING TO · {upcoming.length}</Text>
          {upcoming.map((p) => {
            const left = showDateMs(p.date) - nowTick;
            return (
              <Pressable key={p.key} style={styles.goingRow} onPress={() => onOpen?.(p)}>
                <View style={styles.actionIcon}><Icon name="calendar" size={15} color={colors.amber} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionLabel} numberOfLines={1}>{p.artist}</Text>
                  <Text style={styles.actionSub} numberOfLines={1}>{p.venue}{p.date ? ` · ${p.date}` : ""}</Text>
                </View>
                <Text style={styles.goingT}>{left <= 0 ? "TONIGHT" : fmtCountdown(left)}</Text>
              </Pressable>
            );
          })}
        </>
      )}

      {(onActivity || onInbox || onCalendar) && (
        <>
          <Text style={styles.sectionLabel}>SOCIAL</Text>
          {onActivity && <ActionRow icon="bell" label="Activity" sub={notif ? `${notif} new` : "Follows, likes, replies"} onPress={onActivity} />}
          {onInbox && <ActionRow icon="mail" label="Inbox" sub={unread ? `${unread} unread` : "Your messages"} onPress={onInbox} />}
          {onCalendar && <ActionRow icon="calendar" label="Calendar" sub="Upcoming shows + your plans" onPress={onCalendar} />}
        </>
      )}

      {/* role-based tools */}
      <Text style={styles.sectionLabel}>ACCOUNT</Text>
      <ActionRow icon="edit" label="Edit profile" sub="Photo, name, bio, genres" onPress={onEditProfile} />
      {isMod(session.role) && (
        <ActionRow icon="shield" label={isStaff(session.role) ? "Moderation console" : "Moderation"} sub={isStaff(session.role) ? "Reports, members, content, ads" : "Reports, members, content"} onPress={onAdmin} />
      )}
      {isArtist(session.role) && (
        <ActionRow icon="calendar" label="Post tour dates (bulk)" sub="Schedule a batch + ticket links" onPress={onAddTourDate} />
      )}
      {session.role === "fan" && (
        <ActionRow icon="shield" label="Request artist account" sub="Admin-reviewed verification" onPress={onRequestArtist} />
      )}
      <ActionRow icon="logout" label="Log out" onPress={onLogout} danger />

      <Text style={styles.sectionLabel}>YOUR DIARY · {mine.length}</Text>
      <Text style={styles.diaryHint}>Every show you've logged. Tap one to see the full review.</Text>
      {mine.length === 0 && <Text style={styles.diaryEmpty}>No shows yet. Tap the + to log your first one.</Text>}
      {mine.map((l) => {
        const parts = (l.date || "").split(" · ");
        return (
          <Pressable key={l.id} style={styles.diaryRow} onPress={() => onOpen?.(l)}>
            <View style={styles.diaryStub}>
              <Text style={styles.diaryStubMon}>{parts[1] || ""}</Text>
              <Text style={styles.diaryStubDay}>{parts[2] || ""}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.diaryArtist} numberOfLines={1}>{l.artist}</Text>
              <Text style={styles.diaryVenue} numberOfLines={1}>{l.venue} · {l.city}</Text>
            </View>
            <View style={styles.diaryScorePill}>
              <Icon name="star" size={11} color={colors.gold} />
              <Text style={styles.diaryScore}>{(l.overall || 0).toFixed(1)}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  loggedOut: { alignItems: "center", marginTop: 60, gap: 6 },
  profile: { alignItems: "center", marginTop: 8 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  avatarTxt: { color: colors.amber, fontWeight: "800", fontFamily: mono, fontSize: 16 },
  name: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 10 },
  handle: { color: colors.textDim, fontSize: 13, marginTop: 2, textAlign: "center" },
  roleBadge: { marginTop: 10, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  roleTxt: { color: colors.amber, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  viewProfile: { marginTop: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 8 },
  viewProfileTxt: { color: colors.amber, fontSize: 13, fontWeight: "600" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center", marginTop: 22 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },

  statsRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    marginTop: 20,
    paddingVertical: 16,
  },
  stat: { flex: 1, alignItems: "center" },
  statVal: { color: colors.text, fontFamily: mono, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1, marginTop: 4, fontWeight: "700" },

  recap: { marginTop: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev, padding: 18 },
  recapKickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  recapKicker: { color: colors.amber, fontSize: 11, letterSpacing: 2, fontWeight: "800" },
  recapTitle: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 6 },
  recapBody: { color: colors.textDim, fontSize: 14, lineHeight: 21, marginTop: 8 },

  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 24, marginBottom: 10 },
  emptyHint: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },

  genreRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  genreChip: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  genreChipTop: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  genreTxt: { color: colors.text, fontSize: 12.5, fontWeight: "800" },
  genreCount: { color: colors.textFaint, fontFamily: mono, fontSize: 11, fontWeight: "700" },

  chartCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 12, ...shadow.card },
  chartLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: 10 },
  chartRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  chartRank: { color: colors.textFaint, fontFamily: mono, fontSize: 12, fontWeight: "800", width: 16, textAlign: "center" },
  chartArt: { width: 34, height: 34, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  chartArtEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.lineSoft },
  chartTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  chartTitle: { color: colors.text, fontSize: 13.5, fontWeight: "700", flex: 1 },
  chartCount: { color: colors.textDim, fontFamily: mono, fontSize: 11 },
  chartSub: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  chartTrack: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden", marginTop: 5 },
  chartFill: { height: 5, borderRadius: 3, backgroundColor: colors.amber },

  galleryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  galleryCell: { width: "31.5%", aspectRatio: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft },

  playlistRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  goingRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  goingT: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },

  action: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 10 },
  actionIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  actionLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  actionSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },

  diaryHint: { color: colors.textDim, fontSize: 12, marginTop: -6, marginBottom: 12 },
  diaryEmpty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },
  diaryRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  diaryStub: { width: 46, height: 46, borderRadius: 8, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  diaryStubMon: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "800" },
  diaryStubDay: { color: colors.textFaint, fontFamily: mono, fontSize: 11 },
  diaryArtist: { color: colors.text, fontSize: 15, fontWeight: "700" },
  diaryVenue: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  diaryScorePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  diaryScore: { color: colors.gold, fontFamily: mono, fontSize: 14, fontWeight: "700" },
});
