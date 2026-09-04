import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, Linking, Platform } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, displayFont, font, mono, radius, shadow, roleColor, space } from "../theme";
import Stars from "./Stars";
import Icon from "./Icon";
import Avatar from "./Avatar";
import RatingBars from "./RatingBars";
import SpinStar from "./SpinStar";
import CommentPreview from "./AfterpartyPreview";
import ExpandableText from "./ExpandableText";
import PostMediaGrid from "./PostMediaGrid";
import SongAttachment from "./SongAttachment";
import { useStore } from "../store";
import { BadgeRow } from "./Badge";
import { formatDate, relativeTime } from "../domain/dates.mjs";
import { mediaDisplayItems } from "../domain/postMediaDisplay.mjs";
import { recommendationDisclosure } from "../domain/feedExperience.mjs";
import { artistCampaignPresentation } from "../domain/artistCampaignPost.mjs";
import { normalizeTaggedPeople } from "../domain/postFriendTags.mjs";
import { ENABLE_MUSIC_PLAYER } from "../config/runtime.mjs";
import useReducedMotion from "../hooks/useReducedMotion";
import { PublicPressableLink, PublicTextLink } from "./PublicWebLinks";
import { artistPath, profilePath, venuePath } from "../domain/urls.mjs";
import { buildAttendanceTicketPreview } from "../domain/attendanceTicket.mjs";
import { calendarShowFromPost } from "../domain/calendarShows.mjs";
import ConcertTicketCard from "./ConcertTicketCard";
import { SocialShareButton } from "./SocialShareStudio";
import { concertPostContext } from "../domain/concertPostContext.mjs";
import { resolvePostAuthor } from "../domain/postAuthor.mjs";
import {
  canonicalYouTubeReviewUrl,
  ONLINE_REVIEW_EXPERIENCE,
  reviewCardPerformance,
  youtubeReviewThumbnailUrl,
} from "../domain/onlineReview.mjs";
import { buildPostShareModel } from "../domain/socialShareCard.mjs";

// "3rd time in the pit" needs a real ordinal, not "3th".
const ordinal = (n) => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][Math.min(n % 10, 4)] || "th"}`;
};

function TaggedPeopleRow({ people, onOpenProfile, selfId, onRemoveSelf, palette = null, concertContext = false }) {
  const tagged = normalizeTaggedPeople(people);
  if (!tagged.length) return null;
  const textColor = palette?.textColor || colors.text;
  const borderColor = palette?.accentColor ? palette.accentColor + "70" : colors.line;
  return (
    <View style={styles.taggedPeopleRow} accessibilityLabel={`With ${tagged.map((person) => person.name).join(", ")}`}>
      <Icon name="you" size={14} color={palette?.accentColor || colors.amber} />
      <Text style={[styles.taggedPeopleLead, { color: palette?.mutedTextColor || colors.textDim }]}>{concertContext ? "went with" : "with"}</Text>
      {tagged.map((person) => (
        <View key={person.id} style={[styles.taggedPersonChip, { borderColor }]}>
          <PublicPressableLink
            href={person.handle ? profilePath(person.handle) : null}
            onNavigate={onOpenProfile ? () => onOpenProfile(person.id) : undefined}
            style={styles.taggedPersonProfile}
            disabled={Platform.OS === "web" ? !person.handle && !onOpenProfile : !onOpenProfile}
            accessibilityLabel={onOpenProfile ? `Open ${person.name}'s profile` : person.name}
          >
            <Avatar user={person} size={22} />
            <Text style={[styles.taggedPersonText, { color: textColor }]} numberOfLines={1}>@{person.handle || person.name}</Text>
          </PublicPressableLink>
          {person.id === selfId && onRemoveSelf && (
            <Pressable style={styles.taggedPersonRemove} onPress={() => onRemoveSelf(person)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove your tag from this post`}>
              <Icon name="x" size={12} color={palette?.mutedTextColor || colors.textDim} />
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

function RecommendationWhy({ recommendation, expanded, onToggle, palette = null }) {
  if (!recommendation) return null;
  const accent = palette?.accentColor || colors.amber;
  const text = palette?.textColor || colors.text;
  const muted = palette?.mutedTextColor || colors.textDim;
  return (
    <View style={[styles.whyWrap, palette && styles.campaignWhyWrap]}>
      <Pressable
        style={({ pressed }) => [styles.whyButton, palette && styles.campaignTouchTarget, pressed && (palette ? styles.campaignControlPressed : styles.controlPressed)]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${recommendation.label}. ${expanded ? "Hide" : "Show"} more information.`}
        accessibilityState={{ expanded }}
      >
        <Icon name="discover" size={14} color={accent} />
        <Text style={[styles.whyLabel, { color: text }]} numberOfLines={1}>{recommendation.label}</Text>
        <Text style={[styles.whyAction, { color: accent }]}>{expanded ? "Hide" : "About this post"}</Text>
      </Pressable>
      {expanded && (
        <Text style={[styles.whyDetail, { color: muted }]} accessibilityLiveRegion="polite">{recommendation.detail}</Text>
      )}
    </View>
  );
}

function NotForMeButton({ onPress, palette = null }) {
  if (!onPress) return null;
  const color = palette?.mutedTextColor || colors.textDim;
  return (
    <Pressable style={({ pressed }) => [styles.notForMe, palette && styles.campaignTouchTarget, pressed && (palette ? styles.campaignControlPressed : styles.controlPressed)]} hitSlop={8} onPress={onPress} accessibilityRole="button" accessibilityLabel="Not for me. Hide this recommendation.">
      <Icon name="minus" size={14} color={color} />
      <Text style={[styles.notForMeTxt, { color }]}>Not for me</Text>
    </Pressable>
  );
}

