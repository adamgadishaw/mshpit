import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Easing, Platform, Share } from "react-native";
import { colors, mono, radius, shadow, displayFont, space } from "../theme";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import SmartImage from "../components/SmartImage";
import SoundDonut, { DONUT_PALETTE } from "../components/SoundDonut";
import { BadgeRow } from "../components/Badge";
import { useStore, isStaff, isMod } from "../store";
import { formatDate } from "../domain/dates.mjs";
import { concertMemoryShareText, selectConcertMemories } from "../domain/concertMemories.mjs";
import { selectRediscoverTracks } from "../domain/listeningRediscovery.mjs";
import { profileManagementAction } from "../domain/artistWorkspace.mjs";
import { selectConcertReviews } from "../domain/profileTimeline.mjs";
import { useProfileHistory } from "../features/profileHistory/useProfileHistory";

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

// The You tab is the private dashboard: listening, memories, nearby activity,
// and account tools. The public Profile screen owns the diary, media wall,
// playlists, and posts so those features have one canonical home.
export default function YouScreen({ onLogin, onLogout, onManageProfile, onSettings, onAdmin, onRequestArtist, onOpenProfile, onOpen, onActivity, onInbox, onCalendar, onListeningHistory, onOpenNearby, homeCity, onPlay, onOpenArtist }) {
  const { session, logsByUser, unreadNotifications, inboxUnread, playHistory, genreOfArtist, userBadges, userPoints } = useStore();
  const history = useProfileHistory({ accountId: session?.id, targetId: session?.id, enabled: !!session });
  const cachedMine = session ? logsByUser(session.id) : [];
  const mine = session && (history.posts.length || history.status === "ready") ? history.posts : cachedMine;
  const concertLogs = selectConcertReviews(mine);
  const notif = session ? unreadNotifications() : 0;
  const unread = session ? inboxUnread() : 0;
  const profileAction = profileManagementAction(session);
  const [memoryStatus, setMemoryStatus] = useState("");

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
    for (const l of concertLogs) {
      if (l.artist) { artists.add(l.artist.toLowerCase()); const g = genreOfArtist(l.artist); if (g) { const k = g.toLowerCase(); genres[k] = (genres[k] || 0) + 1; } }
      if (l.venue) venues.add(l.venue.toLowerCase());
      if (best == null || (l.overall || 0) > best) best = l.overall || 0;
    }
    const topGenre = Object.entries(genres).sort((a, b) => b[1] - a[1])[0];
    return { artists: artists.size, venues: venues.size, topGenre: topGenre ? topGenre[0] : null, best };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);

  const memories = useMemo(
    () => selectConcertMemories(mine, { ownerId: session?.id, now: Date.now(), limit: 2 }),
    [mine, session?.id],
  );
  const rediscover = useMemo(
    () => selectRediscoverTracks(playHistory, { now: Date.now(), limit: 8 }),
    [playHistory],
  );

  const playTrack = (t) => onPlay?.({ kind: "track", title: t.title, artist: t.artist, art: t.art || null });
  const shareMemory = async (memory) => {
    try {
      setMemoryStatus(`Opening share options for ${memory.artist}.`);
      const result = await Share.share({ title: "Concert memory", message: concertMemoryShareText(memory) });
      setMemoryStatus(result.action === Share.dismissedAction ? "Sharing canceled." : "Concert memory shared.");
    } catch {
      setMemoryStatus("That concert memory could not be shared. Please try again.");
    }
  };

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
  const historyCount = (value) => `${value}${history.complete ? "" : "+"}`;
  const year = new Date().getFullYear();
  const showsThisYear = concertLogs.filter((l) => String(l.date || "").includes(String(year))).length;
  const points = userPoints(session);
  const badges = userBadges(session);
  const publicProfileLabel = profileAction.destination === "artistHub" ? "View public artist page" : "View public profile";
  const publicProfileDetail = profileAction.destination === "artistHub"
    ? "See the official page exactly as fans do"
    : "Your diary, photos, playlists, and public posts";
  const podium = sound.topArtists.slice(0, 3);
  const restArtists = sound.topArtists.slice(3, 6);
  const MEDAL = [colors.gold, "#c9ccd4", "#c98d5a"];

  // Compact toolbelt instead of a wall of menu rows.
  const tools = [
    { icon: profileAction.icon, label: profileAction.title, onPress: onManageProfile },
    { icon: "menu", label: "Settings", onPress: onSettings },
    { icon: "bell", label: "Activity", badge: notif, onPress: onActivity },
    { icon: "mail", label: "Inbox", badge: unread, onPress: onInbox },
    { icon: "calendar", label: "Calendar", onPress: onCalendar },
    isMod(session.role) && { icon: "shield", label: "Moderation", onPress: onAdmin },
    session.role === "fan" && { icon: "shield", label: "Claim artist profile", onPress: onRequestArtist },
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
              {[[historyCount(concertLogs.length), "SHOWS"], [historyCount(live.artists), "ARTISTS"], [historyCount(live.venues), "VENUES"], [sound.totalPlays, "PLAYS"]].map(([v, l]) => (
                <View key={l} style={styles.heroStat}>
                  <Text style={styles.heroStatVal}>{v}</Text>
                  <Text style={styles.heroStatLabel}>{l}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.wrappedLine}>
              <Text style={{ color: colors.amber, fontWeight: "800" }}>{year} · </Text>
              {showsThisYear === 0 ? "No shows loaded for this year yet. The pit is waiting." : (
                <>
                  {history.complete ? showsThisYear : `at least ${showsThisYear}`} show{showsThisYear === 1 ? "" : "s"}
                  {live.topGenre ? ` · most-seen: ${live.topGenre.replace(/\b\w/g, (c) => c.toUpperCase())}` : ""}
                  {live.best ? <> · best night <Text style={{ color: colors.gold, fontFamily: mono }}>{live.best.toFixed(1)}</Text></> : null}
                </>
              )}
            </Text>
            <Pressable
              style={styles.publicProfileLink}
              onPress={() => onOpenProfile?.(session.id)}
              accessibilityRole="button"
              accessibilityLabel={`${publicProfileLabel}. ${publicProfileDetail}`}
            >
              <View style={styles.publicProfileIcon}><Icon name="external" size={16} color={colors.amber} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.publicProfileTitle}>{publicProfileLabel}</Text>
                <Text style={styles.publicProfileSub} numberOfLines={2}>{publicProfileDetail}</Text>
              </View>
              <Icon name="chevron-right" size={17} color={colors.textDim} />
            </Pressable>
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

      {memories.length > 0 && (
        <Reveal delay={70}>
          <Text style={styles.sectionLabel}>CONCERT MEMORIES</Text>
          <Text style={styles.scopeCopy}>From your still-visible concert diary. You choose whether to open or share each memory.</Text>
          <View style={styles.memoryGrid}>
            {memories.map((memory) => (
              <View key={memory.id} style={styles.memoryCard}>
                <View style={styles.memoryTop}>
                  <View style={styles.memoryIcon}><Icon name="ticket" size={18} color={memory.kind === "anniversary" ? colors.magenta : colors.amber} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.memoryKind}>{memory.kind === "anniversary" ? "ANNIVERSARY" : "REDISCOVER"}</Text>
                    <Text style={styles.memoryDetail}>{memory.detail}</Text>
                  </View>
                </View>
                <Text style={styles.memoryArtist} numberOfLines={1}>{memory.artist}</Text>
                <Text style={styles.memoryVenue} numberOfLines={2}>{memory.venue}{memory.city ? ` · ${memory.city}` : ""} · {formatDate(memory.date, memory.date)}</Text>
                <View style={styles.memoryActions}>
                  <Pressable style={[styles.memoryAction, !onOpen && styles.memoryActionDisabled]} onPress={() => onOpen?.(memory.log)} disabled={!onOpen} accessibilityRole="button" accessibilityLabel={`Open memory for ${memory.artist}`} accessibilityState={{ disabled: !onOpen }}>
                    <Icon name="external" size={13} color={colors.amber} />
                    <Text style={styles.memoryActionText}>Open memory</Text>
                  </Pressable>
                  <Pressable style={styles.memoryAction} onPress={() => shareMemory(memory)} accessibilityRole="button" accessibilityLabel={`Share memory for ${memory.artist}`}>
                    <Icon name="share" size={13} color={colors.amber} />
                    <Text style={styles.memoryActionText}>Share memory</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
          {!!memoryStatus && <Text style={styles.actionStatus} accessibilityLiveRegion="polite">{memoryStatus}</Text>}
        </Reveal>
      )}

      {/* ---- YOUR SOUND: donut + legend, podium, song chart ---- */}
      <Reveal delay={90}>
        <Text style={styles.sectionLabel}>YOUR SOUND</Text>
        <Pressable style={styles.historyLink} onPress={onListeningHistory} disabled={!onListeningHistory} accessibilityRole="button" accessibilityLabel="Open listening history" accessibilityState={{ disabled: !onListeningHistory }}>
          <View style={styles.historyLinkIcon}><Icon name="clock" size={17} color={colors.amber} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.historyLinkTitle}>Listening history</Text>
            <Text style={styles.historyLinkSub}>Replay recent songs and load older plays</Text>
          </View>
          <Icon name="chevron-right" size={17} color={colors.textDim} />
        </Pressable>
        {sound.totalPlays === 0 ? (
          <View style={styles.card}><Text style={styles.emptyHint}>Play songs from any artist page and your charts build themselves.</Text></View>
        ) : (
          <View style={styles.card}>
            <View style={styles.donutRow}>
              <View style={styles.donutSlot}>
                <SoundDonut data={sound.genres.length ? sound.genres : [{ label: "Unsorted", count: sound.totalPlays }]} size={172} centerTop={String(sound.totalPlays)} centerSub="plays" />
              </View>
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

      {rediscover.length > 0 && (
        <Reveal delay={140}>
          <Text style={styles.sectionLabel}>REDISCOVER</Text>
          <Text style={styles.scopeCopy}>From the listening history available on Pit—not a lifetime total.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rediscoverRail} accessibilityLabel="Tracks to rediscover">
            {rediscover.map((track) => (
              <Pressable key={`${track.artist}|${track.title}`} style={styles.rediscoverCard} onPress={() => onPlay?.(track)} disabled={!onPlay} accessibilityRole="button" accessibilityLabel={`Play ${track.title} by ${track.artist}. ${track.ageLabel}`} accessibilityState={{ disabled: !onPlay }}>
                {track.art ? <SmartImage uri={track.art} style={styles.rediscoverArt} contain={false} accessible={false} /> : <View style={[styles.rediscoverArt, styles.songArtEmpty]}><Icon name="music" size={20} color={colors.textFaint} /></View>}
                <Text style={styles.rediscoverTitle} numberOfLines={1}>{track.title}</Text>
                <Text style={styles.rediscoverArtist} numberOfLines={1}>{track.artist}</Text>
                <Text style={styles.rediscoverAge} numberOfLines={1}>{track.ageLabel}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Reveal>
      )}

      {/* ---- TOOLBELT: one compact grid instead of stacked menu rows ---- */}
      <Reveal delay={180}>
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
  publicProfileLink: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  publicProfileIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  publicProfileTitle: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  publicProfileSub: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, marginTop: 2 },

  nearCard: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16, backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.amber, paddingHorizontal: 14, paddingVertical: 13, ...shadow.card },
  nearIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  nearTitle: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  nearSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginTop: space(6), marginBottom: space(2) },
  subLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 16, ...shadow.card },
  emptyHint: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },
  scopeCopy: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: -5, marginBottom: 10 },
  memoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  memoryCard: { flexGrow: 1, flexBasis: 260, minWidth: 0, gap: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, ...shadow.card },
  memoryTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  memoryIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  memoryKind: { color: colors.textFaint, fontSize: 9.5, letterSpacing: 1.3, fontWeight: "900" },
  memoryDetail: { color: colors.magenta, fontSize: 11.5, fontWeight: "800", marginTop: 2 },
  memoryArtist: { color: colors.text, fontSize: 16, fontWeight: "900" },
  memoryVenue: { color: colors.textDim, fontSize: 11.5, lineHeight: 16 },
  memoryActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  memoryAction: { minHeight: 44, flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  memoryActionDisabled: { opacity: 0.45 },
  memoryActionText: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  actionStatus: { color: colors.textDim, fontSize: 11.5, marginTop: 8 },
  historyLink: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 10, padding: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  historyLinkIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  historyLinkTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  historyLinkSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  rediscoverRail: { gap: 10, paddingRight: 8 },
  rediscoverCard: { width: 148, minHeight: 210, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  rediscoverArt: { width: "100%", aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  rediscoverTitle: { color: colors.text, fontSize: 12.5, fontWeight: "800", marginTop: 8 },
  rediscoverArtist: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  rediscoverAge: { color: colors.amber, fontFamily: mono, fontSize: 9.5, marginTop: 6 },

  donutRow: { flexDirection: "row", alignItems: "center", gap: 18, flexWrap: "wrap" },
  // Same fix as Discover's chart: flex-basis 0 prevented the wrap and let the
  // fixed-size donut overflow instead.
  legend: { flexGrow: 1, flexBasis: 150, minWidth: 150, gap: space(2) },
  donutSlot: { flexShrink: 0 },
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

  toolGrid: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  // No `flexGrow`. With it, the tiles left over on the final row stretched to
  // fill the space, so seven tools rendered as four even ones above three of
  // three different widths. A fixed column keeps every tile the same size and
  // lets a short last row simply end early, which is what a grid should do.
  tool: { width: "23.5%", minWidth: 86, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: space(3), alignItems: "center", gap: space(1.5) },
  toolIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  toolBadge: { position: "absolute", top: -4, right: -6, backgroundColor: colors.magenta, borderRadius: 9, minWidth: 17, height: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  toolBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800", fontFamily: mono },
  toolLabel: { color: colors.text, fontSize: 11.5, fontWeight: "700" },
});
