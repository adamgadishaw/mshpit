import { useState, useEffect, useRef } from "react";
import { ActivityIndicator, View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius, roleColor, space } from "../theme";
import { useStore } from "../store";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import TicketStub from "../components/TicketStub";
import { BadgeRow } from "../components/Badge";
import { ACHIEVEMENTS } from "../domain/badges.mjs";
import { showDateMs } from "../lib/showTime";
import Countdown from "../components/Countdown";
import SmartImage from "../components/SmartImage";
import ClipPoster from "../components/ClipPoster";
import { formatDate } from "../domain/dates.mjs";
import { profileMediaItems } from "../domain/profileMedia.mjs";
import { mediaDisplayKind, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";
import { tasteMatch } from "../domain/tasteMatch.mjs";
import { selectConcertReviews, selectProfileTimeline } from "../domain/profileTimeline.mjs";
import { useProfileHistory } from "../features/profileHistory/useProfileHistory";

const EMPTY_PROFILE_STATE = Object.freeze({ status: "loading", user: null, error: "" });

function Stat({ value, label, onPress }) {
  return (
    <Pressable style={styles.stat} onPress={onPress} disabled={!onPress}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function ProfileMediaTile({ item, index, onOpen }) {
  const video = mediaDisplayKind(item) === "video";
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
        <ClipPoster uri={item.uri} posterUri={mediaPosterUri(item)} style={StyleSheet.absoluteFill} compact accessibilityLabel={authoredAlt || "Concert video preview"} accessible={false} />
      ) : (
        <SmartImage uri={item.uri} mediaKind="image" style={StyleSheet.absoluteFill} contain={false} previewWidth={720} accessibilityLabel={authoredAlt || "Concert photo"} accessible={false} />
      )}
    </Pressable>
  );
}