function ViewTally({ count, palette = null }) {
  const value = Math.max(0, Math.trunc(Number(count) || 0));
  const color = palette?.mutedTextColor || colors.textFaint;
  return (
    <View
      style={styles.viewTally}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${value} member ${value === 1 ? "view" : "views"}`}
    >
      <Icon name="eye" size={16} color={color} />
      <Text style={[styles.viewTallyText, { color }]}>{value}</Text>
    </View>
  );
}

function TicketActionRail({ showHref, onOpenShow, compareHref, onCompare, artist, palette = null }) {
  if (!showHref && !compareHref) return null;
  const accent = palette?.accentColor || colors.amber;
  const secondary = palette?.accentColor || colors.cool;
  const textColor = palette?.textColor || colors.text;
  return (
    <View
      style={[
        styles.ticketActionRail,
        palette && {
          backgroundColor: palette.contentSurfaceColor,
          borderColor: palette.accentColor + "72",
        },
      ]}
      accessibilityLabel="Show links"
    >
      {showHref ? (
        <PublicPressableLink
          href={showHref}
          onNavigate={onOpenShow}
          style={({ pressed }) => [styles.ticketAction, pressed && styles.ticketActionPressed]}
          accessibilityLabel={`View ${artist || "this"} show`}
        >
          <Icon name="ticket" size={15} color={accent} />
          <Text style={[styles.ticketActionText, { color: textColor }]} numberOfLines={2}>View this show</Text>
          <Icon name="chevron-right" size={13} color={accent} />
        </PublicPressableLink>
      ) : null}
      {showHref && compareHref ? <View style={[styles.ticketActionDivider, palette && { backgroundColor: palette.accentColor + "52" }]} /> : null}
      {compareHref ? (
        <PublicPressableLink
          href={compareHref}
          onNavigate={onCompare}
          style={({ pressed }) => [styles.ticketAction, pressed && styles.ticketActionPressed]}
          accessibilityLabel={`Compare scores across ${artist} concerts`}
        >
          <Icon name="archive" size={15} color={secondary} />
          <Text style={[styles.ticketActionText, { color: textColor }]} numberOfLines={2}>Compare {artist} shows</Text>
          <Icon name="chevron-right" size={13} color={secondary} />
        </PublicPressableLink>
      ) : null}
    </View>
  );
}

// Review-forward feed card: the review is the centerpiece. Artist / venue / date
// sit on a ticket-stub line below, the score reads at a glance, and the footer
// opens the post's comments. Lounge is reserved for the exact show's shared
// conversation so the two spaces never look like duplicate features.
export default function TicketStub({ log, mediaViewable = null, compactContent = false, onOpen, onOpenShow, onOpenPost, onNotInterested, onComment, onPreview, onOpenProfile, onOpenArtist, onOpenArtistArchive, onOpenVenue, onReport, onEdit, onDelete, onOpenPhotos, onPlay, onRemoveMyPostTag, onSelfTagRemoved, showComments = true }) {
  const avatarPriority = mediaViewable === true ? "high" : "normal";
  const openPostDetail = () => (onOpenPost || onComment || onOpen)?.(log);
  const openComments = () => (onComment || onOpenPost || onOpen)?.(log);
  const { userById, likeInfo, toggleLike, commentsFor, session, userBadges, deleteOwnPost } = useStore();
  const cachedAuthor = userById?.(log.userId);
  const author = useMemo(
    () => resolvePostAuthor({ userId: log.userId, cached: cachedAuthor, embedded: log.user }),
    [cachedAuthor, log.user, log.userId],
  );
  const authorHref = author?.handle ? profilePath(author.handle) : null;
  const postContext = useMemo(() => concertPostContext(log), [log]);
  const canonicalPostHref = postContext.showHref;
  const isOnlineReview = (log.experienceType || log.experience_type) === ONLINE_REVIEW_EXPERIENCE;
  const youtubeUrl = isOnlineReview
    ? canonicalYouTubeReviewUrl(
      log.youtubeUrl || log.youtube_url,
      log.youtubeVideoId || log.youtube_video_id,
    )
    : "";
  const youtubeThumbnailUrl = isOnlineReview ? youtubeReviewThumbnailUrl(youtubeUrl) : "";
  const artistHref = log.artist ? artistPath(log.artist, log.artistPublicSlug || log.artist_public_slug || null) : null;
  const venueHref = log.venue ? venuePath({
    name: log.venue,
    providerVenueId: log.providerVenueId || log.venue_provider_id || null,
    source: log.source || null,
  }) : null;
  const canCompareArtistShows = !!postContext.artistConcertsHref
    && (Platform.OS === "web" || !!onOpenArtistArchive);
  const openArtistShows = () => onOpenArtistArchive?.(
    postContext.artist,
    postContext.artistKey,
    postContext.artistPublicSlug,
  );
  const [revealed, setRevealed] = useState(!log.inTourWindow);
  const [whyOpen, setWhyOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const recommendation = useMemo(() => recommendationDisclosure(log.recommendation), [log.recommendation]);
  // Editing is the author's alone. Admins moderate (remove/mute/ban); they
  // never rewrite someone's review, so no admin bypass here.
  const canEdit = !!onEdit && !!session && session.id === log.userId && !log.attendanceTicket;
  // Delete is the author's own. Like edit, admins moderate through their own
  // route rather than this button, so there is no staff bypass here.
  const canDelete = !!session && session.id === log.userId;
  const canReport = !!onReport && (!session || session.id !== log.userId);
  const confirmDelete = () => {
    const run = () => { (onDelete || deleteOwnPost)?.(log.id); };
    if (Platform.OS === "web") {
      if (typeof window === "undefined" || window.confirm("Delete this post? This can't be undone.")) run();
      return;
    }
    Alert.alert("Delete post?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: run },
    ]);
  };
  const isStaffViewer = session && (session.role === "admin" || session.role === "moderator");
  const setlist = useMemo(() => Array.isArray(log.setlist) ? log.setlist : [], [log.setlist]);
  const timeLabel = log.timeAgo || relativeTime(log.createdAt);
  const taggedPeople = useMemo(() => normalizeTaggedPeople(log.taggedPeople), [log.taggedPeople]);
  const removeSelfTag = async () => {
    const result = await onRemoveMyPostTag?.(log.id);
    if (result?.ok === false) Alert.alert("Tag not removed", result.error?.message || "Refresh the post and try again.");
    else if (result?.ok) onSelfTagRemoved?.(result);
  };
  const postMedia = useMemo(() => mediaDisplayItems(log).map((item) => ({
    ...item,
    by: log.user?.name,
    postId: log.id,
    ownerId: log.userId,
  })), [log]);
  const campaignPresentation = useMemo(
    () => artistCampaignPresentation(log.campaign, postMedia),
    [log.campaign, postMedia],
  );
  const campaignBackground = campaignPresentation?.background || null;
  const campaignBackgroundIndex = campaignBackground
    ? postMedia.findIndex((item) => (item.id || item.assetId) === (campaignBackground.id || campaignBackground.assetId))
    : -1;
  const statusMedia = useMemo(() => campaignBackground
    ? postMedia.filter((_, index) => index !== campaignBackgroundIndex)
    : postMedia, [campaignBackground, campaignBackgroundIndex, postMedia]);
  const attendanceTicketCard = useMemo(() => log.attendanceTicket?.kind === "attendance-ticket"
    ? log.attendanceTicket
    : log.attendanceTicket
      ? buildAttendanceTicketPreview({
        author,
        show: log.attendanceTicket,
        seatLocation: log.attendanceTicket.seat || log.attendanceTicket.seatLocation,
        shareSeatLocation: !!(log.attendanceTicket.seat || log.attendanceTicket.seatLocation),
      })
      : null, [author, log.attendanceTicket]);
  const attendanceTicketShow = useMemo(() => log.attendanceTicket?.tourDateId
    ? calendarShowFromPost(log)
    : null, [log]);
  const shareModel = useMemo(
    () => buildPostShareModel(log, { author }),
    [author, log],
  );
  // Score analytics: tap the star pill to see why the night got its score.
  const [statsOpen, setStatsOpen] = useState(false);

  const { count: likeCount, liked } = likeInfo(log.id, log.likes || 0);
  const commentCount = commentsFor(log.id).length || log.comments || 0;
  const viewCount = Math.max(0, Math.trunc(Number(log.viewCount) || 0));
  // Server posts can arrive with null scores (photo-only posts); never crash the feed.
  const band = log.band ?? 0, room = log.room ?? 0, overall = log.overall ?? 0;
  const performance = useMemo(() => reviewCardPerformance(log), [log]);
  const performanceTitle = performance.primary;
  const titledPerformance = performance.showArtistInMeta;
  const factors = log.dims
    ? `Band ${band.toFixed(1)} · Room ${room.toFixed(1)} · Night ${(((log.dims.crowd || 0) + (log.dims.experience || 0)) / 2 || overall).toFixed(1)}`
    : `Band ${band.toFixed(1)} · Room ${room.toFixed(1)}`;

  // A plain status update: a Facebook/Twitter-style social card (no ticket stub,
  // no score, no artist/venue line) with the comment section preloaded below.
  if (log.kind === "status") {
    const campaignTreatment = campaignPresentation?.treatment;
    const campaignArtUri = campaignBackground?.url || campaignBackground?.uri || campaignBackground?.sourceUrl || null;
    return (
      <View style={[styles.card, statusMedia.length > 0 && !campaignPresentation && styles.mediaStatusCard, campaignPresentation && styles.campaignCard, campaignTreatment && { backgroundColor: campaignTreatment.backgroundColor }]}>
        {statusMedia.length > 0 && !campaignPresentation ? (
          <View style={styles.mediaStatusRegister} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.mediaStatusRegisterAmber} />
            <View style={styles.mediaStatusRegisterMagenta} />
            <View style={styles.mediaStatusRegisterCool} />
          </View>
        ) : null}
        {campaignArtUri && (
          <ExpoImage
            source={{ uri: campaignArtUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            autoplay={!reduceMotion}
            transition={reduceMotion ? 0 : 180}
            accessible={false}
            accessibilityElementsHidden
          />
        )}
        {campaignPresentation && !campaignArtUri && (
          <View style={styles.campaignBackdrop} pointerEvents="none" accessibilityElementsHidden>
            <View style={[styles.campaignGlowLarge, { backgroundColor: campaignTreatment.accentColor + "2E" }]} />
            <View style={[styles.campaignGlowSmall, { backgroundColor: campaignTreatment.accentColor + "22" }]} />
          </View>
        )}
        {campaignPresentation && <View style={[StyleSheet.absoluteFill, { backgroundColor: campaignTreatment.scrimColor }]} pointerEvents="none" accessibilityElementsHidden />}
        {campaignPresentation && (
          <View style={styles.campaignTopline}>
            <View style={[styles.campaignBadge, { borderColor: campaignTreatment.accentColor + "80" }]}>
              <Icon name="star" size={12} color={campaignTreatment.accentColor} />
              <Text style={[styles.campaignBadgeText, { color: campaignTreatment.accentColor }]}>{campaignTreatment.eyebrow.toUpperCase()}</Text>
            </View>
            {campaignBackground && onOpenPhotos && campaignBackgroundIndex >= 0 && (
              <Pressable
                style={styles.campaignArtworkButton}
                onPress={() => onOpenPhotos(postMedia, campaignBackgroundIndex, log.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open featured artist post background${campaignBackground.altText ? `, ${campaignBackground.altText}` : ""}`}
              >
                <Icon name="photo" size={12} color="#FFF8EE" />
                <Text style={styles.campaignArtworkText}>View artwork</Text>
              </Pressable>
            )}
          </View>
        )}
        <View style={campaignPresentation ? [styles.campaignContent, { backgroundColor: campaignTreatment.contentSurfaceColor }] : null}>
        <View style={styles.header}>
          <Avatar user={author} size={40} priority={avatarPriority} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined} />
          <Pressable style={{ flex: 1 }} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, campaignPresentation && { color: campaignTreatment.textColor }]}>{author.name}</Text>
              <BadgeRow badges={userBadges(author)} size={14} />
            </View>
            <Text style={[styles.sub, campaignPresentation && { color: campaignTreatment.mutedTextColor }]}><PublicTextLink href={authorHref} onNavigate={log.userId ? () => onOpenProfile?.(log.userId) : undefined} style={campaignPresentation ? { color: campaignTreatment.accentColor, fontWeight: "800" } : roleColor(author.role) ? { color: roleColor(author.role), fontWeight: "800" } : null}>@{author.handle}</PublicTextLink> · {timeLabel}{log.editedAt ? " · edited" : ""}</Text>
          </Pressable>
          {canEdit && (
            <Pressable style={[styles.iconBtn, campaignPresentation && styles.campaignTouchTarget]} hitSlop={8} onPress={() => onEdit?.(log)} accessibilityRole="button" accessibilityLabel="Edit post">
              <Icon name="edit" size={16} color={campaignPresentation ? campaignTreatment.accentColor : colors.amber} />
            </Pressable>
          )}
          {canDelete && (
            <Pressable style={[styles.iconBtn, campaignPresentation && styles.campaignTouchTarget]} hitSlop={8} onPress={confirmDelete} accessibilityRole="button" accessibilityLabel="Delete post">
              <Icon name="trash" size={16} color={campaignPresentation ? "#FFB4AB" : colors.danger} />
            </Pressable>
          )}
          {canReport && (
            <Pressable style={[styles.iconBtn, campaignPresentation && styles.campaignTouchTarget]} hitSlop={8} onPress={() => onReport(log)} accessibilityRole="button" accessibilityLabel="Report post">
              <Icon name="flag" size={15} color={campaignPresentation ? campaignTreatment.mutedTextColor : colors.textFaint} />
            </Pressable>
          )}
        </View>

        {isStaffViewer && log.flags > 0 && (
          <View style={styles.flaggedChip} accessibilityLabel={`Reported content, ${log.flags} open ${log.flags === 1 ? "report" : "reports"}`}>
            <Icon name="flag" size={11} color={colors.danger} />
            <Text style={styles.flaggedTxt}>REPORTED · {log.flags}</Text>
          </View>
        )}

        {attendanceTicketCard ? (
          <>
            <ConcertTicketCard
              ticket={attendanceTicketCard}
              style={styles.attendanceTicketCard}
              onPress={attendanceTicketShow && onOpenShow ? () => onOpenShow(attendanceTicketShow) : undefined}
              accessibilityHint={attendanceTicketShow && onOpenShow ? "Open the exact show or event page" : undefined}
            />
            <TicketActionRail
              showHref={canonicalPostHref}
              onOpenShow={attendanceTicketShow && onOpenShow ? () => onOpenShow(attendanceTicketShow) : () => onOpen?.(log)}
              compareHref={canCompareArtistShows ? postContext.artistConcertsHref : null}
              onCompare={openArtistShows}
              artist={postContext.artist}
              palette={campaignTreatment}
            />
          </>
        ) : null}

        {!!log.review && (
          <ExpandableText
            key={`status-copy:${log.id}`}
            text={log.review}
            compact={compactContent}
            toggleTextStyle={campaignPresentation ? { color: campaignTreatment.accentColor } : null}
            renderText={({ text, accessibilityLabel }) => (
              <PublicPressableLink href={canonicalPostHref} onNavigate={() => (onComment || onOpen)?.(log)} accessibilityLabel={`${accessibilityLabel}. Open post and comments.`}>
                <Text accessibilityLabel={accessibilityLabel} style={[styles.statusText, campaignPresentation && { color: campaignTreatment.textColor }]}>{text}</Text>
              </PublicPressableLink>
            )}
          />
        )}
        <TaggedPeopleRow people={taggedPeople} onOpenProfile={onOpenProfile} selfId={session?.id} onRemoveSelf={onRemoveMyPostTag ? removeSelfTag : undefined} palette={campaignTreatment} concertContext={!!attendanceTicketCard} />
        {!!log.song && <SongAttachment song={log.song} onPlay={ENABLE_MUSIC_PLAYER ? onPlay : undefined} />}
        {statusMedia.length > 0 && (
          <PostMediaGrid media={statusMedia} viewable={mediaViewable} openerScope={log.id} onOpen={onOpenPhotos ? (i, opener) => onOpenPhotos(postMedia, postMedia.indexOf(statusMedia[i]), log.id, opener) : undefined} />
        )}

        <RecommendationWhy recommendation={recommendation} expanded={whyOpen} onToggle={() => setWhyOpen((current) => !current)} palette={campaignTreatment} />

        <View style={[styles.statusFooter, campaignPresentation && styles.campaignFooter]}>
          <NotForMeButton onPress={onNotInterested ? () => onNotInterested(log) : undefined} palette={campaignTreatment} />
          <Pressable style={({ pressed }) => [styles.fBtn, campaignPresentation && styles.campaignTouchTarget, pressed && (campaignPresentation ? styles.campaignControlPressed : styles.controlPressed)]} onPress={() => (session ? toggleLike(log.id, log.likes || 0) : onOpen?.(log))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${liked ? "Unlike" : "Like"}, ${likeCount} likes`}>
            <Icon name="heart" size={18} color={campaignPresentation ? (liked ? campaignTreatment.accentColor : campaignTreatment.mutedTextColor) : liked ? colors.magenta : colors.textDim} filled={liked} />
            <Text style={[styles.fCount, campaignPresentation && { color: liked ? campaignTreatment.accentColor : campaignTreatment.mutedTextColor }, !campaignPresentation && liked && { color: colors.magenta }]}>{likeCount}</Text>
          </Pressable>
          <PublicPressableLink href={canonicalPostHref} onNavigate={openComments} style={({ pressed }) => [styles.fBtn, campaignPresentation && styles.campaignTouchTarget, pressed && (campaignPresentation ? styles.campaignControlPressed : styles.controlPressed)]} hitSlop={8} accessibilityLabel={`Comments, ${commentCount}`}>
            <Icon name="comment" size={17} color={campaignPresentation ? campaignTreatment.mutedTextColor : colors.textDim} />
            <Text style={[styles.fCount, campaignPresentation && { color: campaignTreatment.mutedTextColor }]}>{commentCount}</Text>
          </PublicPressableLink>
          <ViewTally count={viewCount} palette={campaignTreatment} />
          <SocialShareButton
            accountId={session?.id || null}
            color={campaignPresentation ? campaignTreatment.mutedTextColor : colors.textDim}
            model={shareModel}
          />
        </View>

        {showComments && <CommentPreview log={log} onOpen={onComment || onOpen} palette={campaignTreatment} />}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* who + score */}
      <View style={styles.header}>
        <Avatar user={author} size={38} priority={avatarPriority} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined} />
        <Pressable style={{ flex: 1 }} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{author.name}</Text>
            <BadgeRow badges={userBadges(author)} size={14} />
          </View>
          <Text style={styles.sub}><PublicTextLink href={authorHref} onNavigate={log.userId ? () => onOpenProfile?.(log.userId) : undefined} style={roleColor(author.role) ? { color: roleColor(author.role), fontWeight: "800" } : null}>@{author.handle}</PublicTextLink> · {timeLabel}{log.editedAt ? " · edited" : ""}</Text>
        </Pressable>
        <Pressable
          style={[styles.scorePill, statsOpen && styles.scorePillOpen]}
          onPress={() => setStatsOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: statsOpen }}
          accessibilityLabel={`Overall ${overall.toFixed(1)} out of 5. ${statsOpen ? "Hide" : "Show"} the rating breakdown.`}
        >
          <Text style={styles.scoreNum}>{overall.toFixed(1)}</Text>
          <Stars value={overall} size={11} gap={1} />
        </Pressable>
      </View>

      {isStaffViewer && log.flags > 0 && (
        <View style={styles.flaggedChip} accessibilityLabel={`Reported content, ${log.flags} open ${log.flags === 1 ? "report" : "reports"}`}>
          <Icon name="flag" size={11} color={colors.danger} />
          <Text style={styles.flaggedTxt}>REPORTED · {log.flags}</Text>
        </View>
      )}

      <View style={styles.performanceCardShadow}>
        <View style={[styles.performanceCard, !isOnlineReview && styles.performanceCardAttached]}>
          <View style={styles.performanceRegister} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.performanceRegisterAmber} />
            <View style={styles.performanceRegisterMagenta} />
            <View style={styles.performanceRegisterCool} />
          </View>
          <View style={styles.performanceCardBody}>
            <View style={styles.performanceTopline}>
              <Text style={styles.performanceEyebrow}>{isOnlineReview ? "ONLINE CONCERT" : titledPerformance ? "CONCERT / TOUR" : "LIVE SHOW"}</Text>
              <Text style={styles.performanceArchiveMark}>{isOnlineReview ? "MSHPIT / ONLINE REVIEW" : "MSHPIT / LIVE MEMORY"}</Text>
            </View>
            <Text style={styles.performanceTitle} numberOfLines={3}>
              {performance.primaryIsArtist
                ? <PublicTextLink href={artistHref} onNavigate={() => onOpenArtist?.(log.artist)} style={styles.performanceTitle}>{performanceTitle}</PublicTextLink>
                : performanceTitle}
            </Text>
            {!!performance.secondary && <Text style={styles.performanceSubtitle} numberOfLines={2}>{performance.secondary}</Text>}
            <View style={styles.performancePerforation} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.performancePerforationLine} />
              <View style={styles.performancePerforationDot} />
              <View style={styles.performancePerforationLine} />
            </View>
            {isOnlineReview ? (
              <Text style={styles.performanceMeta}>
                <Text style={styles.performanceDate}>WATCHED ONLINE</Text>
              </Text>
            ) : (
              <>
                <Text style={styles.performanceMeta}>
                  {titledPerformance ? (
                    <><PublicTextLink href={artistHref} onNavigate={() => onOpenArtist?.(log.artist)} style={styles.performanceArtist}>{log.artist}</PublicTextLink><Text style={styles.dim}> · </Text></>
                  ) : null}
                  <PublicTextLink href={venueHref} onNavigate={() => onOpenVenue?.(log.venue)} style={styles.performanceVenue}>{log.venue}</PublicTextLink>
                  {!!log.city && <Text style={styles.dim}> · {log.city}</Text>}
                  {!!log.date && <Text style={styles.performanceDate}> · {formatDate(log.date, log.date)}</Text>}
                </Text>
                {log.seen > 1 ? <Text style={styles.seenTxt}>{ordinal(log.seen)} time in the pit</Text> : null}
              </>
            )}
          </View>
        </View>
        {!isOnlineReview ? (
          <TicketActionRail
            showHref={canonicalPostHref}
            onOpenShow={() => (onOpenShow || onOpen)?.(log)}
            compareHref={canCompareArtistShows ? postContext.artistConcertsHref : null}
            onCompare={openArtistShows}
            artist={postContext.artist}
          />
        ) : null}
      </View>

      {isOnlineReview && youtubeUrl ? (
        <View style={styles.contextActions}>
            <PublicPressableLink
              href={youtubeUrl}
              onNavigate={Platform.OS === "web" ? undefined : () => {
                void Linking.openURL(youtubeUrl).catch(() => {
                  Alert.alert("Link not opened", "YouTube could not be opened on this device.");
                });
              }}
              target={Platform.OS === "web" ? "_blank" : undefined}
              rel={Platform.OS === "web" ? "ugc nofollow noopener noreferrer" : undefined}
              style={({ pressed }) => [styles.youtubePreview, pressed && styles.contextActionPressed]}
              accessibilityLabel="Watch this online concert on YouTube"
              accessibilityHint="Opens YouTube outside Mshpit"
            >
              <ExpoImage
                source={{ uri: youtubeThumbnailUrl }}
                style={styles.youtubeThumbnail}
                contentFit="cover"
                cachePolicy="memory-disk"
                priority={avatarPriority}
                transition={reduceMotion ? 0 : 160}
                accessible={false}
                accessibilityElementsHidden
              />
              <View style={styles.youtubePreviewScrim} pointerEvents="none" />
              <View style={styles.youtubePreviewAction} pointerEvents="none">
                <Icon name="external" size={15} color="#FFFFFF" />
                <Text style={styles.youtubePreviewActionText}>Watch on YouTube</Text>
              </View>
            </PublicPressableLink>
        </View>
      ) : null}

      {/* Score analytics: the template every review shares. The twirling star +
          per-dimension bars show exactly why the night earned its score. */}
      {statsOpen && (
        <View style={styles.statsPanel}>
          <View style={styles.statsHead}>
            <SpinStar size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statsScore}>{overall.toFixed(1)} <Text style={styles.statsOutOf}>/ 5</Text></Text>
              <Text style={styles.statsSub}>{isOnlineReview ? "Your online concert score" : log.dims && Object.values(log.dims).some((v) => v > 0) ? "How the night broke down" : "Band vs room"}</Text>
            </View>
          </View>
          {isOnlineReview
            ? <Text style={styles.onlineRatingNote}>Rating for the online concert</Text>
            : <RatingBars dims={log.dims} band={band} room={room} />}
        </View>
      )}

      {/* THE REVIEW - the main event */}
      {log.review ? (
        <ExpandableText
          key={`review-copy:${log.id}`}
          text={log.review}
          compact={compactContent}
          containerStyle={styles.reviewWrap}
          renderText={({ text, accessibilityLabel }) => (
            <PublicPressableLink href={canonicalPostHref} onNavigate={isOnlineReview ? openPostDetail : () => onOpen?.(log)} accessibilityLabel={`${accessibilityLabel}. Open ${isOnlineReview ? "online concert review" : log.artist || "concert post"}.`}>
              <Text accessibilityLabel={accessibilityLabel} style={styles.review}>{text}</Text>
            </PublicPressableLink>
          )}
        />
      ) : (
        <PublicPressableLink href={canonicalPostHref} onNavigate={isOnlineReview ? openPostDetail : () => onOpen?.(log)} accessibilityLabel={`Open ${isOnlineReview ? "online concert review" : log.artist || "concert post"}`}>
          <Text style={styles.noReview}>{isOnlineReview ? "Rated this online concert - no review yet. Tap to open." : "Logged this show - no review yet. Tap to open."}</Text>
        </PublicPressableLink>
      )}
      <TaggedPeopleRow people={taggedPeople} onOpenProfile={onOpenProfile} selfId={session?.id} onRemoveSelf={onRemoveMyPostTag ? removeSelfTag : undefined} concertContext={!isOnlineReview} />
      {!!log.song && <SongAttachment song={log.song} onPlay={ENABLE_MUSIC_PLAYER ? onPlay : undefined} />}
      {postMedia.length > 0 && (
        <PostMediaGrid media={postMedia} viewable={mediaViewable} openerScope={log.id} onOpen={onOpenPhotos ? (i, opener) => onOpenPhotos(postMedia, i, log.id, opener) : undefined} />
      )}

      {!isOnlineReview && (
        <>
          {/* perforated ticket-stub line */}
          <View style={styles.perfWrap}>
            <View style={[styles.notch, { left: -8 }]} />
            <View style={styles.dashed} />
            <View style={[styles.notch, { right: -8 }]} />
          </View>

          <Pressable onPress={() => onOpen?.(log)}>
            <View style={styles.stubRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.venueLine}>
                  <PublicTextLink href={venueHref} onNavigate={() => onOpenVenue?.(log.venue)} style={styles.venueLink}>{log.venue}</PublicTextLink>
                  <Text style={styles.dim}> · {log.city}</Text>
                </Text>
                <Text style={styles.factors}>{factors}</Text>
              </View>
              <Text style={styles.date}>{formatDate(log.date, log.date)}</Text>
            </View>
          </Pressable>
        </>
      )}

      {/* setlist - de-emphasized, collapsible */}
      {!isOnlineReview && setlist.length > 0 && (
        <Pressable style={styles.setRow} onPress={() => setRevealed((v) => !v)}>
          <Icon name={revealed ? "chevron-down" : "chevron-right"} size={15} color={colors.textFaint} />
          <Text style={styles.setTitle}>SETLIST · {setlist.length}</Text>
          {!revealed && <Text style={styles.lock}>tap to reveal</Text>}
        </Pressable>
      )}
      {!isOnlineReview && revealed && setlist.length > 0 && (
        <Text style={styles.setBody}>{setlist.join("  ·  ")}</Text>
      )}

      <RecommendationWhy recommendation={recommendation} expanded={whyOpen} onToggle={() => setWhyOpen((current) => !current)} />

      {/* Post reactions and comments. Show-wide conversation lives in Lounge. */}
      <View style={styles.footer}>
        <NotForMeButton onPress={onNotInterested ? () => onNotInterested(log) : undefined} />
        <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} onPress={() => (session ? toggleLike(log.id, log.likes || 0) : isOnlineReview ? openPostDetail() : onOpen?.(log))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${liked ? "Unlike" : "Like"}, ${likeCount} likes`}>
          <Icon name="heart" size={18} color={liked ? colors.magenta : colors.textDim} filled={liked} />
          <Text style={[styles.fCount, liked && { color: colors.magenta }]}>{likeCount}</Text>
        </Pressable>
        <PublicPressableLink href={canonicalPostHref} onNavigate={openComments} style={({ pressed }) => [styles.commentAction, pressed && styles.controlPressed]} hitSlop={8} accessibilityLabel={`Comments, ${commentCount}`}>
          <Icon name="comment" size={17} color={colors.textDim} />
          <Text style={styles.commentActionText}>Comments</Text>
          <Text style={styles.fCount}>{commentCount}</Text>
        </PublicPressableLink>
        <ViewTally count={viewCount} />
        <SocialShareButton accountId={session?.id || null} model={shareModel} />
        <View style={{ flex: 1 }} />
        {canEdit && (
          <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} hitSlop={8} onPress={() => onEdit?.(log)} accessibilityRole="button" accessibilityLabel="Edit post">
            <Icon name="edit" size={16} color={colors.amber} />
          </Pressable>
        )}
        {canDelete && (
          <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} hitSlop={8} onPress={confirmDelete} accessibilityRole="button" accessibilityLabel="Delete post">
            <Icon name="trash" size={16} color={colors.danger} />
          </Pressable>
        )}
        {canReport && (
          <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} hitSlop={8} onPress={() => onReport(log)} accessibilityRole="button" accessibilityLabel="Report post">
            <Icon name="flag" size={15} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {showComments && <CommentPreview log={log} onOpen={onComment || onOpen} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 16, ...shadow.card },
  mediaStatusCard: { overflow: "hidden", borderColor: colors.lineSoft },
  mediaStatusRegister: { height: 4, flexDirection: "row", marginTop: -16, marginHorizontal: -16, marginBottom: 14 },
  mediaStatusRegisterAmber: { flex: 2, backgroundColor: colors.amberStrong },
  mediaStatusRegisterMagenta: { flex: 1, backgroundColor: colors.magenta },
  mediaStatusRegisterCool: { flex: 1, backgroundColor: colors.cool },
  campaignCard: { minHeight: 340, overflow: "hidden", padding: 12, borderColor: "rgba(242,166,90,0.42)", boxShadow: "0 18px 48px rgba(0,0,0,0.34)" },
  campaignBackdrop: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  campaignGlowLarge: { position: "absolute", width: 390, height: 390, borderRadius: 195, left: -150, top: -170 },
  campaignGlowSmall: { position: "absolute", width: 250, height: 250, borderRadius: 125, right: -90, bottom: -100 },
  campaignTopline: { zIndex: 2, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 50 },
  campaignBadge: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "72%", minHeight: 34, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: "rgba(5,6,10,0.82)", borderWidth: 1 },
  campaignBadgeText: { flexShrink: 1, fontFamily: mono, fontSize: 8.5, fontWeight: "900", letterSpacing: 1.05 },
  campaignArtworkButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: "rgba(5,6,10,0.82)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  campaignArtworkText: { color: "#FFF8EE", fontSize: 10.5, fontWeight: "800" },
  campaignContent: { zIndex: 2, padding: 14, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", boxShadow: "0 14px 34px rgba(0,0,0,0.3)" },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  attendanceTicketCard: { marginTop: space(5) },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { color: colors.text, fontFamily: displayFont, fontWeight: "800", fontSize: 14, letterSpacing: -0.1 },
  sub: { color: colors.textFaint, fontFamily: font, fontSize: 12, marginTop: 1 },
  scorePill: { alignItems: "center", backgroundColor: colors.bgElev, borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6, gap: 3, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 5px rgba(0,0,0,0.16)" },
  scorePillOpen: { borderColor: colors.gold },
  scoreNum: { color: colors.gold, fontFamily: mono, fontSize: 18, fontWeight: "800", lineHeight: 20 },
  seenTxt: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },

  flaggedChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, marginTop: 10, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, backgroundColor: "rgba(224,108,108,0.10)" },
  flaggedTxt: { color: colors.danger, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1 },

  statsPanel: { marginTop: 12, backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 12 },
  statsHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  statsScore: { color: colors.gold, fontFamily: mono, fontSize: 22, fontWeight: "900", lineHeight: 24 },
  statsOutOf: { color: colors.textFaint, fontSize: 13, fontWeight: "700" },
  statsSub: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  onlineRatingNote: { color: colors.textDim, fontSize: 12, lineHeight: 18 },

  taggedPeopleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12 },
  taggedPeopleLead: { fontSize: 11.5, fontWeight: "700" },
  taggedPersonChip: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.12)" },
  taggedPersonProfile: { minHeight: 44, maxWidth: 190, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 10 },
  taggedPersonText: { flexShrink: 1, fontSize: 11.5, fontWeight: "800" },
  taggedPersonRemove: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderLeftWidth: 1, borderLeftColor: colors.lineSoft },

  performanceCardShadow: { marginTop: 12, borderRadius: radius.md, borderCurve: "continuous", ...shadow.card },
  performanceCard: { overflow: "hidden", borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  performanceCardAttached: { borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  performanceRegister: { height: 4, flexDirection: "row" },
  performanceRegisterAmber: { flex: 2, backgroundColor: colors.amberStrong },
  performanceRegisterMagenta: { flex: 1, backgroundColor: colors.magenta },
  performanceRegisterCool: { flex: 1, backgroundColor: colors.cool },
  performanceCardBody: { paddingHorizontal: 15, paddingTop: 13, paddingBottom: 15 },
  performanceTopline: { minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 10, rowGap: 4 },
  performanceEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.35 },
  performanceArchiveMark: { flexShrink: 1, color: colors.textFaint, fontFamily: mono, fontSize: 7.5, lineHeight: 11, fontWeight: "900", letterSpacing: 1.05 },
  performanceTitle: { color: colors.text, fontFamily: displayFont, fontSize: 22, lineHeight: 26, fontWeight: "900", letterSpacing: -0.45, marginTop: 8 },
  performanceSubtitle: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 18, fontWeight: "800", marginTop: 3 },
  performancePerforation: { height: 17, flexDirection: "row", alignItems: "center", gap: 7 },
  performancePerforationLine: { flex: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.line },
  performancePerforationDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.amberStrong },
  performanceMeta: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18 },
  performanceArtist: { color: colors.text, fontWeight: "800" },
  performanceVenue: { color: colors.cool, fontWeight: "800" },
  performanceDate: { color: colors.amber, fontFamily: mono, fontSize: 11.5 },
  contextActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  contextAction: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber + "80", backgroundColor: colors.surfaceAlt },
  ticketActionRail: { minHeight: 48, flexDirection: "row", alignItems: "stretch", marginTop: -1, marginHorizontal: 12, overflow: "hidden", borderWidth: 1, borderTopWidth: 0, borderColor: colors.line, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, backgroundColor: colors.surfaceAlt },
  ticketAction: { minWidth: 0, minHeight: 48, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  ticketActionDivider: { width: 1, marginVertical: 8, backgroundColor: colors.line },
  ticketActionText: { minWidth: 0, flexShrink: 1, color: colors.text, fontSize: 11.5, lineHeight: 15, fontWeight: "900", textAlign: "center" },
  ticketActionPressed: { opacity: 0.78, backgroundColor: colors.bgElev },
  youtubePreview: { width: "100%", maxWidth: 640, aspectRatio: 16 / 9, overflow: "hidden", borderRadius: radius.lg, borderWidth: 1, borderColor: "#FF003380", backgroundColor: colors.surfaceAlt },
  youtubeThumbnail: { width: "100%", height: "100%", backgroundColor: colors.bgElev },
  youtubePreviewScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(4,4,8,0.18)" },
  youtubePreviewAction: { position: "absolute", left: 12, bottom: 12, minHeight: 40, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, borderRadius: radius.pill, backgroundColor: "rgba(12,10,13,0.88)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)" },
  youtubePreviewActionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  contextActionSecondary: { flexShrink: 1, borderColor: colors.cool + "70" },
  contextActionPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  contextActionText: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: "800" },

  reviewWrap: { borderLeftWidth: 3, borderLeftColor: colors.amber, paddingLeft: 12, marginTop: 10 },
  review: { color: colors.text, fontFamily: font, fontSize: 16, lineHeight: 24, fontWeight: "500" },
  noReview: { color: colors.textFaint, fontSize: 14, marginTop: 10, fontStyle: "italic" },

  // Status (Facebook/Twitter-style) card pieces.
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  statusText: { color: colors.text, fontFamily: font, fontSize: 16, lineHeight: 23, marginTop: 12 },
  statusFooter: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 2, marginTop: 14, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  campaignFooter: { borderTopColor: "rgba(255,255,255,0.12)" },
  campaignTouchTarget: { minWidth: 44, minHeight: 44 },
  campaignWhyWrap: { borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.06)" },
  campaignControlPressed: { backgroundColor: "rgba(255,255,255,0.10)", transform: [{ scale: 0.96 }] },

  perfWrap: { flexDirection: "row", alignItems: "center", height: 16, marginVertical: 14 },
  dashed: { flex: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.line },
  notch: { position: "absolute", width: 16, height: 16, borderRadius: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.lineSoft },

  stubRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  venueLine: { fontSize: 14 },
  venueLink: { color: colors.text, fontFamily: displayFont, fontWeight: "800" },
  dim: { color: colors.textDim },
  factors: { color: colors.textFaint, fontFamily: mono, fontSize: 11, marginTop: 4 },
  date: { color: colors.amber, fontFamily: mono, fontSize: 12, letterSpacing: 1 },

  setRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  setTitle: { color: colors.textDim, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  lock: { color: colors.textFaint, fontSize: 11, marginLeft: 4 },
  setBody: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 8 },

  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 2, marginTop: 16 },
  fBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 32, minHeight: 32, paddingHorizontal: 4, borderRadius: radius.sm },
  commentAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, borderRadius: radius.sm },
  commentActionText: { color: colors.textDim, fontSize: 12, fontWeight: "800" },
  fCount: { color: colors.textDim, fontSize: 13, fontFamily: mono },
  viewTally: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 4 },
  viewTallyText: { fontSize: 12, fontFamily: mono },
  notForMe: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingHorizontal: 6, borderRadius: radius.sm },
  notForMeTxt: { color: colors.textDim, fontSize: 11, fontWeight: "700" },
  whyWrap: { marginTop: 14, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  whyButton: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: radius.sm },
  whyLabel: { flex: 1, color: colors.text, fontSize: 12.5, fontWeight: "800" },
  whyAction: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  whyDetail: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 7 },
  controlPressed: { backgroundColor: colors.surfaceAlt, transform: [{ scale: 0.96 }] },
});
