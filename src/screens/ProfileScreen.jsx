import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Linking } from "react-native";
import { colors, mono, radius, roleColor } from "../theme";
import { useStore } from "../store";
import { listenUrl } from "../seed/songs";
import { artistMeta } from "../seed/ingested";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import SpinningRecord from "../components/SpinningRecord";
import TicketStub from "../components/TicketStub";
import { BadgeRow } from "../components/Badge";

function Stat({ value, label, onPress }) {
  return (
    <Pressable style={styles.stat} onPress={onPress} disabled={!onPress}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function TrebleBass({ kind, song, playing, onPlay, onOpenArtist }) {
  const treble = kind === "treble";
  const c = treble ? colors.amber : colors.magenta;
  const art = song ? artistMeta(song.artist)?.photo : null;
  return (
    <Pressable style={[styles.tb, { borderColor: c }]} onPress={song ? onPlay : undefined}>
      <Text style={[styles.tbKind, { color: c }]}>{treble ? "TREBLE" : "BASS"}</Text>
      <View style={styles.tbRecord}>
        <SpinningRecord size={72} playing={playing} color={c} art={art} />
      </View>
      {song ? (
        <>
          <Text style={styles.tbTitle} numberOfLines={1}>{song.title}</Text>
          <Pressable onPress={() => onOpenArtist?.(song.artist)}>
            <Text style={styles.tbArtist} numberOfLines={1}>{song.artist}</Text>
          </Pressable>
          <Pressable style={styles.tbListen} onPress={() => Linking.openURL(listenUrl(song))}>
            <Icon name="play" size={11} color={c} />
            <Text style={[styles.tbListenTxt, { color: c }]}>Listen</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.tbEmpty}>{treble ? "top pick" : "underdog pick"}</Text>
      )}
    </Pressable>
  );
}

// MySpace-style profile - banner, pfp, now-playing, theme song, Treble/Bass top
// artists, planned shows, reviews. Built to make people findable and followable.
export default function ProfileScreen({ userId, onClose, onOpenShow, onOpenArtist, onOpenVenue, onEditProfile, onPreview, onMessage, onReport, onOpenPhotos, onPlay, onOpenFollowList }) {
  const { session, userById, logsByUser, isFollowing, follow, unfollow, followerCount, followingCount, goingFor, userBadges, sharedShows, userPlaylists, loadUser, isBlocked, blockUser, unblockUser } = useStore();
  const user = userById(userId);
  const [playlists, setPlaylists] = useState([]);
  const [missing, setMissing] = useState(false);
  useEffect(() => { if (userId) userPlaylists(userId).then(setPlaylists); }, [userId]);
  // Always refresh from the server: fills real follower counts, and makes profiles
  // we've never cached (a follower from a notification) open instead of blanking.
  useEffect(() => {
    setMissing(false);
    if (userId) loadUser(userId).then((u) => { if (!u && !userById(userId)) setMissing(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  if (!user) {
    return (
      <View style={styles.wrap}>
        <View style={styles.topbar}>
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
            <View style={styles.backCircle}><Icon name="chevron-left" size={20} color={colors.text} /></View>
          </Pressable>
          <Text style={styles.topTitle}>{missing ? "Not found" : "Profile"}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.missingBox}>
          {missing ? (
            <>
              <Icon name="you" size={30} color={colors.textFaint} />
              <Text style={styles.missingTitle}>This account isn't available</Text>
              <Text style={styles.missingSub}>It may have been deleted, or the link is broken.</Text>
            </>
          ) : (
            <Text style={styles.missingSub}>Loading profile...</Text>
          )}
        </View>
      </View>
    );
  }

  const logs = logsByUser(user.id);
  const planned = goingFor(user.id);
  const isSelf = session?.id === user.id;
  // Play a saved playlist: first track opens the bar with the whole list queued.
  const playPlaylist = (pl) => { const q = (pl.tracks || []).filter((t) => t.url || t.preview); if (q.length) onPlay?.(q[0], q); };
  // "Crossed paths", shows you've both been to (and artists you've both seen).
  const crossed = !isSelf && session ? sharedShows(user.id) : { shows: [], artists: [] };

  // Photo gallery, every photo this person attached to a post, newest first.
  // On someone else's profile we only show ones they marked public; you always
  // see all of your own. Each remembers the show it came from.
  const gallery = logs.flatMap((l) =>
    (isSelf || l.photosPublic !== false ? (l.photos || []) : []).map((uri) => ({ uri, log: l }))
  );
  const following = isFollowing(user.id);
  const roleLabel = user.role === "admin" ? "ADMIN" : user.role === "artist" ? "VERIFIED ARTIST" : "FAN";
  const [playing, setPlaying] = useState(null);
  const playSong = (slot, song) => {
    if (!song) return;
    setPlaying((p) => (p === slot ? null : slot));
    onPreview?.(song.title, song.artist);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.topbar}>
        <Pressable style={styles.backBtn} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <View style={styles.backCircle}><Icon name="chevron-left" size={20} color={colors.text} /></View>
        </Pressable>
        <Text style={styles.topTitle}>@{user.handle}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* banner + avatar */}
        <View style={styles.banner}>
          {user.banner ? <Image source={{ uri: user.banner }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={styles.bannerFallback} />}
          <View style={styles.bannerShade} />
        </View>
        <View style={styles.head}>
          <View style={styles.avatarWrap}><Avatar user={user} size={88} /></View>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{user.name}</Text>
            <BadgeRow badges={userBadges(user)} size={20} />
          </View>
          <Text style={[styles.handle, roleColor(user.role) && { color: roleColor(user.role), fontWeight: "800" }]}>@{user.handle}</Text>
          <View style={styles.roleBadge}><Text style={styles.roleTxt}>{roleLabel}</Text></View>
          {!!user.bio && <Text style={styles.bio}>{user.bio}</Text>}

          {isSelf ? (
            <Pressable style={styles.editBtn} onPress={onEditProfile}>
              <Icon name="edit" size={15} color={colors.amber} />
              <Text style={styles.editTxt}>Edit profile</Text>
            </Pressable>
          ) : session && isBlocked(user.id) ? (
            <View style={styles.blockedBox}>
              <Text style={styles.blockedTxt}>You've blocked this account. They can't message you, follow you, or see your posts.</Text>
              <Pressable style={styles.unblockBtn} onPress={() => unblockUser(user.id)}>
                <Text style={styles.unblockTxt}>Unblock</Text>
              </Pressable>
            </View>
          ) : (
            session && (
              <View style={styles.actionRow}>
                <Pressable style={[styles.followBtn, following && styles.followingBtn]} onPress={() => (following ? unfollow(user.id) : follow(user.id))}>
                  {!following && <Icon name="user-plus" size={15} color="#1A1206" />}
                  <Text style={[styles.followTxt, following && styles.followingTxt]}>{following ? "Following" : "Follow"}</Text>
                </Pressable>
                <Pressable style={styles.msgBtn} onPress={() => onMessage?.(user.id)}>
                  <Icon name="comment" size={15} color={colors.amber} />
                  <Text style={styles.msgTxt}>Message</Text>
                </Pressable>
                <Pressable style={styles.blockBtn} onPress={() => blockUser(user.id)} hitSlop={6} accessibilityLabel="Block user">
                  <Icon name="lock" size={15} color={colors.danger} />
                </Pressable>
              </View>
            )
          )}
        </View>

        <View style={styles.statsRow}>
          <Stat value={logs.length} label="REVIEWS" />
          <Stat value={planned.length} label="GOING" />
          <Stat value={followerCount(user.id)} label="FOLLOWERS" onPress={() => onOpenFollowList?.(user.id, "followers")} />
          <Stat value={followingCount(user.id)} label="FOLLOWING" onPress={() => onOpenFollowList?.(user.id, "following")} />
        </View>

        {/* Crossed paths, the concert-overlap tracker. */}
        {!isSelf && session && (crossed.shows.length > 0 || crossed.artists.length > 0) && (
          <Pressable
            style={styles.crossed}
            onPress={crossed.shows.length ? () => onOpenShow?.(crossed.shows[0]) : undefined}
          >
            <View style={styles.crossedIcon}><Icon name="ticket" size={17} color={colors.magenta} /></View>
            {crossed.shows.length > 0 ? (
              <View style={{ flex: 1 }}>
                <Text style={styles.crossedTitle}>
                  You've crossed paths at <Text style={styles.crossedNum}>{crossed.shows.length}</Text> {crossed.shows.length === 1 ? "show" : "shows"}
                </Text>
                <Text style={styles.crossedSub} numberOfLines={1}>
                  {crossed.shows.slice(0, 3).map((s) => s.artist).join(" · ")}{crossed.shows.length > 3 ? " …" : ""}
                </Text>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Text style={styles.crossedTitle}>
                  You've both seen <Text style={styles.crossedNum}>{crossed.artists.length}</Text> {crossed.artists.length === 1 ? "artist" : "artists"} live
                </Text>
                <Text style={styles.crossedSub} numberOfLines={1}>{crossed.artists.slice(0, 3).join(" · ")}</Text>
              </View>
            )}
            {crossed.shows.length > 0 && <Icon name="chevron-right" size={16} color={colors.textDim} />}
          </Pressable>
        )}

        {/* playlists, saved listening sessions (tap to play the whole set) */}
        {playlists.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>PLAYLISTS · {playlists.length}</Text>
            {playlists.map((pl) => (
              <Pressable key={pl.id} style={styles.playlist} onPress={() => playPlaylist(pl)}>
                <View style={styles.playlistIcon}><Icon name="play" size={16} color={colors.amber} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.playlistName} numberOfLines={1}>{pl.name}</Text>
                  <Text style={styles.playlistSub} numberOfLines={1}>{pl.tracks.length} song{pl.tracks.length === 1 ? "" : "s"} · {pl.tracks.slice(0, 3).map((t) => t.artist).filter(Boolean).join(", ")}</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textDim} />
              </Pressable>
            ))}
          </>
        )}

        {/* photo gallery, a wall of every shot from their nights */}
        {gallery.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>PHOTOS · {gallery.length}</Text>
            <View style={styles.gallery}>
              {gallery.map((g, i) => (
                <Pressable key={i} style={styles.galleryCell} onPress={() => onOpenPhotos?.(gallery.map((x) => ({ uri: x.uri, by: user.name })), i)}>
                  <Image source={{ uri: g.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* on rotation: now playing + treble/bass with spinning records */}
        {!!user.nowPlaying && (
          <Pressable style={styles.nowCard} onPress={() => playSong("now", user.nowPlaying)}>
            <SpinningRecord size={44} playing={playing === "now"} color={colors.good} art={artistMeta(user.nowPlaying.artist)?.photo} />
            <View style={{ flex: 1 }}>
              <Text style={styles.nowLabel}>NOW PLAYING</Text>
              <Text style={styles.nowTxt} numberOfLines={1}>{user.nowPlaying.title} · {user.nowPlaying.artist}</Text>
            </View>
            <Pressable style={styles.listenBtn} onPress={() => Linking.openURL(listenUrl(user.nowPlaying))}>
              <Text style={styles.listenTxt}>Listen</Text>
            </Pressable>
          </Pressable>
        )}

        {(user.treble || user.bass) && (
          <>
            <Text style={styles.sectionLabel}>TREBLE & BASS</Text>
            <Text style={styles.hint}>their top pick and their underdog. tap to spin, then listen.</Text>
            <View style={styles.topRow}>
              <TrebleBass kind="treble" song={user.treble} playing={playing === "treble"} onPlay={() => playSong("treble", user.treble)} onOpenArtist={onOpenArtist} />
              <TrebleBass kind="bass" song={user.bass} playing={playing === "bass"} onPlay={() => playSong("bass", user.bass)} onOpenArtist={onOpenArtist} />
            </View>
          </>
        )}

        {/* planned shows */}
        <Text style={styles.sectionLabel}>GOING TO · {planned.length}</Text>
        {planned.length === 0 && <Text style={styles.empty}>No planned shows yet.</Text>}
        {planned.map((p) => (
          <Pressable key={p.key} style={styles.showRow} onPress={() => onOpenArtist?.(p.artist)}>
            <View style={styles.goingDot}><Icon name="calendar" size={15} color={colors.amber} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.showArtist}>{p.artist}</Text>
              <Text style={styles.showVenue}>{p.venue} · {p.date}</Text>
            </View>
          </Pressable>
        ))}

        {/* their posts, the same feed card as home, so a profile reads like a
            wall of everything this person has posted (Facebook/Letterboxd style) */}
        <Text style={styles.sectionLabel}>{isSelf ? "YOUR POSTS" : "POSTS"} · {logs.length}</Text>
        {logs.length === 0 && (
          <Text style={styles.empty}>{isSelf ? "You haven't posted a show yet. Tap “Make a post” to log your first night." : "No posts yet."}</Text>
        )}
        <View style={styles.postsWrap}>
          {logs.map((l) => (
            <TicketStub
              key={l.id}
              log={l}
              onOpen={onOpenShow}
              onPreview={onPreview}
              onOpenProfile={() => {}}
              onOpenArtist={onOpenArtist}
              onOpenVenue={onOpenVenue}
              onReport={onReport}
            />
          ))}
        </View>

        {/* playlists */}
        {user.playlists?.length > 0 && <Text style={styles.sectionLabel}>PLAYLISTS</Text>}
        {user.playlists?.map((pl) => (
          <View key={pl.id} style={styles.playlist}>
            <View style={styles.plHead}>
              <Icon name="music" size={16} color={colors.amber} />
              <Text style={styles.plName}>{pl.name}</Text>
            </View>
            {pl.tracks.map((t, i) => (
              <Pressable key={i} style={styles.track} onPress={() => onPreview?.(t.title, t.artist)}>
                <Text style={styles.trackTxt}>{t.title} <Text style={styles.trackArtist}>· {t.artist}</Text></Text>
                <View style={styles.playBtn}><Icon name="play" size={11} color={colors.amber} /></View>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  missingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 40 },
  missingTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 6 },
  missingSub: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 8 },
  backBtn: { width: 40 },
  backCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  topTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  missingBox: { alignItems: "center", gap: 8, paddingTop: 80, paddingHorizontal: 40 },
  missingTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 6 },
  missingSub: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
  content: { paddingBottom: 48 },
  banner: { height: 120, overflow: "hidden", backgroundColor: colors.surfaceAlt },
  bannerFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surfaceAlt },
  bannerShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(11,14,22,0.25)" },
  head: { alignItems: "center", paddingHorizontal: 16 },
  avatarWrap: { marginTop: -44, borderWidth: 3, borderColor: colors.bg, borderRadius: 50 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  name: { color: colors.text, fontSize: 23, fontWeight: "900" },
  handle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  roleBadge: { marginTop: 10, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  roleTxt: { color: colors.amber, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  bio: { color: colors.textDim, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 12 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 9, marginTop: 16 },
  editTxt: { color: colors.amber, fontSize: 14, fontWeight: "600" },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  followBtn: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 10 },
  msgBtn: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 18, paddingVertical: 10 },
  msgTxt: { color: colors.amber, fontSize: 14, fontWeight: "700" },
  blockBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  blockedBox: { alignItems: "center", gap: 10, marginTop: 14, paddingHorizontal: 20 },
  blockedTxt: { color: colors.textDim, fontSize: 13, textAlign: "center", lineHeight: 19 },
  unblockBtn: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: 20, paddingVertical: 9 },
  unblockTxt: { color: colors.danger, fontSize: 14, fontWeight: "800" },
  followingBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  followTxt: { color: "#1A1206", fontSize: 14, fontWeight: "800" },
  followingTxt: { color: colors.textDim },
  statsRow: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, marginTop: 20, marginHorizontal: 16, paddingVertical: 14 },
  crossed: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, marginHorizontal: 16, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.magenta, backgroundColor: "rgba(224,69,123,0.07)" },
  crossedIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.magenta, backgroundColor: colors.bgElev },
  crossedTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  crossedNum: { color: colors.magenta, fontWeight: "900", fontFamily: mono },
  crossedSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  playlist: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  playlistIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  playlistName: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  playlistSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  stat: { flex: 1, alignItems: "center" },
  statVal: { color: colors.text, fontFamily: mono, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.textFaint, fontSize: 9, letterSpacing: 1, marginTop: 4, fontWeight: "700" },
  nowCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, marginHorizontal: 16, marginTop: 12, padding: 12 },
  nowLabel: { color: colors.good, fontSize: 9, letterSpacing: 1, fontWeight: "800" },
  nowTxt: { color: colors.text, fontSize: 13, marginTop: 3 },
  listenBtn: { borderWidth: 1, borderColor: colors.good, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  listenTxt: { color: colors.good, fontSize: 12, fontWeight: "800" },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 22, marginBottom: 10, marginHorizontal: 16 },
  hint: { color: colors.textDim, fontSize: 12, marginHorizontal: 16, marginTop: -6, marginBottom: 12 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", marginHorizontal: 16 },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginHorizontal: 16 },
  galleryCell: { width: "32%", aspectRatio: 1, backgroundColor: colors.surfaceAlt, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft },
  topRow: { flexDirection: "row", gap: 12, marginHorizontal: 16 },
  tb: { flex: 1, alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, padding: 14 },
  tbKind: { fontSize: 10, letterSpacing: 2, fontWeight: "800" },
  tbRecord: { marginVertical: 10 },
  tbTitle: { color: colors.text, fontSize: 14, fontWeight: "800", textAlign: "center" },
  tbArtist: { color: colors.textDim, fontSize: 12, marginTop: 2, textAlign: "center" },
  tbListen: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  tbListenTxt: { fontSize: 12, fontWeight: "800" },
  tbEmpty: { color: colors.textFaint, fontSize: 12 },
  showRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8, marginHorizontal: 16 },
  goingDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  goingDotTxt: {},
  showArtist: { color: colors.text, fontSize: 16, fontWeight: "700" },
  showVenue: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  postsWrap: { paddingHorizontal: 16 },
  reviewRow: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8, marginHorizontal: 16 },
  reviewTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reviewText: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 8 },
  scorePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  scoreTxt: { color: colors.gold, fontFamily: mono, fontSize: 14, fontWeight: "700" },
  playlist: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 10, marginHorizontal: 16 },
  plHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  plName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  track: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  trackTxt: { color: colors.text, fontSize: 13, flex: 1 },
  trackArtist: { color: colors.textDim },
  playBtn: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", paddingLeft: 2 },
});