// Public member profile: musical identity, live history, media, plans, and posts.
export default function ProfileScreen({ userId, onClose, onOpenShow, onOpenProfile, onOpenArtist, onOpenVenue, onManageProfile, onMessage, onReport, onEditPost, onOpenPhotos, onRemoveMyPostTag, onOpenFollowList, onOpenBadges }) {
  const { session, userById, logsByUser, isFollowing, follow, unfollow, followerCount, followingCount, goingFor, userBadges, sharedShows, loadUser, isBlocked, blockUser, unblockUser, userPoints, userAchievements, loadRewards, deleteOwnPost } = useStore();
  const profileScope = accountTargetScope(session?.id, `profile:${userId || ""}`);
  const profileScopeRef = useRef(profileScope);
  profileScopeRef.current = profileScope;
  const [profileRevision, setProfileRevision] = useState(0);
  const [profileState, setProfileState] = useState(() => ({ scope: profileScope, value: EMPTY_PROFILE_STATE }));
  const profileView = scopedScreenValue(profileState, profileScope, EMPTY_PROFILE_STATE);
  const history = useProfileHistory({ accountId: session?.id, targetId: userId, enabled: !!userId && profileView.status !== "missing" });
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

  const cachedLogs = logsByUser(user.id);
  const logs = history.posts.length || history.status === "ready" ? history.posts : cachedLogs;
  const reviews = selectConcertReviews(logs);
  const timeline = selectProfileTimeline(logs);
  const isSelf = session?.id === user.id;
  const historyLoading = history.status === "idle" || history.status === "loading" || history.status === "refreshing";
  const historyCount = (value) => `${value}${history.complete ? "" : "+"}`;
  const deleteHistoryPost = async (postId) => {
    const result = await deleteOwnPost(postId);
    if (result?.ok) history.removePost(postId);
    return result;
  };
  // Shared attendance: shows both accounts intentionally logged, never a claim
  // that the people met or were physically near each other at the venue.
  const crossed = !isSelf && session ? sharedShows(user.id) : { shows: [], artists: [] };
  const match = !isSelf && session ? tasteMatch(session, user) : null;

  // Media gallery, every public photo or clip this person attached, newest first.
  // On someone else's profile we only show ones they marked public; you always
  // see all of your own. Stable descriptors keep posters, edits, and alt text.
  const gallery = profileMediaItems(logs, { isSelf });
  const galleryViewerItems = gallery.map((item) => ({ ...item, by: user.name, ownerId: user.id }));
  const following = isFollowing(user.id);
  const roleLabel = user.role === "admin" ? "ADMIN" : user.role === "artist" ? "VERIFIED ARTIST" : "FAN";
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
            <Pressable
              style={styles.editBtn}
              onPress={onManageProfile}
              accessibilityRole="button"
              accessibilityLabel="Manage profile"
            >
              <Icon name="edit" size={15} color={colors.amber} />
              <Text style={styles.editTxt}>Manage profile</Text>
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
          <Stat value={historyCount(reviews.length)} label="REVIEWS" />
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

        {/* Shared attendance, the concert-overlap tracker. */}
        {!isSelf && session && (crossed.shows.length > 0 || crossed.artists.length > 0) && (
          <Pressable
            style={styles.crossed}
            onPress={crossed.shows.length ? () => onOpenShow?.(crossed.shows[0]) : undefined}
          >
            <View style={styles.crossedIcon}><Icon name="ticket" size={17} color={colors.magenta} /></View>
            {crossed.shows.length > 0 ? (
              <View style={{ flex: 1 }}>
                <Text style={styles.crossedTitle}>
                  You both logged <Text style={styles.crossedNum}>{crossed.shows.length}</Text> {crossed.shows.length === 1 ? "show" : "shows"}
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


        {/* Media gallery, using the same resilient descriptor pipeline as You. */}
        {gallery.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>MEDIA · {historyCount(gallery.length)}</Text>
            <View style={styles.gallery}>
              {gallery.map((g, i) => (
                <ProfileMediaTile key={g.id || `${g.postId || "post"}:${g.uri}:${i}`} item={g} index={i} onOpen={() => onOpenPhotos?.(galleryViewerItems, i, g.postId)} />
              ))}
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
        <Text style={styles.sectionLabel}>{isSelf ? "YOUR POSTS" : "POSTS"} · {historyCount(logs.length)}</Text>
        {logs.length === 0 && !historyLoading && (
          <Text style={styles.empty}>{isSelf ? "You haven't posted yet. Tap “Make a post” to log a show or share an update." : "No posts yet."}</Text>
        )}
        {!logs.length && historyLoading && (
          <View style={styles.historyState} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.amber} />
            <Text style={styles.historyStateText}>Loading posts...</Text>
          </View>
        )}
        <View style={styles.postsWrap}>
          {timeline.map((l) => (
            <TicketStub
              key={l.id}
              log={l}
              onOpen={onOpenShow}
              onOpenProfile={onOpenProfile}
              onOpenArtist={onOpenArtist}
              onOpenVenue={onOpenVenue}
              onReport={onReport}
              onEdit={onEditPost}
              onDelete={deleteHistoryPost}
              onRemoveMyPostTag={onRemoveMyPostTag}
              onSelfTagRemoved={({ id, version, userId: removedUserId }) => history.updatePost(id, (post) => ({
                ...post,
                taggedPeople: (Array.isArray(post.taggedPeople) ? post.taggedPeople : []).filter((person) => person?.id !== removedUserId),
                ...(Number.isSafeInteger(version) ? { version, editedAt: version } : {}),
              }))}
              onOpenPhotos={onOpenPhotos}
            />
          ))}
        </View>
        {!!history.error && (
          <View style={styles.historyError} accessibilityLiveRegion="assertive">
            <Text style={styles.historyErrorText}>{history.posts.length ? "Earlier posts could not be loaded." : "Posts could not be loaded."}</Text>
            <Pressable style={styles.historyButton} onPress={history.posts.length && history.nextCursor ? history.loadMore : history.retry} accessibilityRole="button" accessibilityLabel="Retry loading profile posts">
              <Text style={styles.historyButtonText}>Try again</Text>
            </Pressable>
          </View>
        )}
        {!!history.nextCursor && !history.error && (
          <Pressable style={styles.historyButton} onPress={history.loadMore} disabled={history.loadingMore} accessibilityRole="button" accessibilityLabel="Load earlier profile posts" accessibilityState={{ disabled: history.loadingMore }}>
            {history.loadingMore && <ActivityIndicator size="small" color={colors.amber} />}
            <Text style={styles.historyButtonText}>{history.loadingMore ? "Loading earlier posts..." : "Load earlier posts"}</Text>
          </Pressable>
        )}

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
  historyState: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  historyStateText: { color: colors.textDim, fontSize: 12 },
  historyError: { alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 12, padding: 12, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md },
  historyErrorText: { color: colors.textDim, fontSize: 12, textAlign: "center" },
  historyButton: { alignSelf: "center", minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, paddingHorizontal: 18, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill },
  historyButtonText: { color: colors.amber, fontSize: 12, fontWeight: "800" },
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
