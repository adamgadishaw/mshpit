import { useState, useEffect, useRef } from "react";
import { ActivityIndicator, View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { colors, mono, radius, roleColor, space } from "../theme";
import { useStore } from "../store";
import { listenUrl } from "../seed/songs";
import { artistMeta } from "../seed/ingested";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import SpinningRecord from "../components/SpinningRecord";
import TicketStub from "../components/TicketStub";
import { BadgeRow } from "../components/Badge";
import { ACHIEVEMENTS } from "../lib/badges";
import { showDateMs } from "../lib/showTime";
import Countdown from "../components/Countdown";
import SmartImage from "../components/SmartImage";
import ClipPoster from "../components/ClipPoster";
import { trackKey } from "../lib/playback";
import { isVideoUrl } from "../lib/img";
import { formatDate } from "../domain/dates.mjs";
import { profileMediaItems } from "../domain/profileMedia.mjs";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";
import { tasteMatch } from "../domain/tasteMatch.mjs";

const EMPTY_PLAYLIST_STATE = Object.freeze({ status: "loading", rows: [], error: "" });
const EMPTY_PROFILE_STATE = Object.freeze({ status: "loading", user: null, error: "" });

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

function ProfileMediaTile({ item, index, onOpen }) {
  const video = item.kind === "video" || item.type === "video" || isVideoUrl(item.uri);
  const authoredAlt = typeof item.altText === "string" ? item.altText.trim() : "";
  return (
    <Pressable
      style={styles.galleryCell}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={authoredAlt || `Open profile ${video ? "video" : "photo"} ${index + 1}`}
      accessibilityHint={video ? "Opens the video player" : "Opens the full-size photo"}
    >
      {video ? (
        <ClipPoster uri={item.uri} posterUri={item.posterUrl || item.posterUri || null} style={StyleSheet.absoluteFill} compact accessibilityLabel={authoredAlt || "Concert video preview"} accessible={false} />
      ) : (
        <SmartImage uri={item.uri} posterUri={item.posterUrl || item.posterUri || null} style={StyleSheet.absoluteFill} contain={false} previewWidth={720} accessibilityLabel={authoredAlt || "Concert photo"} accessible={false} />
      )}
    </Pressable>
  );
}

// MySpace-style profile - banner, pfp, now-playing, theme song, Treble/Bass top
// artists, planned shows, reviews. Built to make people findable and followable.
export default function ProfileScreen({ userId, onClose, onOpenShow, onOpenArtist, onOpenVenue, onEditProfile, onPreview, onMessage, onReport, onEditPost, onOpenPhotos, onPlay, onOpenFollowList, onOpenBadges }) {
  const { session, userById, logsByUser, isFollowing, follow, unfollow, followerCount, followingCount, goingFor, userBadges, sharedShows, userPlaylists, loadUser, isBlocked, blockUser, unblockUser, userPoints, userAchievements, loadRewards } = useStore();
  const profileScope = accountTargetScope(session?.id, `profile:${userId || ""}`);
  const profileScopeRef = useRef(profileScope);
  profileScopeRef.current = profileScope;
  const [profileRevision, setProfileRevision] = useState(0);
  const [profileState, setProfileState] = useState(() => ({ scope: profileScope, value: EMPTY_PROFILE_STATE }));
  const profileView = scopedScreenValue(profileState, profileScope, EMPTY_PROFILE_STATE);
  const confirmedUser = profileView.user?.id === userId ? profileView.user : null;
  const cachedUser = confirmedUser || userById(userId);
  // The shared public-profile cache keeps only server-approved public profile
  // picks and excludes consent fields and precise home data. The signed-in
  // member can still see their complete server-authoritative session projection.
  // Other people's cached projections remain quarantined until the server either
  // confirms access or a transient failure labels them as stale.
  const mayRenderProfile = session?.id === userId || profileView.status === "ready" || profileView.status === "stale";
  const user = profileView.status === "missing" || !mayRenderProfile
    ? null
    : session?.id === userId ? { ...cachedUser, ...session } : cachedUser;
  const playlistScope = accountTargetScope(session?.id, `profile:${userId || ""}`);
  const playlistScopeRef = useRef(playlistScope);
  playlistScopeRef.current = playlistScope;
  const [playlistRevision, setPlaylistRevision] = useState(0);
  const [playlistState, setPlaylistState] = useState(() => ({ scope: playlistScope, value: EMPTY_PLAYLIST_STATE }));
  const playlistView = scopedScreenValue(playlistState, playlistScope, EMPTY_PLAYLIST_STATE);
  const playlists = playlistView.rows;
  const [playing, setPlaying] = useState(null);
  useEffect(() => {
    const requestScope = playlistScope;
    const controller = new AbortController();
    setPlaylistState({ scope: requestScope, value: { status: "loading", rows: [], error: "" } });
    if (!userId) return () => controller.abort();
    userPlaylists(userId, { signal: controller.signal, throwOnError: true })
      .then((rows) => {
        if (!controller.signal.aborted && playlistScopeRef.current === requestScope) {
          setPlaylistState({ scope: requestScope, value: { status: "ready", rows: Array.isArray(rows) ? rows : [], error: "" } });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== "AbortError" && playlistScopeRef.current === requestScope) {
          setPlaylistState({ scope: requestScope, value: { status: "error", rows: [], error: "Playlists could not be loaded. Check your connection and try again." } });
        }
      });
    return () => controller.abort();
    // userPlaylists is supplied by the store; the account+profile scope owns refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistScope, playlistRevision, userId]);
  useEffect(() => { if (userId) loadRewards(userId); }, [userId]);
  // Always refresh from the server: fills real follower counts, and makes profiles
  // we've never cached (a follower from a notification) open instead of blanking.
  useEffect(() => {
    const requestScope = profileScope;
    const controller = new AbortController();
    setProfileState({ scope: requestScope, value: EMPTY_PROFILE_STATE });
    if (!userId) {
      setProfileState({ scope: requestScope, value: { status: "missing", user: null, error: "" } });
      return () => controller.abort();
    }
    loadUser(userId, { signal: controller.signal })
      .then((outcome) => {
        if (controller.signal.aborted || profileScopeRef.current !== requestScope) return;
        setProfileState({
          scope: requestScope,
          value: {
            status: outcome?.status || "error",
            user: outcome?.user || null,
            error: typeof outcome?.error === "string"
              ? outcome.error
              : "This profile could not be loaded. Check your connection and try again.",
          },
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== "AbortError" && profileScopeRef.current === requestScope) {
          setProfileState({ scope: requestScope, value: { status: "error", user: null, error: "This profile could not be loaded. Check your connection and try again." } });
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileScope, profileRevision, userId]);
  // One shared 1s tick drives every GOING TO countdown row (no per-row timers).
  // Lives above the loading early-return so the hook order never changes; only
  // runs while a planned show actually has a parseable date.
  const planned = user ? goingFor(user.id) : [];
  if (!user) {
    const missing = profileView.status === "missing";
    const failed = profileView.status === "error";
    return (
      <View style={styles.wrap}>
        <View style={styles.topbar}>
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
            <View style={styles.backCircle}><Icon name="chevron-left" size={20} color={colors.text} /></View>
          </Pressable>
          <Text style={styles.topTitle}>{missing ? "Unavailable" : "Profile"}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.missingBox}>
          {missing ? (
            <>
              <Icon name="you" size={30} color={colors.textFaint} />
              <Text style={styles.missingTitle}>This account isn't available</Text>
              <Text style={styles.missingSub}>It may be restricted, deleted, or no longer visible to you.</Text>
            </>
          ) : failed ? (
            <>
              <Text style={styles.missingTitle}>Profile could not be refreshed</Text>
              <Text style={styles.missingSub}>{profileView.error}</Text>
              <Pressable style={styles.profileRetry} onPress={() => setProfileRevision((value) => value + 1)} accessibilityRole="button" accessibilityLabel="Retry loading profile">
                <Text style={styles.profileRetryText}>Try again</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator size="small" color={colors.amber} />
              <Text style={styles.missingSub}>Checking profile access...</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  const logs = logsByUser(user.id);
  const isSelf = session?.id === user.id;
  // Play a saved playlist: first track opens the bar with the whole list queued.
  const playPlaylist = (pl) => { const q = (pl.tracks || []).filter((t) => !!trackKey(t)); if (q.length) onPlay?.(q[0], q); };
  // "Crossed paths", shows you've both been to (and artists you've both seen).
  const crossed = !isSelf && session ? sharedShows(user.id) : { shows: [], artists: [] };
  const match = !isSelf && session ? tasteMatch(session, user) : null;

  // Media gallery, every public photo or clip this person attached, newest first.
  // On someone else's profile we only show ones they marked public; you always
  // see all of your own. Stable descriptors keep posters, edits, and alt text.
  const gallery = profileMediaItems(logs, { isSelf });
  const galleryViewerItems = gallery.map((item) => ({ ...item, by: user.name, ownerId: user.id }));
  const following = isFollowing(user.id);
  const roleLabel = user.role === "admin" ? "ADMIN" : user.role === "artist" ? "VERIFIED ARTIST" : "FAN";
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
        {!isSelf && onReport ? (
          <Pressable
            style={styles.profileReportBtn}
            onPress={() => onReport({
              targetType: "user",
              targetId: user.id,
              ownerId: user.id,
              targetName: "profile",
              title: `${user.name} (@${user.handle})`,
              summary: "Report this account and its public profile to the moderation team.",
            })}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Report ${user.name}'s profile`}
          >
            <Icon name="flag" size={16} color={colors.danger} />
          </Pressable>
        ) : <View style={{ width: 40 }} />}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {profileView.status === "stale" && (
          <View style={styles.staleProfile} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={styles.staleProfileText}>{profileView.error}</Text>
            <Pressable style={styles.staleProfileRetry} onPress={() => setProfileRevision((value) => value + 1)} accessibilityRole="button" accessibilityLabel="Retry refreshing profile">
              <Text style={styles.staleProfileRetryText}>Refresh</Text>
            </Pressable>
          </View>
        )}
        {/* banner + avatar */}
        <View style={styles.banner}>
          {user.banner ? <SmartImage uri={user.banner} style={StyleSheet.absoluteFill} contain={false} accessibilityLabel={`${user.name}'s profile banner`} accessible={false} /> : <View style={styles.bannerFallback} />}
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

        {/* Rewards: points + badges earned, tap for the full legend. */}
        <Pressable style={styles.rewards} onPress={() => onOpenBadges?.(user.id)}>
          <View style={styles.rewardsIcon}><Icon name="star" size={16} color={colors.amber} filled /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rewardsTitle}>{userPoints(user).toLocaleString()} points · {userAchievements(user).length}/{ACHIEVEMENTS.length} badges</Text>
            <Text style={styles.rewardsSub}>{isSelf ? "See what you can earn next" : "See their badges"}</Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textDim} />
        </Pressable>

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

        {match && (
          <View style={styles.tasteMatch}>
            <View style={styles.tasteMatchHead}>
              <View style={styles.tasteMatchIcon}><Icon name="music" size={16} color={colors.cool} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tasteMatchEyebrow}>TASTE MATCH</Text>
                <Text style={styles.tasteMatchSummary}>{match.summary}</Text>
              </View>
            </View>
            <View style={styles.tasteMatchChips} accessible={false}>
              {match.sharedArtists.map((artist) => (
                <Pressable key={`artist:${artist}`} style={styles.tasteMatchArtistChip} onPress={() => onOpenArtist?.(artist)} accessibilityRole="button" accessibilityLabel={`Open ${artist}`}>
                  <Icon name="music" size={11} color={colors.amber} />
                  <Text style={styles.tasteMatchArtistText}>{artist}</Text>
                </Pressable>
              ))}
              {match.sharedGenres.map((genre) => (
                <View key={`genre:${genre}`} style={styles.tasteMatchGenreChip}>
                  <Text style={styles.tasteMatchGenreText}>{genre}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.tasteMatchBasis}>Based only on artists and genres you both chose to share.</Text>
          </View>
        )}

        {/* One authoritative playlist section, loaded from the public profile API. */}
        <Text style={styles.sectionLabel}>PLAYLISTS{playlistView.status === "ready" && playlists.length ? ` · ${playlists.length}` : ""}</Text>
        {playlistView.status === "loading" ? (
          <View style={styles.playlistState} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.amber} />
            <Text style={styles.playlistStateText}>Loading playlists...</Text>
          </View>
        ) : playlistView.status === "error" ? (
          <View style={styles.playlistState} accessibilityLiveRegion="assertive">
            <Text style={styles.playlistError} selectable>{playlistView.error}</Text>
            <Pressable style={styles.playlistRetry} onPress={() => setPlaylistRevision((value) => value + 1)} accessibilityRole="button" accessibilityLabel={`Retry loading ${user.name}'s playlists`}>
              <Text style={styles.playlistRetryText}>Try again</Text>
            </Pressable>
          </View>
        ) : playlists.length > 0 ? (
          <>
            {playlists.map((pl) => (
              <Pressable key={pl.id} style={styles.playlistRow} onPress={() => playPlaylist(pl)} accessibilityRole="button" accessibilityLabel={`Play playlist ${pl.name}, ${(pl.tracks || []).length} songs`}>
                <View style={styles.playlistIcon}><Icon name="play" size={16} color={colors.amber} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.playlistName} numberOfLines={1}>{pl.name}</Text>
                  <Text style={styles.playlistSub} numberOfLines={1}>{(pl.tracks || []).length} song{(pl.tracks || []).length === 1 ? "" : "s"} · {(pl.tracks || []).slice(0, 3).map((t) => t.artist).filter(Boolean).join(", ")}</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textDim} />
              </Pressable>
            ))}
          </>
        ) : <Text style={styles.empty}>No playlists are shared here yet.</Text>}

        {/* Media gallery, using the same resilient descriptor pipeline as You. */}
        {gallery.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>MEDIA · {gallery.length}</Text>
            <View style={styles.gallery}>
              {gallery.map((g, i) => (
                <ProfileMediaTile key={g.id || `${g.postId || "post"}:${g.uri}:${i}`} item={g} index={i} onOpen={() => onOpenPhotos?.(galleryViewerItems, i, g.postId)} />
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

        {/* planned shows, with a live T-minus countdown per show (Clock-app
            style list): the wait is half the fun. Past/undated rows show plain. */}
        <Text style={styles.sectionLabel}>GOING TO · {planned.length}</Text>
        {planned.length === 0 && <Text style={styles.empty}>No planned shows yet.</Text>}
        {planned.map((p) => {
          const target = showDateMs(p.date);
          return (
            <Pressable key={p.key} style={styles.showRow} onPress={() => onOpenArtist?.(p.artist)}>
              <View style={styles.goingDot}><Icon name="calendar" size={15} color={colors.amber} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.showArtist}>{p.artist}</Text>
                <Text style={styles.showVenue}>{p.venue} · {formatDate(p.date, p.date)}</Text>
              </View>
              {target != null && target - Date.now() > -86400000 && (
                <View style={styles.countdownBox}>
                  <Countdown target={target} style={styles.countdownT} />
                  {target - Date.now() > 0 && <Text style={styles.countdownLabel}>until doors</Text>}
                </View>
              )}
            </Pressable>
          );
        })}

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
              onEdit={onEditPost}
              onOpenPhotos={onOpenPhotos}
              onPlay={onPlay}
            />
          ))}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  missingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 40 },
  missingTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 6 },
  missingSub: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
  profileRetry: { minHeight: 44, justifyContent: "center", marginTop: 10, paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  profileRetryText: { color: colors.amber, fontSize: 13, fontWeight: "800" },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 8 },
  backBtn: { width: 40 },
  backCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  topTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  profileReportBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  content: { paddingBottom: 48 },
  staleProfile: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface },
  staleProfileText: { flex: 1, color: colors.textDim, fontSize: 12, lineHeight: 17 },
  staleProfileRetry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  staleProfileRetryText: { color: colors.amber, fontSize: 12, fontWeight: "800" },
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
  rewards: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, marginTop: 10, marginHorizontal: 16, padding: 12 },
  rewardsIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  rewardsTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  rewardsSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  crossed: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, marginHorizontal: 16, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.magenta, backgroundColor: "rgba(224,69,123,0.07)" },
  crossedIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.magenta, backgroundColor: colors.bgElev },
  crossedTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  crossedNum: { color: colors.magenta, fontWeight: "900", fontFamily: mono },
  crossedSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  tasteMatch: { gap: 10, marginTop: 12, marginHorizontal: 16, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cool, backgroundColor: "rgba(65,184,213,0.07)" },
  tasteMatchHead: { flexDirection: "row", alignItems: "center", gap: 11 },
  tasteMatchIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.cool, backgroundColor: colors.bgElev },
  tasteMatchEyebrow: { color: colors.cool, fontSize: 10, letterSpacing: 1.4, fontWeight: "900" },
  tasteMatchSummary: { color: colors.text, fontSize: 13.5, lineHeight: 19, fontWeight: "700", marginTop: 2 },
  tasteMatchChips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  tasteMatchArtistChip: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  tasteMatchArtistText: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  tasteMatchGenreChip: { minHeight: 32, justifyContent: "center", paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tasteMatchGenreText: { color: colors.textDim, fontSize: 11.5, fontWeight: "700" },
  tasteMatchBasis: { color: colors.textFaint, fontSize: 10.5, lineHeight: 15 },
  playlistRow: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  playlistIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  playlistName: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  playlistSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  playlistState: { minHeight: 72, marginHorizontal: 16, padding: 12, gap: 9, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  playlistStateText: { color: colors.textDim, fontSize: 12.5 },
  playlistError: { color: colors.danger, fontSize: 12.5, lineHeight: 18, textAlign: "center" },
  playlistRetry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 15, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  playlistRetryText: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
  stat: { flex: 1, alignItems: "center" },
  statVal: { color: colors.text, fontFamily: mono, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.textFaint, fontSize: 9, letterSpacing: 1, marginTop: 4, fontWeight: "700" },
  nowCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, marginHorizontal: 16, marginTop: 12, padding: 12 },
  nowLabel: { color: colors.good, fontSize: 9, letterSpacing: 1, fontWeight: "800" },
  nowTxt: { color: colors.text, fontSize: 13, marginTop: 3 },
  listenBtn: { borderWidth: 1, borderColor: colors.good, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  listenTxt: { color: colors.good, fontSize: 12, fontWeight: "800" },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: space(6), marginBottom: space(2), marginHorizontal: 16 },
  countdownBox: { alignItems: "flex-end" },
  countdownT: { color: colors.amber, fontFamily: mono, fontSize: 15, fontWeight: "800", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  countdownLabel: { color: colors.textFaint, fontSize: 9.5, letterSpacing: 1, marginTop: 1, textTransform: "uppercase" },
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
});
