import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Image, TextInput, ActivityIndicator, useWindowDimensions } from "react-native";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";
import { useStore, isStaff } from "../store";
import { artistMeta } from "../seed/ingested";
import { SONGS } from "../seed/songs";
import Stars from "../components/Stars";
import TapStars from "../components/TapStars";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";
import Badge, { BadgeRow } from "../components/Badge";
import { proxied, isHttp } from "../lib/img";
import { api } from "../lib/api";
import { loadSelectedArtistDiscography } from "../lib/artistDiscographyApi";
import { openTicketLink } from "../lib/ticketLinks";
import { formatDate } from "../domain/dates.mjs";
import { discographyIdentityCopy, discographyPresentation } from "../domain/discographyView.mjs";
import { mediaDisplayItems, mediaDisplayKind, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import { trackReportDescriptor, trackReportIdentityKey } from "../domain/trackReportIdentity.mjs";
import { artistWorkspaceOwnsArtist } from "../domain/artistWorkspace.mjs";
import { selectArtistReviewsPresentation } from "../features/artistReviews/artistReviewsState.mjs";
import { useArtistTopReviews } from "../features/artistReviews/useArtistTopReviews";
import { useArtistEventArchive } from "../features/artistEvents/useArtistEventArchive";
import { selectArtistUpcomingShows } from "../domain/artistUpcomingShows.mjs";
import ArtistMemorialTribute from "../components/artist/ArtistMemorialTribute";
import ArtistCinematicCarousel from "../components/ArtistCinematicCarousel";
import { useArtistMemorial } from "../features/artistMemorials/useArtistMemorial";
import { PublicPressableLink } from "../components/PublicWebLinks";
import { concertPath, eventPath, postPath, profilePath } from "../domain/urls.mjs";
import { ARTIST_OVERVIEW_LIMITS, ARTIST_PAGE_SECTIONS, artistPagePreview, artistPageSectionModel, artistPageSynopsis } from "../domain/artistPageSections.mjs";
import { useArtistFollowFanClub } from "../features/artistFollow/useArtistFollowFanClub";
import { ENABLE_MUSIC_PLAYER } from "../config/runtime.mjs";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";

const compactCount = (value) => {
  const count = Number(value) || 0;
  if (count >= 1000000) return `${(count / 1000000).toFixed(count >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 100000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(count);
};
const releaseType = (album) => String(album?.type || "album").toLowerCase() === "ep" ? "EP" : "ALBUM";
const spotifyTrackId = (track) => {
  if (track?.id) return String(track.id);
  const match = String(track?.url || "").match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/i);
  return match?.[1] || null;
};
const TRACK_REPORT_TYPES = [
  { key: "wrong_video", label: "Wrong video" },
  { key: "wont_play", label: "Won't play" },
  { key: "preview_only", label: "Preview only" },
  { key: "missing", label: "Missing song" },
  { key: "other", label: "Other" },
];

function ArtistPageSectionNav({ active, onChange, memorialMode = false, statusPending = false }) {
  return (
    <View style={styles.sectionNav} accessibilityRole="tablist" accessibilityLabel="Artist page sections">
      {ARTIST_PAGE_SECTIONS.map((section) => {
        const selected = active === section.key;
        const label = section.key === "live"
          ? memorialMode ? "Legacy" : statusPending ? "Archive" : section.label
          : section.label;
        return (
          <Pressable
            key={section.key}
            style={({ pressed, focused }) => [
              styles.sectionNavItem,
              selected && styles.sectionNavItemOn,
              pressed && styles.sectionNavItemPressed,
              focused && focusRing,
            ]}
            onPress={() => onChange(section.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label} artist page section`}
          >
            <Icon name={section.icon} size={14} color={selected ? colors.amber : colors.textFaint} />
            <Text style={[styles.sectionNavText, selected && styles.sectionNavTextOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Album cover from the Cover Art Archive, served via the wsrv.nl image CDN -
// the archive rate-limits direct traffic, while the CDN fetches once and
// edge-caches. Ladder: proxied -> direct -> clean fallback tile.
function AlbumArt({ uri }) {
  const [stage, setStage] = useState(0); // 0 proxy, 1 direct, 2 give up
  if (!uri || stage > 1) {
    return (
      <View style={styles.albumArt}>
        <Icon name="music" size={22} color={colors.amber} />
      </View>
    );
  }
  const src = stage === 0 && isHttp(uri) ? proxied(uri, 300) : uri;
  return <Image source={{ uri: src }} style={styles.albumArtImg} resizeMode="cover" onError={() => setStage((s) => s + 1)} />;
}

function TopReviewCard({ review, rank, artistName, onOpenPost, onOpenShow, onOpenPhotos, onOpenProfile, memorialMode = false }) {
  const author = review.user?.name || "A Pit fan";
  const handle = review.user?.handle ? `@${review.user.handle}` : "Review";
  const score = Number(review.overall) || 0;
  const likes = Math.max(0, Number(review.likes) || 0);
  const date = formatDate(review.date, review.date || "Night logged");
  const mediaIsPublic = review.photosPublic === true || Number(review.photosPublic) === 1;
  const publicMedia = mediaIsPublic
    ? mediaDisplayItems(review).map((item) => ({
      ...item,
      by: author,
      postId: review.id,
      ownerId: review.userId,
    }))
    : [];
  const thumbnail = publicMedia[0] || null;
  const canOpenAuthor = !!review.userId && typeof onOpenProfile === "function";
  const canOpenExactShow = review.kind !== "memory" && !!String(review.archiveShowKey || "").trim();
  const authorIdentity = (
    <>
      <Avatar user={review.user || { name: author, initials: "PF" }} size={34} />
      <View style={styles.topReviewAuthor}>
        <Text style={styles.topReviewName} numberOfLines={1}>{author}</Text>
        <Text style={styles.topReviewHandle} numberOfLines={1}>{handle}</Text>
      </View>
    </>
  );

  return (
    <View style={[styles.topReviewCard, rank === 1 && styles.topReviewCardLead]}>
      <View style={styles.topReviewMain}>
        <View style={styles.topReviewHeader}>
          {canOpenAuthor ? (
            <PublicPressableLink
              href={review.user?.handle ? profilePath(review.user.handle) : null}
              onNavigate={() => onOpenProfile(review.userId)}
              style={({ pressed, focused }) => [
                styles.topReviewAuthorAction,
                pressed && styles.topReviewActionPressed,
                focused && focusRing,
              ]}
              accessibilityLabel={`Open ${author}'s profile`}
            >
              {authorIdentity}
            </PublicPressableLink>
          ) : (
            <View style={styles.topReviewAuthorAction}>{authorIdentity}</View>
          )}
          <View style={[styles.topReviewRank, !memorialMode && rank === 1 && styles.topReviewRankLead]}>
            {!memorialMode && rank === 1 ? <Icon name="star" size={10} color={colors.gold} /> : null}
            {memorialMode ? <Icon name="dove" size={11} color={colors.gold} strokeWidth={1.8} /> : null}
            <Text style={[styles.topReviewRankText, !memorialMode && rank === 1 && styles.topReviewRankTextLead]}>
              {memorialMode ? "MEMORY" : rank === 1 ? "TOP TAKE" : `#${rank}`}
            </Text>
          </View>
        </View>

        <Text style={styles.topReviewExcerpt} numberOfLines={3}>{String(review.review || "").trim() || "Shared a concert memory."}</Text>

        <View style={styles.topReviewFooter}>
          {!memorialMode ? (
            <View style={styles.topReviewSignal} accessibilityLabel={`${score.toFixed(1)} stars`}>
              <Icon name="star" size={12} color={colors.gold} />
              <Text style={styles.topReviewScore}>{score.toFixed(1)}</Text>
            </View>
          ) : null}
          <View style={styles.topReviewSignal} accessibilityLabel={`${likes} likes`}>
            <Icon name="heart" size={12} color={colors.magenta} />
            <Text style={styles.topReviewLikes}>{compactCount(likes)}</Text>
          </View>
          <Text style={styles.topReviewMeta} numberOfLines={1}>{review.venue || "Live show"} · {date}</Text>
        </View>

        <View style={styles.topReviewActions}>
          <PublicPressableLink
            href={postPath(review.id)}
            onNavigate={() => onOpenPost?.(review)}
            style={({ pressed, focused }) => [
              styles.topReviewAction,
              styles.topReviewPostAction,
              pressed && styles.topReviewActionPressed,
              focused && focusRing,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Read ${author}'s original fan post about ${artistName}`}
            accessibilityHint="Opens the original post"
          >
            <Icon name="feed" size={12} color={colors.amber} />
            <Text style={styles.topReviewActionText}>Read fan post</Text>
          </PublicPressableLink>
          {canOpenExactShow ? (
            <PublicPressableLink
              href={concertPath(review.archiveShowKey)}
              onNavigate={() => onOpenShow?.(review)}
              style={({ pressed, focused }) => [
                styles.topReviewAction,
                pressed && styles.topReviewActionPressed,
                focused && focusRing,
              ]}
              accessibilityLabel={`View the exact ${artistName} show reviewed by ${author}`}
              accessibilityHint="Opens the concert event page"
            >
              <Icon name="calendar" size={12} color={colors.textDim} />
              <Text style={styles.topReviewActionText}>View show</Text>
            </PublicPressableLink>
          ) : null}
        </View>
      </View>

      {thumbnail ? (
        <SmartImage
          uri={thumbnail.uri}
          posterUri={mediaPosterUri(thumbnail)}
          mediaKind={mediaDisplayKind(thumbnail)}
          style={styles.topReviewMedia}
          contain={false}
          previewWidth={320}
          accessibilityLabel={`Open media from ${author}'s review of ${artistName}`}
          onPress={() => onOpenPhotos?.(publicMedia, 0, review.id)}
        />
      ) : null}
    </View>
  );
}

// Artist page - the rollup of a band's live reputation across every night,
// plus where to catch them next. Answers "is this band worth seeing?"
export default function ArtistScreen({ artistName, previewAsFan = false, onClose, onOpenPost, onOpenShow, onOpenArchive, onOpenVenue, onOpenFanClub, onShareMemory, onOpenPhotos, onOpenGallery, onOpenProfile, onManageArtistProfile, onEditArtistProfile, onPlay, onAddToPlaylist, onReport }) {
  const { session, artistSummary, albumRating, songRating, rateAlbum, rateSong, loadRating,
    isArtistOwner, artistPostsFor, loadArtistPage, artistPageCacheEpoch,
    artistGallery, loadArtistPhotos, removePhoto, artistBadges, remoteArtistMeta, resolveArtist,
    artistDiscography, artistSeenCount, reportTrack, updateProfile, isFanClubMember, joinFanClub,
    refreshArtistCatalogMetadata } = useStore();
  const a = artistSummary(artistName);
  const { width } = useWindowDimensions();
  const playerEnabled = ENABLE_MUSIC_PLAYER && typeof onPlay === "function";
  const playlistEnabled = ENABLE_MUSIC_PLAYER && typeof onAddToPlaylist === "function";
  const widePage = width >= 760;
  const veryWidePage = width >= 1180;
  const [sectionSelection, setSectionSelection] = useState(() => ({ artistKey: a.profileKey, section: "overview" }));
  const activeSection = sectionSelection.artistKey === a.profileKey ? sectionSelection.section : "overview";
  const sectionModel = artistPageSectionModel(activeSection);
  const setActiveSection = (section) => setSectionSelection({ artistKey: a.profileKey, section });

  const { resource: memorialResource, availability: memorialAvailability, reload: retryMemorial } = useArtistMemorial({
    accountId: session?.id || null,
    artistKey: a.profileKey,
  });
  const memorial = memorialResource.data;
  const deceased = memorialAvailability === "deceased";
  const liveAvailable = memorialAvailability === "living";
  const memorialKnown = deceased || liveAvailable;
  const memorialChecking = memorialAvailability === "checking";
  const badges = artistBadges(a.name);
  // Metadata: bundled catalog first, else the DB catalog (resolved from
  // MusicBrainz on demand if we've never seen this artist, no empty pages).
  const meta = artistMeta(a.name) || remoteArtistMeta(a.name);
  // Releases come from the live discography endpoint. Bundled releases are no
  // longer shipped (see src/seed/ingested.js), so this is empty for a remote
  // artist until that request lands, which is the state the branch below already
  // handled.
  const bundledAlbums = meta?.albums || [];
  useEffect(() => { if (!artistMeta(a.name) && !remoteArtistMeta(a.name)) resolveArtist(a.name); }, [a.name]);
  // Pull the artist's fan photos from the server so the rolling gallery shows
  // every public post photo ever, not just posts sitting in this device's feed.
  useEffect(() => {
    const controller = new AbortController();
    void loadArtistPhotos(a.name, a.profileKey, { signal: controller.signal });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.name, a.profileKey]);
  const gallery = artistGallery(a.name, 12, a.profileKey);
  const visibleGallery = artistPagePreview(gallery, { condensed: sectionModel.condensed, limit: ARTIST_OVERVIEW_LIMITS.gallery });
  const { resource: topReviewsResource, reload: retryTopReviews } = useArtistTopReviews({
    accountId: session?.id || null,
    name: a.name,
    artistKey: a.profileKey,
    limit: 3,
  });
  const topReviewsPresentation = selectArtistReviewsPresentation(topReviewsResource, a.nights, { limit: 3, memorialMode: deceased });
  const topReviews = topReviewsPresentation.reviews;
  const visibleTopReviews = artistPagePreview(topReviews, { condensed: sectionModel.condensed, limit: ARTIST_OVERVIEW_LIMITS.reviews });
  const { resource: liveArchiveResource } = useArtistEventArchive({
    accountId: session?.id || null,
    name: a.name,
    artistKey: a.profileKey,
    enabled: sectionModel.loadFullArchive,
  });
  const liveArchive = sectionModel.loadFullArchive && liveArchiveResource.updatedAt != null ? liveArchiveResource.data : null;
  const archiveRatings = liveArchive?.shows?.reduce((sum, show) => sum + (Number(show.avgRating) || 0) * (Number(show.ratingCount) || 0), 0) || 0;
  const archiveRatingCount = Number(liveArchive?.totals?.ratings) || 0;
  const archiveAverage = archiveRatingCount ? archiveRatings / archiveRatingCount : 0;
  const localRatingRows = a.nights.filter((night) => Number(night.overall) > 0);
  const displayedAverage = liveArchive ? archiveAverage : (Number(a.avgOverall) || 0);
  const displayedRatingCount = liveArchive ? archiveRatingCount : localRatingRows.length;
  const displayedShowCount = liveArchive ? (Number(liveArchive?.totals?.shows) || 0) : localRatingRows.length;
  const topPerformances = liveArchive?.topShows || [];
  const canModerate = isStaff(session?.role);
  const genre = a.genre || "Genre not listed yet";
  const spotTracks = (meta?.topTracks || []).map((t, i) => {
    const sourceId = spotifyTrackId(t);
    return {
      id: "sp_" + (sourceId || i),
      sourceId,
      provider: sourceId ? "spotify" : null,
      title: t.title,
      artist: a.name,
      album: t.album,
      duration: Number(t.duration) || 0,
      url: t.url,
      preview: t.preview,
    };
  });
  const seedSongs = spotTracks.length ? spotTracks : SONGS.filter((s) => s.artist.toLowerCase() === a.name.toLowerCase());
  // Named artist accounts manage their workspace in Artist HQ. Staff can edit
  // this public profile directly, but never enter an artist-only workspace.
  const ownsArtistPage = isArtistOwner(a.name);
  const ownsNamedArtistPage = artistWorkspaceOwnsArtist(session, a.name);
  const canManagePublicPage = ownsArtistPage && !previewAsFan;
  const upcoming = liveAvailable
    ? (previewAsFan ? a.upcoming.filter((date) => !date.scheduled) : a.upcoming)
    : [];
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const upcomingPresentation = selectArtistUpcomingShows(upcoming, { expanded: showAllUpcoming });
  const visibleUpcoming = sectionModel.condensed
    ? artistPagePreview(upcoming, { condensed: true, limit: ARTIST_OVERVIEW_LIMITS.upcoming })
    : upcomingPresentation.shows;
  const bio = a.ownerBio || meta?.bio;
  const bioPresentation = artistPageSynopsis(bio, { condensed: sectionModel.condensed && !bioExpanded });
  const bannerUri = a.banner || meta?.photo || null;
  const profileAvatarPhotos = a.profileAvatarUri && a.ownerId
    ? [{ uri: a.profileAvatarUri, ownerId: a.ownerId, artistProfileKey: a.profileKey, by: a.name }]
    : null;
  const avatarUser = { avatarUri: a.photo || meta?.photo || null, initials: a.name.slice(0, 2).toUpperCase(), avatarColor: colors.amber };
  const posts = artistPostsFor(a.name);
  const visiblePosts = artistPagePreview(posts.slice(0, 10), { condensed: sectionModel.condensed, limit: ARTIST_OVERVIEW_LIMITS.posts });
  const fanClubMember = !!session && isFanClubMember(a.name);
  const followUi = useArtistFollowFanClub({
    accountId: session?.id || null,
    artistKey: a.profileKey,
    artistName: a.name,
    favoriteArtists: session?.favoriteArtists,
    updateProfile,
    isMember: fanClubMember,
    joinFanClub,
  });
  const followed = followUi.followed;

  // Full discography (albums + tracklists) from Deezer, so the page has real depth:
  // open an album, see every song, rate them, play them in the top bar.
  // "You've been in the pit with them N times" - the viewer's own show count
  // for this artist, from their logged posts.
  const [seen, setSeen] = useState(null);
  useEffect(() => {
    let ok = true;
    setSeen(null);
    if (session) artistSeenCount(a.name).then((r) => { if (ok) setSeen(r); });
    return () => { ok = false; };
  }, [a.name, session?.id]);

  // Wrong-version reporting: any listener can flag a song whose video is the
  // wrong version and optionally paste the correct YouTube link.
  const [reportingSong, setReportingSong] = useState(null);
  const [reportUrl, setReportUrl] = useState("");
  const [reportCategory, setReportCategory] = useState("wrong_video");
  const [reportNote, setReportNote] = useState("");
  const [reportingBusy, setReportingBusy] = useState(false);
  const [reportedSongs, setReportedSongs] = useState({});
  const submitSongReport = async (track) => {
    if (reportingBusy) return;
    const descriptor = trackReportDescriptor(track, a.name);
    if (!descriptor.title) return;
    const identityKey = trackReportIdentityKey(descriptor);
    setReportingBusy(true);
    const r = await reportTrack({ ...descriptor, category: reportCategory, url: reportUrl.trim() || undefined, note: reportNote.trim() || undefined });
    setReportingBusy(false);
    if (r.ok) { setReportedSongs((m) => ({ ...m, [identityKey]: true })); setReportingSong(null); setReportUrl(""); setReportNote(""); setReportCategory("wrong_video"); }
  };
  // One report box shared by EVERY song row on the page (popular songs and
  // album tracklists alike), keyed by exact provider recording when available.
  const renderReportBox = (track) => {
    const descriptor = trackReportDescriptor(track, a.name);
    const identityKey = trackReportIdentityKey(descriptor);
    return (
    <View style={styles.songReportBox}>
      {reportedSongs[identityKey] ? (
        <Text style={styles.songReportDone}>Reported. A moderator will pin the right video.</Text>
      ) : (
        <>
          <Text style={styles.songReportLabel}>What went wrong? A clear category helps moderators fix the right failure point.</Text>
          <View style={styles.songReportTypes}>
            {TRACK_REPORT_TYPES.map((type) => (
              <Pressable key={type.key} style={[styles.songReportType, reportCategory === type.key && styles.songReportTypeOn]} onPress={() => setReportCategory(type.key)}>
                <Text style={[styles.songReportTypeTxt, reportCategory === type.key && styles.songReportTypeTxtOn]}>{type.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.songReportInput}
            placeholder="https://youtube.com/watch?v=... (optional)"
            placeholderTextColor={colors.textFaint}
            value={reportUrl}
            onChangeText={setReportUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.songReportInput, styles.songReportNote]}
            placeholder="What happened? (optional)"
            placeholderTextColor={colors.textFaint}
            value={reportNote}
            onChangeText={setReportNote}
            maxLength={500}
            multiline
          />
          <View style={styles.songReportActions}>
            <Pressable style={[styles.songReportBtn, reportingBusy && { opacity: 0.55 }]} onPress={() => submitSongReport(descriptor)} disabled={reportingBusy} accessibilityRole="button">
              <Text style={styles.songReportBtnTxt}>{reportingBusy ? "Sending..." : "Send report"}</Text>
            </Pressable>
            <Pressable onPress={() => setReportingSong(null)} hitSlop={8}><Text style={styles.songReportCancel}>Cancel</Text></Pressable>
          </View>
        </>
      )}
    </View>
    );
  };
  const toggleReportBox = (track) => {
    const descriptor = trackReportDescriptor(track, a.name);
    const key = trackReportIdentityKey(descriptor);
    setReportingSong((current) => (current?.key === key ? null : { ...descriptor, key }));
    setReportUrl("");
    setReportNote("");
    setReportCategory("wrong_video");
  };

  const [disco, setDisco] = useState(null);
  const [discoOwner, setDiscoOwner] = useState(a.name);
  const [discoStatus, setDiscoStatus] = useState("idle");
  const [discoError, setDiscoError] = useState("");
  const [openAlbum, setOpenAlbum] = useState(null);
  const [showAllSongs, setShowAllSongs] = useState(false);
  const [showAllReleases, setShowAllReleases] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selectingCandidate, setSelectingCandidate] = useState(null);
  const [identityError, setIdentityError] = useState("");
  const identityRequestRef = useRef(null);
  const catalogRequestRef = useRef(null);
  const catalogRequestVersionRef = useRef(0);
  const loadDiscography = ({ preserve = false } = {}) => {
    catalogRequestRef.current?.abort();
    const controller = new AbortController();
    catalogRequestRef.current = controller;
    const requestVersion = ++catalogRequestVersionRef.current;
    setDiscoOwner(a.name);
    if (!preserve) setDisco(null);
    setDiscoStatus("loading");
    setDiscoError("");
    return artistDiscography(a.name, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted || catalogRequestVersionRef.current !== requestVersion) return null;
        setDisco(result || { albums: [], status: "not_found", stale: false });
        setDiscoStatus("ready");
        return result;
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== "AbortError" && catalogRequestVersionRef.current === requestVersion) {
          setDiscoStatus("error");
          setDiscoError("The discography could not be loaded. Check your connection and try again.");
        }
        return null;
      })
      .finally(() => {
        if (catalogRequestRef.current === controller) catalogRequestRef.current = null;
      });
  };
  useEffect(() => {
    setDiscoOwner(a.name);
    setDisco(null);
    setDiscoStatus("idle");
    setDiscoError("");
    setOpenAlbum(null);
    setShowAllSongs(false);
    setShowAllReleases(false);
    setShowAllUpcoming(false);
    setBioExpanded(false);
    setIdentityOpen(false);
    setCandidates(null);
    setCandidatesLoading(false);
    setSelectingCandidate(null);
    setIdentityError("");
    identityRequestRef.current?.abort();
    identityRequestRef.current = null;
    catalogRequestRef.current?.abort();
    catalogRequestRef.current = null;
    return () => {
      catalogRequestRef.current?.abort();
      identityRequestRef.current?.abort();
    };
  }, [a.name]);

  useEffect(() => {
    if (!sectionModel.loadDiscography || discoOwner !== a.name || discoStatus !== "idle") return undefined;
    void loadDiscography();
    return undefined;
    // Music catalog work is intentionally deferred until the listener opens
    // Music. The player is paused; this request only supplies release metadata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.name, discoOwner, discoStatus, sectionModel.loadDiscography]);

  const loadCandidates = async () => {
    setIdentityOpen(true);
    setIdentityError("");
    if (candidates !== null || candidatesLoading) return;
    const controller = new AbortController();
    identityRequestRef.current?.abort();
    identityRequestRef.current = controller;
    setCandidatesLoading(true);
    try {
      const result = await api(`/api/artists/candidates?name=${encodeURIComponent(a.name)}`, {
        context: "Finding matching artists",
        silent: true,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setCandidates(Array.isArray(result?.candidates) ? result.candidates : []);
    } catch (error) {
      if (!controller.signal.aborted) setIdentityError(error?.message || "The artist matches could not be loaded. Try again.");
    } finally {
      if (!controller.signal.aborted) setCandidatesLoading(false);
      if (identityRequestRef.current === controller) identityRequestRef.current = null;
    }
  };

  const chooseCandidate = async (candidate) => {
    if (!candidate?.id || selectingCandidate) return;
    const previousDisco = discoOwner === a.name ? disco : null;
    const requestVersion = ++catalogRequestVersionRef.current;
    const controller = new AbortController();
    identityRequestRef.current?.abort();
    identityRequestRef.current = controller;
    setSelectingCandidate(candidate.id);
    setIdentityError("");
    try {
      const result = await loadSelectedArtistDiscography(a.name, candidate.id, { signal: controller.signal });
      if (controller.signal.aborted || catalogRequestVersionRef.current !== requestVersion) return;
      setDiscoOwner(a.name);
      setDisco(result);
      setDiscoStatus("ready");
      setDiscoError("");
      setOpenAlbum(null);
      setShowAllSongs(false);
      setShowAllReleases(false);
      setIdentityOpen(false);
    } catch (error) {
      if (!controller.signal.aborted && catalogRequestVersionRef.current === requestVersion) {
        setIdentityError(error?.message || "That catalog could not be loaded. Try another match.");
        // If the listener opened the picker before the default catalogue had
        // finished, restore that baseline request rather than leaving a blank page.
        if (!previousDisco) loadDiscography();
      }
    } finally {
      if (!controller.signal.aborted) setSelectingCandidate(null);
      if (identityRequestRef.current === controller) identityRequestRef.current = null;
    }
  };

  const scopedDisco = discoOwner === a.name ? disco : null;
  const discographyView = discographyPresentation(scopedDisco, {
    status: discoOwner === a.name ? discoStatus : "loading",
    error: discoOwner === a.name ? discoError : "",
  });
  const releases = [...discographyView.albums]
    .sort((left, right) => String(right?.year || "").localeCompare(String(left?.year || "")));
  const visibleReleases = showAllReleases ? releases : releases.slice(0, 6);

  // The deep chart: the discography's 25-track list once it loads (fixes the
  // "cut off at ~10" complaint), else the seed list. Collapsed to 10 with a
  // "Show all N" toggle so the page doesn't open as a wall of songs.
  const discoTop = Array.isArray(scopedDisco?.topTracks) ? scopedDisco.topTracks.map((t, i) => ({
    id: "dz_" + (t.id || i),
    sourceId: t.id || null,
    provider: "deezer",
    title: t.title,
    artist: a.name,
    album: t.album || null,
    duration: Number(t.duration) || 0,
  })) : [];
  const allSongs = discoTop.length ? discoTop : seedSongs;
  // Keep next/previous tied to the selected Deezer identity too. Without this,
  // choosing a same-named act changed the visible list but left the old act in
  // the persistent player's queue.
  const songQueue = allSongs.filter((s) => s.title).map((s) => ({
    kind: "track",
    url: null,
    preview: s.preview || null,
    title: s.title,
    artist: a.name,
    sourceId: s.sourceId || null,
    provider: s.provider || null,
    duration: Number(s.duration) || 0,
    art: scopedDisco?.artist?.photo || a.photo || meta?.photo || null,
  }));
  const songs = showAllSongs ? allSongs : allSongs.slice(0, 10);
  const toggleAlbum = (id, tracks) => {
    setOpenAlbum((cur) => (cur === id ? null : id));
    (tracks || []).forEach((t) => loadRating("song", a.name, t.title));
  };
  const playTrack = (t, cover) => {
    if (!playerEnabled) return;
    // Every track is playable: the top player resolves it to a YouTube video by
    // title/artist, or a Deezer 30s preview mp3 when there's no match.
    const known = songQueue.find((s) => s.title === t.title);
    const preview = t.preview || known?.preview || null;
    onPlay?.({
      kind: "track",
      title: t.title,
      artist: a.name,
      url: null,
      preview,
      sourceId: t.sourceId || known?.sourceId || null,
      provider: t.provider || known?.provider || null,
      duration: Number(t.duration || known?.duration) || 0,
      art: cover || scopedDisco?.artist?.photo || a.photo || meta?.photo || null,
    }, songQueue.length ? songQueue : undefined);
  };
  // Listen = play a random song from this artist's catalog, with the rest queued up
  // (the player then keeps going with genre-matched recommendations).
  const playRandom = () => {
    if (!playerEnabled) return;
    if (songQueue.length) {
      const shuffled = [...songQueue].sort(() => Math.random() - 0.5);
      onPlay?.(shuffled[0], shuffled);
    } else {
      // No listed songs yet: let the player find the artist on YouTube by name.
      onPlay?.({ kind: "track", title: a.name, artist: a.name, art: scopedDisco?.artist?.photo || a.photo || meta?.photo || null });
    }
  };
  const addSong = (t) => playlistEnabled && onAddToPlaylist?.({
    title: t.title,
    artist: a.name,
    url: t.url || null,
    preview: t.preview || null,
    sourceId: t.sourceId || null,
    provider: t.provider || null,
    duration: Number(t.duration) || 0,
    art: t.art || scopedDisco?.artist?.photo || a.photo || meta?.photo || null,
  });

  // Play a single top-track (its own song, then genre-matched recs continue).
  const playSingle = (s) => {
    if (!playerEnabled) return;
    onPlay?.({
      kind: "track",
      url: null,
      preview: s.preview || null,
      title: s.title,
      artist: a.name,
      sourceId: s.sourceId || null,
      provider: s.provider || null,
      duration: Number(s.duration) || 0,
      art: scopedDisco?.artist?.photo || a.photo || meta?.photo || null,
    }, songQueue);
  };
  // Play an album AS AN ALBUM: in track order (optionally starting mid-album), or
  // shuffled. Recs append after the last track, so shuffle "kicks in" when it ends.
  const albumTrack = (t, al) => ({
    kind: "track",
    id: t.id ? `dz_${t.id}` : undefined,
    sourceId: t.id || null,
    provider: "deezer",
    title: t.title,
    artist: a.name,
    duration: Number(t.duration) || 0,
    preview: t.preview || null,
    art: al.cover || scopedDisco?.artist?.photo || a.photo || meta?.photo || null,
  });
  const playAlbum = (al, startTitle = null, shuffle = false) => {
    if (!playerEnabled) return;
    let tracks = (al.tracks || []).map((t) => albumTrack(t, al)).filter((t) => t.title);
    if (!tracks.length) return;
    if (shuffle) tracks = [...tracks].sort(() => Math.random() - 0.5);
    else if (startTitle) { const i = tracks.findIndex((t) => t.title === startTitle); if (i > 0) tracks = tracks.slice(i); }
    onPlay?.(tracks[0], tracks);
  };
  // Highest community-rated track on an album (needs ≥1 rating) — the "start here" flag.
  const topTrackOf = (al) => {
    let best = null;
    for (const t of al.tracks || []) { const r = songRating(a.name, t.title); if (r.count > 0 && (!best || r.avg > best.avg)) best = { title: t.title, avg: r.avg, count: r.count }; }
    return best;
  };
  // The artist's standout song: highest-rated popular track, else the top track.
  const topSong = (() => {
    let best = null;
    for (const s of songs) { const r = songRating(a.name, s.title); if (r.count > 0 && (!best || r.avg > best.avg)) best = { song: s, avg: r.avg, count: r.count }; }
    if (best) return best;
    const first = songs.find((s) => s.title);
    return first ? { song: first, avg: 0, count: 0 } : null;
  })();
  // A resolved-but-empty artist (no photo, no songs). Show a "coming soon" note
  // and log the interest so an admin can seed it (see the admin Catalog tab).
  const thin = !!meta && !meta.photo && !(meta.topTracks && meta.topTracks.length);

  // Slice 7: hydrate the artist's owner overrides + updates feed, and the server
  // aggregates for each album/song rating shown on the page.
  useEffect(() => {
    const controller = new AbortController();
    void loadArtistPage(a.name, { signal: controller.signal });
    return () => controller.abort();
    // The legacy store facade recreates actions as state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.name, artistPageCacheEpoch]);
  const artistRefreshScope = refreshScope(session?.id, "artist", a.profileKey || a.name);
  const { refresh: refreshArtist, refreshing: artistRefreshing } = useScopedRefresh({
    scope: artistRefreshScope,
    task: async ({ signal }) => {
      const [pageResult, photoResult, metadataResult] = await Promise.all([
        loadArtistPage(a.name, { signal }),
        loadArtistPhotos(a.name, a.profileKey, { signal }),
        refreshArtistCatalogMetadata(a.name, { signal }),
      ]);
      const failure = [pageResult, photoResult, metadataResult].find((result) => result?.ok === false && result?.error);
      if (failure?.error) throw failure.error;
      return { pageResult, photoResult, metadataResult };
    },
  });
  useEffect(() => {
    if (!sectionModel.showMusic) return;
    (bundledAlbums || []).forEach((al) => loadRating("album", a.name, al.title));
    songs.forEach((s) => loadRating("song", a.name, s.title));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.name, scopedDisco, sectionModel.showMusic]);
  return (
    <View style={styles.wrap}>
      <ScreenHeader
        kicker="ARTIST PROFILE"
        title={a.name}
        onBack={onClose}
        backLabel={`Leave ${a.name} artist profile`}
        backHint="Returns to the page you came from"
      />

      <VinylRefreshBoundary
        refreshing={artistRefreshing}
        onRefresh={refreshArtist}
        accessibilityLabel={`Refresh ${a.name} artist page`}
      >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {previewAsFan && (
          <View
            style={styles.fanPreviewNotice}
            accessible
            accessibilityLabel="Fan preview. Owner controls and scheduled dates are hidden."
          >
            <View style={styles.fanPreviewIcon}><Icon name="you" size={14} color={colors.amber} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fanPreviewTitle}>FAN PREVIEW</Text>
              <Text style={styles.fanPreviewText}>Owner controls and scheduled dates are hidden.</Text>
            </View>
          </View>
        )}
        {/* One decoded frame at a time: artist-owned imagery leads, followed by
            public fan photos. Motion is user-driven and respects Reduce Motion. */}
        <ArtistCinematicCarousel
          artistName={a.name}
          bannerUri={bannerUri}
          profileUri={a.photo || meta?.photo || null}
          gallery={gallery}
          onOpenMedia={onOpenPhotos}
        />

        <View style={styles.headRow}>
          <View style={styles.avatarWrap}>
            <Avatar user={avatarUser} size={84} onPress={() => onOpenPhotos?.(profileAvatarPhotos || (meta?.photos?.length ? meta.photos : a.photo ? [a.photo] : []), 0)} />
          </View>
          <View style={styles.profileActions}>
            {ownsNamedArtistPage && !previewAsFan && onManageArtistProfile ? (
              <Pressable style={styles.editBtn} onPress={onManageArtistProfile} accessibilityRole="button" accessibilityLabel={`Open ${a.name} Artist HQ`}>
                <Icon name="music" size={14} color={colors.amber} />
                <Text style={styles.editTxt}>Artist HQ</Text>
              </Pressable>
            ) : canModerate && !previewAsFan && onEditArtistProfile ? (
              <Pressable style={styles.editBtn} onPress={() => onEditArtistProfile(a.name)} accessibilityRole="button" accessibilityLabel={`Edit ${a.name} artist page`}>
                <Icon name="edit" size={14} color={colors.amber} />
                <Text style={styles.editTxt}>Edit artist page</Text>
              </Pressable>
            ) : null}
            {!ownsArtistPage && a.ownerId && onReport ? (
              <Pressable
                style={styles.reportProfileBtn}
                onPress={() => onReport({
                  targetType: "artist_profile",
                  targetId: a.profileKey,
                  ownerId: a.ownerId,
                  targetName: "artist profile",
                  title: `${a.name} artist profile`,
                  summary: "Report this artist-owned bio or profile imagery to the moderation team.",
                })}
                accessibilityRole="button"
                accessibilityLabel={`Report ${a.name} artist profile`}
              >
                <Icon name="flag" size={14} color={colors.textDim} />
                <Text style={styles.reportProfileText}>Report profile</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.headInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.heroName}>{a.name}</Text>
            {badges.length ? <BadgeRow badges={badges} size={20} style={styles.nameBadges} /> : null}
            {deceased ? (
              <View accessible style={styles.memorialChip} accessibilityLabel={`${a.name}, remembered in tribute`}>
                <Icon name="dove" size={13} color={colors.gold} strokeWidth={1.8} />
                <Text style={styles.memorialChipText}>IN MEMORY</Text>
              </View>
            ) : null}
            {!memorialKnown ? (
              <View accessible style={styles.memorialStatusChip} accessibilityLabel={memorialChecking ? `${a.name} status is being checked` : `${a.name} status could not be verified`}>
                {memorialChecking ? <ActivityIndicator size="small" color={colors.textDim} /> : <Icon name="shield" size={12} color={colors.textDim} />}
                <Text style={styles.memorialStatusChipText}>{memorialChecking ? "CHECKING STATUS" : "STATUS UNAVAILABLE"}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.chipRow}>
            <View style={styles.genreChip}>
              <Text style={styles.genreTxt}>{genre}</Text>
            </View>
            {liveAvailable && meta?.status === "dissolved" && (
              <View style={styles.statusChip}>
                <Text style={styles.statusTxt}>DISSOLVED{meta.endYear ? ` · ${meta.endYear}` : ""}</Text>
              </View>
            )}
            {liveAvailable && meta?.status === "inactive" && (
              <View style={styles.statusChip}>
                <Text style={styles.statusTxt}>INACTIVE</Text>
              </View>
            )}
            {session && !ownsArtistPage ? (
              <Pressable
                style={[styles.artistFollowBtn, followed && styles.artistFollowBtnOn, followUi.busy && styles.artistFollowBtnBusy]}
                onPress={followUi.toggleFollow}
                disabled={followUi.busy || followUi.joining}
                accessibilityRole="button"
                accessibilityLabel={`${followed ? "Unfollow" : "Follow"} ${a.name}`}
                accessibilityState={{ selected: followed, disabled: followUi.busy || followUi.joining, busy: followUi.busy }}
              >
                {followUi.busy ? (
                  <ActivityIndicator size="small" color={followed ? colors.amber : "#1A1206"} />
                ) : (
                  <Icon name={followed ? "check" : "star"} size={14} color={followed ? colors.amber : "#1A1206"} />
                )}
                <Text style={[styles.artistFollowText, followed && styles.artistFollowTextOn]}>
                  {followUi.busy
                    ? followUi.targetFollowing ? "Following…" : "Unfollowing…"
                    : followed ? "Following" : "Follow"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {session && !ownsArtistPage && followUi.error ? (
          <View style={styles.followFeedbackError} accessibilityLiveRegion="assertive">
            <Icon name="flag" size={14} color={colors.danger} />
            <Text style={styles.followFeedbackErrorText} selectable>{followUi.error}</Text>
          </View>
        ) : null}

        {session && !ownsArtistPage && followUi.notice ? (
          <View style={styles.followFeedback} accessibilityLiveRegion="polite">
            <Icon name="check" size={14} color={colors.good} />
            <Text style={styles.followFeedbackText}>{followUi.notice}</Text>
          </View>
        ) : null}

        {session && !ownsArtistPage && followUi.invite && followed && !fanClubMember ? (
          <View style={styles.fanClubInvite} accessibilityLiveRegion="polite">
            <View style={styles.fanClubInviteIcon}>
              <Icon name="comment" size={17} color={colors.amber} />
            </View>
            <View style={styles.fanClubInviteBody}>
              <Text style={styles.fanClubInviteTitle} accessibilityRole="header">Join the Fan Club too?</Text>
              <Text style={styles.fanClubInviteText}>
                Following shapes your feed. The Fan Club is a separate community chat and only joins if you choose.
              </Text>
              <View style={styles.fanClubInviteActions}>
                <Pressable
                  style={[styles.fanClubInviteJoin, followUi.joining && styles.artistFollowBtnBusy]}
                  onPress={followUi.join}
                  disabled={followUi.joining}
                  accessibilityRole="button"
                  accessibilityLabel={`Join the ${a.name} Fan Club`}
                  accessibilityState={{ disabled: followUi.joining, busy: followUi.joining }}
                >
                  {followUi.joining ? <ActivityIndicator size="small" color="#1A1206" /> : null}
                  <Text style={styles.fanClubInviteJoinText}>Join</Text>
                </Pressable>
                <Pressable
                  style={styles.fanClubInviteLater}
                  onPress={followUi.dismissInvite}
                  disabled={followUi.joining}
                  accessibilityRole="button"
                  accessibilityLabel={`Not now, do not join the ${a.name} Fan Club`}
                  accessibilityState={{ disabled: followUi.joining }}
                >
                  <Text style={styles.fanClubInviteLaterText}>Not now</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        <ArtistMemorialTribute
          artistKey={a.profileKey}
          artistName={a.name}
          memorial={memorial}
          style={styles.memorial}
        />

        {thin && !canManagePublicPage && (
          <View style={styles.comingSoon}>
            <Icon name="clock" size={16} color={colors.amber} />
            <View style={{ flex: 1 }}>
              <Text style={styles.comingSoonTitle}>We're adding this artist</Text>
              <Text style={styles.comingSoonSub}>{deceased
                ? "Photos, songs, and fan memories will keep building this permanent tribute."
                : liveAvailable
                  ? "Photos and songs are on the way. Your reviews still count and will show here."
                  : "Photos and songs are on the way. Live actions stay closed until the artist status is verified."}</Text>
            </View>
          </View>
        )}

        {/* age / hometown / genre line */}
        {(meta?.hometown || meta?.formed) && (
          <View style={styles.metaLine}>
            {!!meta?.hometown && <Text style={styles.metaItem}><Icon name="pin" size={12} color={colors.textDim} /> {meta.hometown}</Text>}
            {!!meta?.formed && <Text style={styles.metaItem}>· since {meta.formed}</Text>}
          </View>
        )}

        {sectionModel.showMusic && (<>
        <View style={styles.catalogIdentity}>
          <View style={styles.catalogIdentityIcon}><Icon name="music" size={15} color={colors.amber} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.catalogIdentityLabel}>MUSIC CATALOG</Text>
            <Text style={styles.catalogIdentityName} numberOfLines={1}>
              {discographyIdentityCopy(scopedDisco, a.name, discographyView)}
            </Text>
          </View>
          <Pressable
            style={styles.wrongArtistBtn}
            onPress={() => identityOpen ? setIdentityOpen(false) : loadCandidates()}
            accessibilityRole="button"
            accessibilityLabel={`Choose a different music catalog for ${a.name}`}
          >
            <Text style={styles.wrongArtistTxt}>{identityOpen ? "Close" : "Wrong artist?"}</Text>
          </Pressable>
        </View>

        {discographyView.state !== "ready" && (
          <View style={[styles.discographyNotice, discographyView.state === "error" && styles.discographyNoticeError]} accessibilityLiveRegion={discographyView.state === "error" ? "assertive" : "polite"}>
            {discographyView.state === "loading" && <ActivityIndicator size="small" color={colors.amber} />}
            <Text style={[styles.discographyNoticeText, discographyView.state === "error" && styles.discographyNoticeErrorText]} selectable={discographyView.state === "error"}>{discographyView.message}</Text>
            {(discographyView.state === "error" || discographyView.state === "stale") && (
              <Pressable style={styles.discographyRetry} onPress={() => loadDiscography({ preserve: discographyView.state === "stale" })} accessibilityRole="button" accessibilityLabel={`Retry loading ${a.name}'s discography`}>
                <Text style={styles.discographyRetryText}>Try again</Text>
              </Pressable>
            )}
          </View>
        )}

        {identityOpen && (
          <View style={styles.identityPanel}>
            <Text style={styles.identityTitle}>Choose the right {a.name}</Text>
            <Text style={styles.identityHelp}>Use the photo, fan count, and release count to pick the act you meant.</Text>
            {candidatesLoading ? (
              <View style={styles.identityLoading}>
                <ActivityIndicator size="small" color={colors.amber} />
                <Text style={styles.identityLoadingTxt}>Finding artist matches...</Text>
              </View>
            ) : candidates?.length ? (
              <View style={styles.candidateGrid}>
                {candidates.map((candidate) => {
                  const active = String(scopedDisco?.artist?.id || "") === String(candidate.id);
                  const busy = String(selectingCandidate || "") === String(candidate.id);
                  return (
                    <Pressable
                      key={candidate.id}
                      style={[styles.candidateCard, active && styles.candidateCardActive, selectingCandidate && !busy && styles.candidateCardDisabled]}
                      onPress={() => chooseCandidate(candidate)}
                      disabled={!!selectingCandidate || active}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active, disabled: !!selectingCandidate || active }}
                      accessibilityLabel={`${candidate.name}, ${compactCount(candidate.fans)} fans, ${candidate.albums} releases${active ? ", currently selected" : ""}`}
                    >
                      {candidate.photo ? (
                        <SmartImage uri={candidate.photo} style={styles.candidatePhoto} contain={false} />
                      ) : (
                        <View style={[styles.candidatePhoto, styles.candidatePhotoEmpty]}><Icon name="music" size={17} color={colors.textFaint} /></View>
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.candidateName} numberOfLines={1}>{candidate.name}</Text>
                        <Text style={styles.candidateMeta}>{compactCount(candidate.fans)} fans · {candidate.albums || 0} releases</Text>
                      </View>
                      {busy ? <ActivityIndicator size="small" color={colors.amber} /> : active ? <Icon name="check" size={15} color={colors.good} /> : <Icon name="chevron-right" size={14} color={colors.textFaint} />}
                    </Pressable>
                  );
                })}
              </View>
            ) : candidates ? (
              <Text style={styles.identityEmpty}>No alternate matches were found for this name.</Text>
            ) : null}
            {!!identityError && (
              <View style={styles.identityErrorRow}>
                <Text style={styles.identityError}>{identityError}</Text>
                {candidates === null && !candidatesLoading && (
                  <Pressable onPress={loadCandidates} hitSlop={8} accessibilityRole="button"><Text style={styles.identityRetry}>Try again</Text></Pressable>
                )}
              </View>
            )}
          </View>
        )}
        </>)}

        <View style={styles.repCard}>
          <Text style={styles.repLabel}>{deceased ? "CREATIVE LEGACY" : liveAvailable ? "LIVE REPUTATION" : "ARTIST STATUS"}</Text>
          {deceased ? (
            <View style={styles.legacyRow}>
              <View style={styles.legacyMark}><Icon name="dove" size={27} color={colors.gold} strokeWidth={1.5} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.legacyTitle}>Remembered through the music</Text>
                <Text style={styles.repSub}>This permanent page preserves concert history, photos, and fan memories. New live ratings are closed.</Text>
              </View>
            </View>
          ) : liveAvailable ? (
            <View style={styles.repRow}>
              <Text style={styles.bigScore}>{displayedRatingCount ? displayedAverage.toFixed(1) : "—"}</Text>
              <View style={{ flex: 1 }}>
                <Stars value={displayedAverage} size={18} />
                <Text style={styles.repSub}>
                  {displayedRatingCount
                    ? `${displayedShowCount} show${displayedShowCount === 1 ? "" : "s"} · ${displayedRatingCount} fan rating${displayedRatingCount === 1 ? "" : "s"}`
                    : "No live rating yet"}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.legacyRow} accessibilityLiveRegion="polite">
              <View style={styles.legacyMark}>
                {memorialChecking ? <ActivityIndicator color={colors.gold} /> : <Icon name="shield" size={24} color={colors.gold} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.legacyTitle}>{memorialChecking ? "Checking artist status" : "Live details are temporarily unavailable"}</Text>
                <Text style={styles.repSub}>{memorialChecking
                  ? "Mshpit is confirming whether live ratings and upcoming shows are available for this artist."
                  : "Mshpit could not safely confirm this artist's status, so live ratings and review actions remain hidden."}</Text>
                {!memorialChecking ? (
                  <Pressable style={styles.memorialRetry} onPress={retryMemorial} accessibilityRole="button" accessibilityLabel={`Retry checking ${a.name}'s artist status`}>
                    <Text style={styles.memorialRetryText}>Try again</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}
          {session && seen?.count > 0 && (
            <View style={styles.seenChip} accessibilityLabel={`You have seen ${a.name} live ${seen.count} ${seen.count === 1 ? "time" : "times"}`}>
              <Icon name="check" size={13} color={colors.good} />
              <Text style={styles.seenChipTxt}>
                You've been in the pit with them {seen.count === 1 ? "once" : seen.count === 2 ? "twice" : `${seen.count} times`}{seen.last ? ` · last ${seen.last}` : ""}
              </Text>
            </View>
          )}
          {liveAvailable && liveArchiveResource.status === "error" && !liveArchive ? <Text style={styles.note}>The live reputation could not refresh. Open the archive to try again.</Text> : null}
        </View>

        {/* Put the artist's visual identity directly beside their live reputation.
            This remains a bounded preview; the dedicated gallery owns the full
            collection and its pagination. */}
        {sectionModel.showCommunity && (gallery.length > 0 || !sectionModel.condensed) && (
          <>
            <View style={styles.galleryHeading}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sectionLabel}>PHOTOS & FAN GALLERY</Text>
                <Text style={styles.bio}>{sectionModel.condensed ? "A quick look at public fan photos and videos." : "Public fan photos and videos, along with artist images. Private and moderated media is not shown."}</Text>
              </View>
              {onOpenGallery ? (
                <Pressable
                  style={({ pressed, focused }) => [styles.galleryOpenButton, pressed && styles.archivePressed, focused && focusRing]}
                  onPress={() => onOpenGallery(a.name, a.profileKey)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open the full ${a.name} photo and fan gallery`}
                >
                  <Text style={styles.galleryOpenText}>SEE ALL</Text>
                  <Icon name="chevron-right" size={14} color={colors.amber} />
                </Pressable>
              ) : null}
            </View>
            {gallery.length ? (
              <View style={styles.fanGrid}>
                {visibleGallery.map((p, i) => (
                  <View key={p.uri || i} style={[styles.fanTile, { width: veryWidePage ? "19.2%" : widePage ? "23.8%" : "31.8%" }]}>
                    <SmartImage uri={p.uri} posterUri={mediaPosterUri(p)} mediaKind={mediaDisplayKind(p)} accessibilityLabel={p.altText || `Open media from ${a.name}`} style={StyleSheet.absoluteFill} contain={false}
                      onPress={() => onOpenPhotos?.(gallery.map((x) => ({ ...x, uri: x.uri, by: x.by, postId: x.postId, ownerId: x.ownerId })), i, p.postId || null)} />
                    {p.source !== "fan" && !!p.by && (
                      <View style={styles.creditTag} pointerEvents="none"><Text style={styles.creditTxt} numberOfLines={1}>{p.by}</Text></View>
                    )}
                    {canModerate && (
                      <Pressable style={styles.modBtn} hitSlop={6} onPress={() => removePhoto(p.uri)} accessibilityRole="button" accessibilityLabel={`Hide this ${a.name} gallery item`}>
                        <Icon name="x" size={12} color="#fff" />
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.galleryEmpty} accessible accessibilityLabel={`No public fan media for ${a.name} yet`}>
                <Icon name="photo" size={20} color={colors.textFaint} />
                <Text style={styles.galleryEmptyText}>No public fan media yet. Shared concert photos will build this archive.</Text>
              </View>
            )}
          </>
        )}

        {/* Live-music actions remain primary while the built-in player is paused. */}
        {deceased && session && typeof onShareMemory === "function" ? (
          <Pressable style={styles.memoryBtn} onPress={() => onShareMemory(a.name, a.profileKey)} accessibilityRole="button" accessibilityLabel={`Share a fan memory about ${a.name}`}>
            <Icon name="dove" size={17} color="#1A1206" strokeWidth={1.7} />
            <Text style={styles.memoryBtnText}>Share a fan memory</Text>
          </Pressable>
        ) : null}
        <View style={styles.artistActions}>
          <Pressable
            style={styles.fcBtn}
            onPress={() => onOpenFanClub?.(a.name)}
            accessibilityRole="button"
            accessibilityLabel={`Open the ${a.name} Fan Club${fanClubMember ? ", joined" : ""}`}
          >
            <Icon name="comment" size={16} color="#1A1206" />
            <Text style={styles.fcTxt}>Fan Club</Text>
          </Pressable>
          <Pressable style={styles.listenBtn} onPress={() => onOpenArchive?.(a.name, a.profileKey)}>
            <Icon name="archive" size={15} color={colors.amber} />
            <Text style={styles.listenTxt}>{deceased ? "Concert history" : liveAvailable ? "Live archive" : "Concert archive"}</Text>
          </Pressable>
        </View>

        <ArtistPageSectionNav active={activeSection} onChange={setActiveSection} memorialMode={deceased} statusPending={!memorialKnown} />

        {/* Top song — a "start here" pick beside the profile, one tap to play. */}
        {sectionModel.showMusic && playerEnabled && topSong && (
          <Pressable style={styles.topSong} onPress={() => playSingle(topSong.song)} accessibilityRole="button" accessibilityLabel={`Play top song ${topSong.song.title}`}>
            <View style={styles.topSongPlay}><Icon name="play" size={16} color="#1A1206" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.topSongKicker}>TOP SONG{topSong.count > 0 ? ` · ${topSong.avg.toFixed(1)}★ (${topSong.count})` : ""}</Text>
              <Text style={styles.topSongTitle} numberOfLines={1}>{topSong.song.title}</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        )}

        {/* Artist posts are read-only here. Creation and removal live in Artist HQ. */}
        {sectionModel.showCommunity && (a.feedEnabled || canManagePublicPage) && (posts.length > 0 || !sectionModel.condensed) && (
          <>
            <View style={styles.feedHead}>
              <Text style={styles.sectionLabel}>ARTIST POSTS{posts.length ? ` · ${posts.length}` : ""}</Text>
              {canManagePublicPage && !a.feedEnabled && <Text style={styles.feedOff}>hidden from fans</Text>}
            </View>
            {posts.length === 0 && <Text style={styles.empty}>No artist posts yet.</Text>}
            {visiblePosts.map((p) => (
              <View key={p.id} style={styles.postCard}>
                <View style={styles.postTop}>
                  <Avatar user={avatarUser} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.postName}>{a.name}</Text>
                    <Text style={styles.postTs}>{p.ts}</Text>
                  </View>
                  {!ownsArtistPage && onReport ? (
                    <Pressable
                      style={styles.artistPostReport}
                      hitSlop={8}
                      onPress={() => onReport({
                        targetType: "artist_post",
                        targetId: p.id,
                        ownerId: p.userId,
                        targetName: "artist update",
                        title: `${a.name} artist-page update`,
                        summary: p.text,
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={`Report ${a.name} artist-page update`}
                    >
                      <Icon name="flag" size={14} color={colors.textFaint} />
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.postText}>{p.text}</Text>
              </View>
            ))}
            {sectionModel.condensed && posts.length > visiblePosts.length && (
              <Pressable style={styles.showAllBtn} onPress={() => setActiveSection("community")} accessibilityRole="button" accessibilityLabel={`See all ${posts.length} ${a.name} artist posts`}>
                <Text style={styles.showAllTxt}>See every artist update</Text>
                <Icon name="chevron-right" size={15} color={colors.amber} />
              </Pressable>
            )}
          </>
        )}

        {/* Upcoming shows first, this is a live-music app, gigs lead. */}
        {sectionModel.showLive && upcoming.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>UPCOMING · {upcoming.length}</Text>
            {visibleUpcoming.map((t) => (
              <View key={t.id} style={styles.upRow}>
                <PublicPressableLink
                  href={eventPath(t)}
                  onNavigate={() => onOpenShow?.(t)}
                  style={({ pressed, focused }) => [styles.upMain, pressed && styles.archivePressed, focused && focusRing]}
                  accessibilityLabel={`Open ${a.name} at ${t.venue}, ${t.place || "location to be announced"}, ${formatDate(t.date, t.date)}`}
                  accessibilityHint="Opens the event page"
                >
                  <Text style={styles.upVenue}>{t.venue}</Text>
                  <Text style={styles.upPlace}>{t.place}</Text>
                  <Text style={styles.upDate}>{formatDate(t.date, t.date)}{t.scheduled ? "  · scheduled" : ""}</Text>
                </PublicPressableLink>
                {t.soldOut ? (
                  <View style={styles.soldOut}><Text style={styles.soldOutTxt}>SOLD OUT</Text></View>
                ) : /^https:\/\//i.test(t.ticketUrl || "") ? (
                  <Pressable style={styles.ticketBtn} onPress={() => { void openTicketLink(t.ticketUrl); }} accessibilityRole="link" accessibilityLabel={`Open tickets for ${a.name} at ${t.venue}`}>
                    <Icon name="ticket" size={14} color="#1A1206" />
                    <Text style={styles.ticketTxt}>Tickets</Text>
                  </Pressable>
                ) : (
                  <View style={styles.ticketPending} accessibilityLabel="Ticket link coming soon">
                    <Icon name="clock" size={13} color={colors.textDim} />
                    <Text style={styles.ticketPendingTxt}>Tickets soon</Text>
                  </View>
                )}
              </View>
            ))}
            {upcomingPresentation.hasOverflow && (
              <Pressable
                style={({ pressed, focused }) => [styles.showAllBtn, pressed && styles.archivePressed, focused && focusRing]}
                onPress={() => sectionModel.condensed ? setActiveSection("live") : setShowAllUpcoming((current) => !current)}
                accessibilityRole="button"
                accessibilityState={{ expanded: sectionModel.condensed ? false : upcomingPresentation.expanded }}
                accessibilityLabel={sectionModel.condensed
                  ? `View every upcoming ${a.name} show`
                  : upcomingPresentation.expanded
                    ? `Show fewer upcoming ${a.name} shows`
                    : `Load ${upcomingPresentation.overflowCount} more upcoming ${a.name} shows`}
              >
                <Text style={styles.showAllTxt}>
                  {sectionModel.condensed ? `View all ${upcoming.length} shows` : upcomingPresentation.expanded ? "Show fewer" : `Load ${upcomingPresentation.overflowCount} more`}
                </Text>
                <Icon name={sectionModel.condensed ? "chevron-right" : upcomingPresentation.expanded ? "chevron-up" : "chevron-down"} size={15} color={colors.amber} />
              </Pressable>
            )}
          </>
        )}

        {/* The complete archive is server-backed and groups many fan logs into
            one performance. Keep this profile preview compact; the virtualized
            archive owns the long history. */}
        {sectionModel.showLive && (<>
        {sectionModel.active === "live" && liveAvailable && (
          <>
            <Text style={styles.sectionLabel}>TOP-RATED NIGHTS</Text>
            <Text style={styles.topNightsIntro}>The three performances fans rate highest, weighted by real community depth.</Text>
            {liveArchiveResource.status === "loading" && !liveArchive ? (
              <View style={styles.inlineLoading}><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.empty}>Opening the live history…</Text></View>
            ) : topPerformances.length ? topPerformances.slice(0, 3).map((show, index) => (
              <PublicPressableLink
                key={show.key || show.id || index}
                href={concertPath(show.key)}
                onNavigate={() => onOpenShow?.(show)}
                style={({ pressed, focused }) => [styles.topNightCard, index === 0 && styles.topNightCardLead, pressed && styles.archivePressed, focused && focusRing]}
                accessibilityLabel={`Open number ${index + 1} rated ${a.name} performance at ${show.venue || "venue"}`}
              >
                <View style={[styles.topNightRank, index === 0 && styles.topNightRankLead]}><Text style={styles.topNightRankText}>#{index + 1}</Text></View>
                <View style={styles.topNightCopy}>
                  <Text style={styles.topNightVenue} numberOfLines={1}>{show.venue || "Venue to be announced"}</Text>
                  <Text style={styles.topNightMeta} numberOfLines={1}>{[show.place, formatDate(show.date, "")].filter(Boolean).join(" · ")}</Text>
                  {!!show.tour && <Text style={styles.topNightTour} numberOfLines={1}>{show.tour}</Text>}
                </View>
                <View style={styles.topNightScore}><Icon name="star" size={12} color={colors.gold} filled /><Text style={styles.topNightScoreText}>{Number(show.avgRating || 0).toFixed(1)}</Text></View>
              </PublicPressableLink>
            )) : (
              <Text style={styles.empty}>The podium is open. Rated performances will rise here as fans add their nights.</Text>
            )}
          </>
        )}
        {sectionModel.active === "live" ? (
          <>
            <Text style={styles.sectionLabel}>LIVE ARCHIVE</Text>
            <Pressable
              style={({ pressed, focused }) => [styles.archiveCard, pressed && styles.archivePressed, focused && focusRing]}
              onPress={() => onOpenArchive?.(a.name, a.profileKey)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${a.name} ${deceased ? "concert history" : "live archive"}`}
              accessibilityHint={deceased ? "Shows historical concerts, tours, photos, and fan memories" : "Shows the top rated performances, tours, photos, and every review"}
            >
              <View style={styles.archiveMark}><Icon name="archive" size={20} color={colors.amber} /></View>
              <View style={styles.archiveCopy}>
                <Text style={styles.archiveTitle}>{deceased ? "Concert history and memories" : liveAvailable ? "Every tour. Every night." : "Concert archive"}</Text>
                <Text style={styles.archiveText}>{deceased
                  ? "Remember past shows through tour galleries, photos, and the fan memories already shared."
                  : liveAvailable
                    ? "Explore the top three fan-rated shows, tour galleries, and the full review history."
                    : "Browse historical concert records while Mshpit verifies whether live actions are available."}</Text>
              </View>
              <View style={styles.archiveArrow}><Icon name="chevron-right" size={17} color={colors.amber} /></View>
            </Pressable>
          </>
        ) : null}
        </>)}

        {/* The writing fans keep passing around, paired with its public media. */}
        {memorialKnown && sectionModel.showCommunity && (topReviews.length > 0 || topReviewsPresentation.initialError || topReviewsPresentation.refreshError) && (
          <>
            <View style={styles.topReviewsHeading}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionLabel}>{deceased ? `FAN MEMORIES${topReviews.length ? ` · ${topReviews.length}` : ""}` : sectionModel.condensed ? "TOP REVIEW" : `TOP REVIEWS · ${topReviews.length}`}</Text>
                <Text style={styles.topReviewsIntro}>
                  {deceased
                    ? "Read the memories fans shared from concerts, then open the exact night in the historical archive."
                    : sectionModel.condensed
                    ? "Read the fan post, or open the exact show for that night's details."
                    : "Each review stays with its original fan post. View show opens the exact concert instead."}
                </Text>
              </View>
              <View style={styles.topReviewsSeal} accessibilityLabel={deceased ? "In remembrance" : "Fan favorites"}>
                <Icon name={deceased ? "dove" : "heart"} size={12} color={deceased ? colors.gold : colors.magenta} strokeWidth={1.8} />
                <Text style={styles.topReviewsSealText}>{deceased ? "IN REMEMBRANCE" : "FAN FAVORITES"}</Text>
              </View>
            </View>
            {(topReviewsPresentation.initialError || topReviewsPresentation.refreshError) && (
              <View style={styles.topReviewsFallback} accessibilityRole="alert">
                <View style={styles.topReviewsFallbackCopy}>
                  <Text style={styles.topReviewsFallbackLabel}>
                    {topReviewsPresentation.initialError ? "DEVICE COPY" : deceased ? "LAST SAVED MEMORIES" : "LAST LIVE RANKING"}
                  </Text>
                  <Text style={styles.topReviewsFallbackText}>
                    {topReviewsPresentation.initialError
                      ? `${deceased ? "Fan memories" : "Live favorites"} could not load, so these are reviews already on this device.`
                      : deceased ? "The latest refresh failed. The last saved fan memories are still showing." : "The latest refresh failed. The last verified ranking is still showing."}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed, focused }) => [
                    styles.topReviewsRetry,
                    pressed && styles.topReviewActionPressed,
                    focused && focusRing,
                  ]}
                  onPress={retryTopReviews}
                  accessibilityRole="button"
                  accessibilityLabel={`Retry loading ${deceased ? "artist fan memories" : "live artist reviews"}`}
                >
                  <Icon name="chevron-right" size={13} color={colors.amber} />
                  <Text style={styles.topReviewsRetryText}>Retry</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.topReviewsList}>
              {visibleTopReviews.map((review, index) => (
                <TopReviewCard
                  key={review.id}
                  review={review}
                  rank={index + 1}
                  artistName={a.name}
                  onOpenPost={onOpenPost}
                  onOpenShow={onOpenShow}
                  onOpenPhotos={onOpenPhotos}
                  onOpenProfile={onOpenProfile}
                  memorialMode={deceased}
                />
              ))}
            </View>
            {sectionModel.condensed && topReviews.length > visibleTopReviews.length ? (
              <Pressable style={styles.showAllBtn} onPress={() => setActiveSection("community")} accessibilityRole="button" accessibilityLabel={`Read all top ${a.name} reviews`}>
                <Text style={styles.showAllTxt}>{deceased ? "Read more fan memories" : "Read more reviews"}</Text>
                <Icon name="chevron-right" size={15} color={colors.amber} />
              </Pressable>
            ) : null}
          </>
        )}

        {sectionModel.showAbout && !!bio && (
          <>
            <Text style={styles.sectionLabel}>ABOUT</Text>
            <Text style={styles.bio}>{bioPresentation.text}</Text>
            {bioPresentation.truncated || bioExpanded ? (
              <Pressable
                style={styles.bioToggle}
                onPress={() => setBioExpanded((value) => !value)}
                accessibilityRole="button"
                accessibilityState={{ expanded: bioExpanded }}
                accessibilityLabel={bioExpanded ? `Show a shorter ${a.name} biography` : `Read the full ${a.name} biography`}
              >
                <Text style={styles.bioToggleText}>{bioExpanded ? "Show less" : "Read full bio"}</Text>
                <Icon name={bioExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.amber} />
              </Pressable>
            ) : null}
          </>
        )}

        {sectionModel.showMusic && (<>
        {releases.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>DISCOGRAPHY · {releases.length} RELEASES</Text>
            <Text style={styles.bio}>Explore the available albums and EPs, open a release for its tracklist, and rate the music you know.</Text>
            {visibleReleases.map((al) => {
              const ar = albumRating(a.name, al.title);
              const open = openAlbum === al.id;
              const playable = (al.tracks || []).some((t) => t?.title);
              const top = topTrackOf(al);
              return (
                <View key={al.id} style={styles.discAlbum}>
                  <View style={styles.discHead}>
                    <Pressable style={styles.discHeadMain} onPress={() => toggleAlbum(al.id, al.tracks)}>
                      {al.cover ? <Image source={{ uri: al.cover }} style={styles.discCover} /> : <View style={[styles.discCover, styles.discCoverEmpty]}><Icon name="music" size={16} color={colors.textFaint} /></View>}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.discTitle} numberOfLines={1}>{al.title}</Text>
                        <View style={styles.discMetaLine}>
                          <View style={[styles.releaseTypeChip, releaseType(al) === "EP" && styles.releaseTypeEp]}>
                            <Text style={[styles.releaseTypeTxt, releaseType(al) === "EP" && styles.releaseTypeEpTxt]}>{releaseType(al)}</Text>
                          </View>
                          <Text style={styles.discSub}>{al.year || "Year unknown"}{al.tracks?.length ? ` · ${al.tracks.length} songs` : ""}{ar.count > 0 ? ` · ${ar.avg.toFixed(1)}★` : ""}</Text>
                        </View>
                        <TapStars value={ar.mine} onChange={(n) => rateAlbum(a.name, al.title, n)} size={13} gap={2} />
                      </View>
                    </Pressable>
                    {playerEnabled && playable && (
                      <>
                        <Pressable style={styles.albAct} onPress={() => playAlbum(al, null, true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Shuffle ${al.title}`}>
                          <Icon name="shuffle" size={15} color={colors.textDim} />
                        </Pressable>
                        <Pressable style={styles.albPlay} onPress={() => playAlbum(al)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Play album ${al.title} in order`}>
                          <Icon name="play" size={14} color="#1A1206" />
                        </Pressable>
                      </>
                    )}
                    <Pressable style={styles.albAct} onPress={() => toggleAlbum(al.id, al.tracks)} hitSlop={6}><Icon name={open ? "chevron-down" : "chevron-right"} size={16} color={colors.textDim} /></Pressable>
                  </View>
                  {open && (al.tracks || []).map((t, ti) => {
                    const sr = songRating(a.name, t.title);
                    const isTop = top && top.title === t.title;
                    const reportDescriptor = trackReportDescriptor({
                      title: t.title,
                      artist: a.name,
                      provider: t.id ? "deezer" : null,
                      sourceId: t.id || null,
                    });
                    const reportIdentity = trackReportIdentityKey(reportDescriptor);
                    return (
                      <View key={ti}>
                        <View style={styles.discTrack}>
                          <View style={styles.discTrackMain}>
                            <Text style={styles.discTrackNo}>{ti + 1}</Text>
                            <View style={{ flex: 1 }}>
                              <View style={styles.discTrackTitleRow}>
                                {isTop && <Icon name="star" size={11} color={colors.gold} filled />}
                                <Text style={styles.discTrackTitle} numberOfLines={1}>{t.title}</Text>
                              </View>
                              {sr.count > 0 && <View style={styles.songMeta}><Stars value={sr.avg} size={10} /><Text style={styles.songAvg}>{sr.avg.toFixed(1)} · {sr.count}</Text></View>}
                            </View>
                          </View>
                          <TapStars value={sr.mine} onChange={(n) => rateSong(a.name, t.title, n)} size={15} gap={2} />
                          {session && playerEnabled && (
                            <Pressable style={styles.songAdd} onPress={() => toggleReportBox(reportDescriptor)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Report the wrong video playing for ${t.title}`}>
                              <Icon name="flag" size={12} color={reportedSongs[reportIdentity] ? colors.good : colors.textFaint} />
                            </Pressable>
                          )}
                          {playlistEnabled && (
                            <Pressable style={styles.songAdd} onPress={() => addSong({ title: t.title, preview: t.preview, art: al.cover })} hitSlop={8}>
                              <Icon name="plus" size={13} color={colors.textDim} />
                            </Pressable>
                          )}
                          {playerEnabled && (
                            <Pressable style={styles.songPlay} onPress={() => playTrack(t, al.cover)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Play ${t.title} as a single`}>
                              <Icon name="play" size={13} color={colors.amber} />
                            </Pressable>
                          )}
                        </View>
                        {playerEnabled && reportingSong?.key === reportIdentity && renderReportBox(reportDescriptor)}
                      </View>
                    );
                  })}
                </View>
              );
            })}
            {releases.length > 6 && (
              <Pressable style={styles.showAllBtn} onPress={() => setShowAllReleases((current) => !current)} accessibilityRole="button" accessibilityState={{ expanded: showAllReleases }} accessibilityLabel={showAllReleases ? "Show fewer releases" : `Show all ${releases.length} releases`}>
                <Text style={styles.showAllTxt}>{showAllReleases ? "Show fewer releases" : `Show all ${releases.length} releases`}</Text>
                <Icon name={showAllReleases ? "chevron-up" : "chevron-down"} size={15} color={colors.amber} />
              </Pressable>
            )}
          </>
        ) : bundledAlbums.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>RELEASES · {bundledAlbums.length}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.albumRow}>
              {bundledAlbums.map((al, i) => {
                const ar = albumRating(a.name, al.title);
                const kind = al.type === "Album" && /^live\s+(at|in|from|on)\b/i.test(al.title) ? "Live album" : al.type;
                return (
                  <View key={i} style={styles.album}>
                    <AlbumArt uri={al.art} />
                    <Text style={styles.albumTitle} numberOfLines={2}>{al.title}</Text>
                    <Text style={styles.albumYear}>{al.year} · {kind}{ar.count > 0 ? `  ${ar.avg.toFixed(1)}★` : ""}</Text>
                    <TapStars value={ar.mine} onChange={(n) => rateAlbum(a.name, al.title, n)} size={13} gap={2} />
                  </View>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        {songs.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>POPULAR SONGS</Text>
            <Text style={styles.bio}>
              {spotTracks.length ? "Their biggest tracks, with fan ratings from the MSHpit community." : "Rate the songs you know. Community favorites rise with real fan input."}
            </Text>
            {songs.map((s) => {
              const sr = songRating(a.name, s.title);
              const reportDescriptor = trackReportDescriptor(s, a.name);
              const reportIdentity = trackReportIdentityKey(reportDescriptor);
              const reported = !!reportedSongs[reportIdentity];
              return (
                <View key={s.id}>
                  <View style={styles.songRow}>
                    <View style={styles.songMain}>
                      <Text style={styles.songTitle} numberOfLines={1}>{s.title}</Text>
                      {sr.count > 0 ? (
                        <View style={styles.songMeta}><Stars value={sr.avg} size={11} /><Text style={styles.songAvg}>{sr.avg.toFixed(1)} · {sr.count}</Text></View>
                      ) : (
                        <Text style={styles.songMetaEmpty} numberOfLines={1}>{s.album ? s.album : "Not rated yet"}</Text>
                      )}
                    </View>
                    <TapStars value={sr.mine} onChange={(n) => rateSong(a.name, s.title, n)} size={16} gap={3} />
                    {session && playerEnabled && (
                      <Pressable style={styles.songAdd} onPress={() => toggleReportBox(reportDescriptor)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Report the wrong video playing for ${s.title}`}>
                        <Icon name="flag" size={12} color={reported ? colors.good : colors.textFaint} />
                      </Pressable>
                    )}
                    {playlistEnabled && (
                      <Pressable style={styles.songAdd} onPress={() => addSong(s)} hitSlop={8}>
                        <Icon name="plus" size={13} color={colors.textDim} />
                      </Pressable>
                    )}
                    {playerEnabled && (
                      <Pressable style={styles.songPlay} onPress={() => playSingle(s)} hitSlop={8}>
                        <Icon name="play" size={13} color={colors.amber} />
                      </Pressable>
                    )}
                  </View>
                  {playerEnabled && reportingSong?.key === reportIdentity && renderReportBox(reportDescriptor)}
                </View>
              );
            })}
            {allSongs.length > 10 && (
              <Pressable style={styles.showAllBtn} onPress={() => setShowAllSongs((v) => !v)} accessibilityRole="button" accessibilityLabel={showAllSongs ? "Show fewer songs" : `Show all ${allSongs.length} songs`}>
                <Text style={styles.showAllTxt}>{showAllSongs ? "Show fewer" : `Show all ${allSongs.length} songs`}</Text>
                <Icon name={showAllSongs ? "chevron-up" : "chevron-down"} size={15} color={colors.amber} />
              </Pressable>
            )}
          </>
        )}

        </>)}
      </ScrollView>
      </VinylRefreshBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { flexDirection: "row", alignItems: "center", width: 56 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { width: "100%", maxWidth: 1120, alignSelf: "center", padding: 16, paddingBottom: 64 },
  sectionNav: { flexDirection: "row", alignItems: "stretch", gap: 6, marginTop: 18, marginBottom: 2, padding: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  sectionNavItem: { flex: 1, minWidth: 0, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 7, borderRadius: radius.sm },
  sectionNavItemOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.amber },
  sectionNavItemPressed: { opacity: 0.72 },
  sectionNavText: { color: colors.textFaint, fontSize: 11.5, fontWeight: "800" },
  sectionNavTextOn: { color: colors.amber },
  inlineLoading: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  topNightsIntro: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: -5, marginBottom: 9 },
  fanPreviewNotice: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  fanPreviewIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  fanPreviewTitle: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  fanPreviewText: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  headRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: -42, paddingLeft: 4 },
  avatarWrap: { borderWidth: 3, borderColor: colors.bg, borderRadius: 48, backgroundColor: colors.bg },
  profileActions: { alignItems: "flex-end", gap: 6, marginBottom: 4 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 4 },
  editTxt: { color: colors.amber, fontSize: 13, fontWeight: "700" },
  artistFollowBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: radius.pill, paddingHorizontal: 16, backgroundColor: colors.amberStrong, borderWidth: 1, borderColor: colors.amberStrong },
  artistFollowBtnOn: { backgroundColor: colors.surface, borderColor: colors.amber },
  artistFollowBtnBusy: { opacity: 0.6 },
  artistFollowText: { color: "#1A1206", fontSize: 13, fontWeight: "900" },
  artistFollowTextOn: { color: colors.amber },
  badgeChips: { alignItems: "flex-end", gap: 6, marginBottom: 4 },
  reportProfileBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 14 },
  reportProfileText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  headInfo: { marginTop: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  nameBadges: { marginTop: 4 },
  heroName: { color: colors.text, fontSize: 30, fontWeight: "900", letterSpacing: -0.6 },
  memorialChip: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 5, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: `${colors.gold}66`, backgroundColor: `${colors.gold}12` },
  memorialChipText: { color: colors.gold, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  memorialStatusChip: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 5, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceAlt },
  memorialStatusChipText: { color: colors.textDim, fontFamily: mono, fontSize: 8.5, fontWeight: "900", letterSpacing: 0.8 },
  memorial: { marginTop: 16 },
  memorialRetry: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center", marginTop: 8, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.surface },
  memorialRetryText: { color: colors.gold, fontSize: 11.5, fontWeight: "900" },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
  genreChip: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  genreTxt: { color: colors.amber, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  statusChip: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.textFaint, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  statusTxt: { color: colors.textDim, fontSize: 11, letterSpacing: 1, fontWeight: "800" },
  followFeedback: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.good}66`, backgroundColor: `${colors.good}0D` },
  followFeedbackText: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  followFeedbackError: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.danger}80`, backgroundColor: `${colors.danger}0D` },
  followFeedbackErrorText: { flex: 1, color: colors.danger, fontSize: 12.5, lineHeight: 18 },
  fanClubInvite: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginTop: 12, padding: 13, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  fanClubInviteIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  fanClubInviteBody: { flex: 1, minWidth: 0 },
  fanClubInviteTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  fanClubInviteText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  fanClubInviteActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  fanClubInviteJoin: { minWidth: 96, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.amberStrong, borderWidth: 1, borderColor: colors.amberStrong },
  fanClubInviteJoinText: { color: "#1A1206", fontSize: 12.5, fontWeight: "900" },
  fanClubInviteLater: { minWidth: 96, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  fanClubInviteLaterText: { color: colors.textDim, fontSize: 12.5, fontWeight: "800" },

  repCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 15, marginTop: 14 },
  repLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 12 },
  repRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  legacyRow: { flexDirection: "row", alignItems: "center", gap: 13 },
  legacyMark: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: `${colors.gold}66`, backgroundColor: `${colors.gold}0D` },
  legacyTitle: { color: colors.text, fontFamily: displayFont, fontSize: 19, lineHeight: 24, fontWeight: "900" },
  bigScore: { color: colors.gold, fontFamily: mono, fontSize: 44, fontWeight: "800", lineHeight: 46 },
  repSub: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 17, marginTop: 12, fontStyle: "italic" },

  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: space(5), marginBottom: space(2) },
  feedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feedOff: { color: colors.textFaint, fontSize: 11, fontStyle: "italic", marginTop: 14 },
  postCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  postTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  postName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  postTs: { color: colors.textFaint, fontFamily: mono, fontSize: 11, marginTop: 1 },
  artistPostReport: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.lineSoft },
  postText: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  artistActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  memoryBtn: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.gold, borderBottomWidth: 3, borderBottomColor: "#9A6A16" },
  memoryBtnText: { color: "#1A1206", fontSize: 14, fontWeight: "900" },
  fcBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 13, borderBottomWidth: 3, borderBottomColor: "#B65E1F" },
  fcTxt: { color: "#1A1206", fontSize: 14, fontWeight: "800" },
  listenBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingVertical: 13 },
  listenTxt: { color: colors.amber, fontSize: 14, fontWeight: "700" },
  bio: { color: colors.textDim, fontSize: 14, lineHeight: 21 },
  bioToggle: { alignSelf: "flex-start", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 2 },
  bioToggleText: { color: colors.amber, fontSize: 12.5, fontWeight: "900" },
  metaLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12 },
  metaItem: { color: colors.textDim, fontSize: 13 },
  catalogIdentity: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  catalogIdentityIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(242,166,90,0.10)" },
  catalogIdentityLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9, letterSpacing: 1.1, fontWeight: "800" },
  catalogIdentityName: { color: colors.textDim, fontSize: 12, fontWeight: "700", marginTop: 2 },
  wrongArtistBtn: { minHeight: 44, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11 },
  wrongArtistTxt: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  discographyNotice: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 9, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  discographyNoticeError: { borderColor: colors.danger },
  discographyNoticeText: { flex: 1, color: colors.textDim, fontSize: 12, lineHeight: 17 },
  discographyNoticeErrorText: { color: colors.danger },
  discographyRetry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  discographyRetryText: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  identityPanel: { gap: 8, marginTop: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev },
  identityTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  identityHelp: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  identityLoading: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10 },
  identityLoadingTxt: { color: colors.textDim, fontSize: 12.5 },
  candidateGrid: { gap: 7, marginTop: 2 },
  candidateCard: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 60, padding: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  candidateCardActive: { borderColor: colors.good, backgroundColor: "rgba(111,207,151,0.07)" },
  candidateCardDisabled: { opacity: 0.55 },
  candidatePhoto: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceAlt },
  candidatePhotoEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  candidateName: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  candidateMeta: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, marginTop: 3 },
  identityEmpty: { color: colors.textDim, fontSize: 12.5, fontStyle: "italic", paddingVertical: 8 },
  identityErrorRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 3 },
  identityError: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 16 },
  identityRetry: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  topReviewsHeading: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  topReviewsIntro: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: -4 },
  topReviewsSeal: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  topReviewsSealText: { color: colors.textDim, fontFamily: mono, fontSize: 8.5, fontWeight: "900", letterSpacing: 0.7 },
  topReviewsFallback: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, padding: 10, paddingLeft: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.07)" },
  topReviewsFallbackCopy: { flex: 1, minWidth: 0 },
  topReviewsFallbackLabel: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  topReviewsFallbackText: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  topReviewsRetry: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface },
  topReviewsRetryText: { color: colors.amber, fontSize: 11.5, fontWeight: "900" },
  topReviewsList: { gap: 10, marginTop: 11 },
  topReviewCard: { minHeight: 150, flexDirection: "row", overflow: "hidden", borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, ...shadow.card },
  topReviewCardLead: { borderColor: colors.amber },
  topReviewMain: { flex: 1, minHeight: 150, gap: 5, padding: 10 },
  topReviewActionPressed: { opacity: 0.78, backgroundColor: colors.surfaceAlt },
  topReviewHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  topReviewAuthorAction: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 4, borderRadius: radius.sm },
  topReviewAuthor: { flex: 1, minWidth: 0 },
  topReviewName: { color: colors.text, fontSize: 13.5, fontWeight: "900" },
  topReviewHandle: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, marginTop: 2 },
  topReviewRank: { minHeight: 26, minWidth: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  topReviewRankLead: { borderColor: colors.gold, backgroundColor: "rgba(232,182,90,0.09)" },
  topReviewRankText: { color: colors.textDim, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  topReviewRankTextLead: { color: colors.gold },
  topReviewExcerpt: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  topReviewFooter: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 9 },
  topReviewSignal: { flexDirection: "row", alignItems: "center", gap: 3 },
  topReviewScore: { color: colors.gold, fontFamily: mono, fontSize: 11.5, fontWeight: "900", fontVariant: ["tabular-nums"] },
  topReviewLikes: { color: colors.textDim, fontFamily: mono, fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  topReviewMeta: { flex: 1, color: colors.textFaint, fontSize: 10.5 },
  topReviewActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 2 },
  topReviewAction: { flexGrow: 1, minWidth: 92, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  topReviewPostAction: { borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.07)" },
  topReviewActionText: { color: colors.textDim, fontSize: 10.5, fontWeight: "900" },
  topReviewMedia: { width: 108, minHeight: 150, borderLeftWidth: 1, borderLeftColor: colors.lineSoft },
  galleryRow: { gap: 10, paddingRight: 16 },
  galleryTile: { width: 140, height: 140, borderRadius: 10 },
  fanGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  galleryHeading: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 2 },
  galleryOpenButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  galleryOpenText: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  galleryEmpty: { minHeight: 110, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10, padding: 18, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  galleryEmptyText: { flexShrink: 1, maxWidth: 420, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  fanTile: { width: "31.8%", aspectRatio: 1, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.lineSoft },
  creditTag: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(5,6,10,0.62)", paddingHorizontal: 5, paddingVertical: 3 },
  creditTxt: { color: "rgba(255,255,255,0.82)", fontSize: 8 },
  modBtn: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(214,69,69,0.92)", alignItems: "center", justifyContent: "center" },
  albumRow: { gap: 10, paddingRight: 16 },
  album: { width: 120 },
  albumArt: { width: 120, height: 120, borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  albumArtImg: { width: 120, height: 120, borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  albumTitle: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 6 },
  albumYear: { color: colors.textFaint, fontFamily: mono, fontSize: 11, marginTop: 2, marginBottom: 6 },
  discAlbum: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, marginBottom: 8, overflow: "hidden" },
  discHead: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  discHeadMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  albAct: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  albPlay: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, paddingLeft: 2 },
  discCover: { width: 54, height: 54, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  discCoverEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  discTitle: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  discSub: { color: colors.textDim, fontFamily: mono, fontSize: 11, marginTop: 2, marginBottom: 4 },
  discMetaLine: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
  releaseTypeChip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: colors.surfaceAlt },
  releaseTypeEp: { borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  releaseTypeTxt: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, letterSpacing: 0.7, fontWeight: "900" },
  releaseTypeEpTxt: { color: colors.amber },
  discTrack: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  discTrackMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  discTrackNo: { color: colors.textFaint, fontFamily: mono, fontSize: 12, width: 20, textAlign: "center" },
  discTrackTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  discTrackTitle: { color: colors.text, fontSize: 13.5, fontWeight: "600" },
  comingSoon: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  comingSoonTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  comingSoonSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  songRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  seenChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, marginTop: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.good, backgroundColor: "rgba(111,207,151,0.08)" },
  seenChipTxt: { color: colors.good, fontSize: 12, fontWeight: "700" },
  songReportBox: { backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginTop: -4, marginBottom: 8 },
  songReportLabel: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  songReportTypes: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 9 },
  songReportType: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  songReportTypeOn: { borderColor: colors.amber, backgroundColor: colors.surfaceAlt },
  songReportTypeTxt: { color: colors.textDim, fontSize: 11.5, fontWeight: "700" },
  songReportTypeTxtOn: { color: colors.amber },
  songReportInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, color: colors.text, fontSize: 13, paddingHorizontal: 10, paddingVertical: 8 },
  songReportNote: { minHeight: 58, marginTop: 8, textAlignVertical: "top" },
  songReportActions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 10 },
  showAllBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginTop: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  showAllTxt: { color: colors.amber, fontSize: 13, fontWeight: "800" },
  songReportBtn: { backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  songReportBtnTxt: { color: "#1A1206", fontSize: 12.5, fontWeight: "800" },
  songReportCancel: { color: colors.textDim, fontSize: 12.5 },
  songReportDone: { color: colors.good, fontSize: 12.5, fontWeight: "700" },
  songMain: { flex: 1 },
  songTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  topSong: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.07)" },
  topSongPlay: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.amberStrong, paddingLeft: 2 },
  topSongKicker: { color: colors.amber, fontFamily: mono, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" },
  topSongTitle: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 2 },
  songMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  songAvg: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "700" },
  songMetaEmpty: { color: colors.textFaint, fontSize: 12, marginTop: 4 },
  songPlay: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", paddingLeft: 2 },
  songAdd: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },

  upRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8, gap: 12 },
  upMain: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center", borderRadius: radius.sm },
  upVenue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  upPlace: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  upDate: { color: colors.amber, fontFamily: mono, fontSize: 12, marginTop: 6 },
  ticketBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9 },
  ticketTxt: { color: "#1A1206", fontSize: 13, fontWeight: "800" },
  ticketPending: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, paddingVertical: 8 },
  ticketPendingTxt: { color: colors.textDim, fontSize: 11, fontWeight: "800" },
  soldOut: { borderWidth: 1, borderColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  soldOutTxt: { color: colors.danger, fontSize: 11, fontWeight: "800", letterSpacing: 1 },

  archiveCard: { minHeight: 108, flexDirection: "row", alignItems: "center", gap: 13, padding: 15, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.07)", ...shadow.card },
  archivePressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  archiveMark: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  archiveCopy: { flex: 1, minWidth: 0 },
  archiveTitle: { color: colors.text, fontSize: 16, fontWeight: "900", letterSpacing: -0.2 },
  archiveText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  archiveArrow: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  topNightCard: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, marginBottom: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  topNightCardLead: { borderColor: colors.gold, backgroundColor: "rgba(232,182,90,0.06)" },
  topNightRank: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  topNightRankLead: { borderColor: colors.gold },
  topNightRankText: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "900" },
  topNightCopy: { flex: 1, minWidth: 0, gap: 2 },
  topNightVenue: { color: colors.text, fontSize: 14.5, fontWeight: "900" },
  topNightMeta: { color: colors.textDim, fontSize: 11.5 },
  topNightTour: { color: colors.cool, fontSize: 10.5, fontWeight: "800" },
  topNightScore: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.bgElev },
  topNightScoreText: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "900" },

  nightRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  nightVenue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  nightMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  scorePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  scoreTxt: { color: colors.gold, fontFamily: mono, fontSize: 14, fontWeight: "700" },
});
