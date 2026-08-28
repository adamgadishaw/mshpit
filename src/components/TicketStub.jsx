import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, Platform } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, displayFont, font, mono, radius, shadow, roleColor } from "../theme";
import Stars from "./Stars";
import Icon from "./Icon";
import Avatar from "./Avatar";
import RatingBars from "./RatingBars";
import SpinStar from "./SpinStar";
import AfterpartyPreview from "./AfterpartyPreview";
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
import { artistPath, postPath, profilePath, venuePath } from "../domain/urls.mjs";

// "3rd time in the pit" needs a real ordinal, not "3th".
const ordinal = (n) => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][Math.min(n % 10, 4)] || "th"}`;
};

// Word-art tag chips: skewed, loud, but on-theme (no rainbow WordArt). Colors
// rotate through the stage-light palette so a row reads as designed, not random.
const TAG_COLORS = [colors.amber, colors.blue, colors.magenta, colors.gold];
function TagRow({ tags, center = false }) {
  if (!tags?.length) return null;
  return (
    <View style={[styles.tagRow, center && { justifyContent: "center" }]}>
      {tags.map((tag, i) => {
        const tint = TAG_COLORS[i % TAG_COLORS.length];
        return (
          <View key={tag + i} style={[styles.tagChip, { borderColor: tint, transform: [{ skewX: i % 2 ? "4deg" : "-4deg" }, { rotate: i % 2 ? "1.2deg" : "-1.2deg" }] }]}>
            <Text style={[styles.tagTxt, { color: tint }]}>{tag.toUpperCase()}</Text>
          </View>
        );
      })}
    </View>
  );
}

function TaggedPeopleRow({ people, onOpenProfile, selfId, onRemoveSelf, palette = null }) {
  const tagged = normalizeTaggedPeople(people);
  if (!tagged.length) return null;
  const textColor = palette?.textColor || colors.text;
  const borderColor = palette?.accentColor ? palette.accentColor + "70" : colors.line;
  return (
    <View style={styles.taggedPeopleRow} accessibilityLabel={`With ${tagged.map((person) => person.name).join(", ")}`}>
      <Icon name="you" size={14} color={palette?.accentColor || colors.amber} />
      <Text style={[styles.taggedPeopleLead, { color: palette?.mutedTextColor || colors.textDim }]}>with</Text>
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
        accessibilityLabel={`${recommendation.label}. ${expanded ? "Hide" : "Show"} why this was recommended.`}
        accessibilityState={{ expanded }}
      >
        <Icon name="discover" size={14} color={accent} />
        <Text style={[styles.whyLabel, { color: text }]} numberOfLines={1}>{recommendation.label}</Text>
        <Text style={[styles.whyAction, { color: accent }]}>{expanded ? "Hide why" : "Why this?"}</Text>
      </Pressable>
      {expanded && (
        <Text style={[styles.whyDetail, { color: muted }]} accessibilityLiveRegion="polite">
          {recommendation.detail} {recommendation.personalized ? "This recommendation uses your Pit preferences." : "This recommendation is community-based."}
        </Text>
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

// Review-forward feed card: the review is the centerpiece. Artist / venue / date
// sit on a ticket-stub line below, the score reads at a glance, and the footer
// opens the Afterparty (like + comments) for that concert.
export default function TicketStub({ log, mediaViewable = null, onOpen, onNotInterested, onComment, onPreview, onOpenProfile, onOpenArtist, onOpenVenue, onReport, onEdit, onDelete, onOpenPhotos, onPlay, onRemoveMyPostTag, onSelfTagRemoved, showComments = true }) {
  const openComments = () => (onComment || onOpen)?.(log);
  const { userById, likeInfo, toggleLike, commentsFor, session, userBadges, deleteOwnPost } = useStore();
  const author = userById?.(log.userId) || { initials: log.user?.initials, name: log.user?.name, handle: log.user?.handle };
  const authorHref = author?.handle ? profilePath(author.handle) : null;
  const canonicalPostHref = postPath(log.id);
  const artistHref = log.artist ? artistPath(log.artist, log.artistPublicSlug || log.artist_public_slug || null) : null;
  const venueHref = log.venue ? venuePath({
    name: log.venue,
    providerVenueId: log.providerVenueId || log.venue_provider_id || null,
    source: log.source || null,
  }) : null;
  const [revealed, setRevealed] = useState(!log.inTourWindow);
  const [whyOpen, setWhyOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const recommendation = recommendationDisclosure(log.recommendation);
  // Editing is the author's alone. Admins moderate (remove/mute/ban); they
  // never rewrite someone's review, so no admin bypass here.
  const canEdit = !!onEdit && !!session && session.id === log.userId;
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
  const setlist = Array.isArray(log.setlist) ? log.setlist : [];
  const timeLabel = log.timeAgo || relativeTime(log.createdAt);
  const tags = Array.isArray(log.tags) ? log.tags : [];
  const taggedPeople = normalizeTaggedPeople(log.taggedPeople);
  const removeSelfTag = async () => {
    const result = await onRemoveMyPostTag?.(log.id);
    if (result?.ok === false) Alert.alert("Tag not removed", result.error?.message || "Refresh the post and try again.");
    else if (result?.ok) onSelfTagRemoved?.(result);
  };
  const postMedia = mediaDisplayItems(log).map((item) => ({
    ...item,
    by: log.user?.name,
    postId: log.id,
    ownerId: log.userId,
  }));
  const campaignPresentation = artistCampaignPresentation(log.campaign, postMedia);
  const campaignBackground = campaignPresentation?.background || null;
  const campaignBackgroundIndex = campaignBackground
    ? postMedia.findIndex((item) => (item.id || item.assetId) === (campaignBackground.id || campaignBackground.assetId))
    : -1;
  const statusMedia = campaignBackground
    ? postMedia.filter((_, index) => index !== campaignBackgroundIndex)
    : postMedia;
  // Score analytics: tap the star pill to see WHY the night got its score;
  // hovering it (web) previews the reviewer's tag words.
  const [statsOpen, setStatsOpen] = useState(false);
  const [hoverTags, setHoverTags] = useState(false);

  const { count: likeCount, liked } = likeInfo(log.id, log.likes || 0);
  const commentCount = commentsFor(log.id).length || log.comments || 0;
  // Server posts can arrive with null scores (photo-only posts); never crash the feed.
  const band = log.band ?? 0, room = log.room ?? 0, overall = log.overall ?? 0;
  const performanceTitle = String(log.tour || "").trim() || log.artist || "Live show";
  const titledPerformance = !!String(log.tour || "").trim()
    && String(log.tour).trim().toLowerCase() !== String(log.artist || "").trim().toLowerCase();
  const factors = log.dims
    ? `Band ${band.toFixed(1)} · Room ${room.toFixed(1)} · Night ${(((log.dims.crowd || 0) + (log.dims.experience || 0)) / 2 || overall).toFixed(1)}`
    : `Band ${band.toFixed(1)} · Room ${room.toFixed(1)}`;

  // A plain status update: a Facebook/Twitter-style social card (no ticket stub,
  // no score, no artist/venue line) with the comment section preloaded below.
  if (log.kind === "status") {
    const campaignTreatment = campaignPresentation?.treatment;
    const campaignArtUri = campaignBackground?.url || campaignBackground?.uri || campaignBackground?.sourceUrl || null;
    return (
      <View style={[styles.card, campaignPresentation && styles.campaignCard, campaignTreatment && { backgroundColor: campaignTreatment.backgroundColor }]}>
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
                accessibilityLabel={`Open artist drop artwork${campaignBackground.altText ? `, ${campaignBackground.altText}` : ""}`}
              >
                <Icon name="photo" size={12} color="#FFF8EE" />
                <Text style={styles.campaignArtworkText}>View artwork</Text>
              </Pressable>
            )}
          </View>
        )}
        <View style={campaignPresentation ? [styles.campaignContent, { backgroundColor: campaignTreatment.contentSurfaceColor }] : null}>
        <View style={styles.header}>
          <Avatar user={author} size={40} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined} />
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

        {!!log.review && (
          <PublicPressableLink href={canonicalPostHref} onNavigate={() => (onComment || onOpen)?.(log)} accessibilityLabel="Open post and comments"><Text style={[styles.statusText, campaignPresentation && { color: campaignTreatment.textColor }]}>{log.review}</Text></PublicPressableLink>
        )}
        <TaggedPeopleRow people={taggedPeople} onOpenProfile={onOpenProfile} selfId={session?.id} onRemoveSelf={onRemoveMyPostTag ? removeSelfTag : undefined} palette={campaignTreatment} />
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
        </View>

        {showComments && <AfterpartyPreview log={log} onOpen={onComment || onOpen} palette={campaignTreatment} />}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* who + score */}
      <View style={styles.header}>
        <Avatar user={author} size={38} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined} />
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
          onHoverIn={() => setHoverTags(true)}
          onHoverOut={() => setHoverTags(false)}
          accessibilityRole="button"
          accessibilityState={{ expanded: statsOpen }}
          accessibilityLabel={`Overall ${overall.toFixed(1)} out of 5. ${statsOpen ? "Hide" : "Show"} the rating breakdown.`}
        >
          <Text style={styles.scoreNum}>{overall.toFixed(1)}</Text>
          <Stars value={overall} size={11} gap={1} />
        </Pressable>
      </View>

      {/* Hovering the score previews the reviewer's tag words (web only). */}
      {hoverTags && !statsOpen && tags.length > 0 && (
        <View style={styles.hoverTags} pointerEvents="none"><TagRow tags={tags} /></View>
      )}

      {isStaffViewer && log.flags > 0 && (
        <View style={styles.flaggedChip} accessibilityLabel={`Reported content, ${log.flags} open ${log.flags === 1 ? "report" : "reports"}`}>
          <Icon name="flag" size={11} color={colors.danger} />
          <Text style={styles.flaggedTxt}>REPORTED · {log.flags}</Text>
        </View>
      )}

      <View style={styles.performanceCard}>
        <Text style={styles.performanceEyebrow}>{titledPerformance ? "CONCERT / TOUR" : "LIVE SHOW"}</Text>
        <Text style={styles.performanceTitle} numberOfLines={2}>
          {titledPerformance
            ? performanceTitle
            : <PublicTextLink href={artistHref} onNavigate={() => onOpenArtist?.(log.artist)} style={styles.performanceTitle}>{performanceTitle}</PublicTextLink>}
        </Text>
        <Text style={styles.performanceMeta}>
          {titledPerformance ? (
            <><PublicTextLink href={artistHref} onNavigate={() => onOpenArtist?.(log.artist)} style={styles.performanceArtist}>{log.artist}</PublicTextLink><Text style={styles.dim}> · </Text></>
          ) : null}
          <PublicTextLink href={venueHref} onNavigate={() => onOpenVenue?.(log.venue)} style={styles.performanceVenue}>{log.venue}</PublicTextLink>
          {!!log.city && <Text style={styles.dim}> · {log.city}</Text>}
          {!!log.date && <Text style={styles.performanceDate}> · {formatDate(log.date, log.date)}</Text>}
        </Text>
        {log.seen > 1 ? <Text style={styles.seenTxt}>{ordinal(log.seen)} time in the pit</Text> : null}
      </View>

      {/* Score analytics: the template every review shares. The twirling star +
          per-dimension bars show exactly why the night earned its score. */}
      {statsOpen && (
        <View style={styles.statsPanel}>
          <View style={styles.statsHead}>
            <SpinStar size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statsScore}>{overall.toFixed(1)} <Text style={styles.statsOutOf}>/ 5</Text></Text>
              <Text style={styles.statsSub}>{log.dims && Object.values(log.dims).some((v) => v > 0) ? "How the night broke down" : "Band vs room"}</Text>
            </View>
          </View>
          <RatingBars dims={log.dims} band={band} room={room} />
          <TagRow tags={tags} />
        </View>
      )}

      {/* THE REVIEW - the main event */}
      <PublicPressableLink href={canonicalPostHref} onNavigate={() => onOpen?.(log)} accessibilityLabel={`Open ${log.artist || "concert"} post`}>
        {log.review ? (
          <View style={styles.reviewWrap}>
            <Text style={styles.review}>{log.review}</Text>
          </View>
        ) : tags.length > 0 ? (
          // The no-writing template: the reviewer said it in tag words instead.
          <TagRow tags={tags} />
        ) : (
          <Text style={styles.noReview}>Logged this show - no review yet. Tap to open.</Text>
        )}
      </PublicPressableLink>
      <TaggedPeopleRow people={taggedPeople} onOpenProfile={onOpenProfile} selfId={session?.id} onRemoveSelf={onRemoveMyPostTag ? removeSelfTag : undefined} />
      {!!log.song && <SongAttachment song={log.song} onPlay={ENABLE_MUSIC_PLAYER ? onPlay : undefined} />}
      {postMedia.length > 0 && (
        <PostMediaGrid media={postMedia} viewable={mediaViewable} openerScope={log.id} onOpen={onOpenPhotos ? (i, opener) => onOpenPhotos(postMedia, i, log.id, opener) : undefined} />
      )}

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

      {/* setlist - de-emphasized, collapsible */}
      {setlist.length > 0 && (
        <Pressable style={styles.setRow} onPress={() => setRevealed((v) => !v)}>
          <Icon name={revealed ? "chevron-down" : "chevron-right"} size={15} color={colors.textFaint} />
          <Text style={styles.setTitle}>SETLIST · {setlist.length}</Text>
          {!revealed && <Text style={styles.lock}>tap to reveal</Text>}
        </Pressable>
      )}
      {revealed && setlist.length > 0 && (
        <Text style={styles.setBody}>{setlist.join("  ·  ")}</Text>
      )}

      <RecommendationWhy recommendation={recommendation} expanded={whyOpen} onToggle={() => setWhyOpen((current) => !current)} />

      {/* footer → the Afterparty */}
      <View style={styles.footer}>
        <NotForMeButton onPress={onNotInterested ? () => onNotInterested(log) : undefined} />
        <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} onPress={() => (session ? toggleLike(log.id, log.likes || 0) : onOpen?.(log))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${liked ? "Unlike" : "Like"}, ${likeCount} likes`}>
          <Icon name="heart" size={18} color={liked ? colors.magenta : colors.textDim} filled={liked} />
          <Text style={[styles.fCount, liked && { color: colors.magenta }]}>{likeCount}</Text>
        </Pressable>
        <PublicPressableLink href={canonicalPostHref} onNavigate={openComments} style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} hitSlop={8} accessibilityLabel={`Comments, ${commentCount}`}>
          <Icon name="comment" size={17} color={colors.textDim} />
          <Text style={styles.fCount}>{commentCount}</Text>
        </PublicPressableLink>
        <PublicPressableLink href={canonicalPostHref} onNavigate={() => onOpen?.(log)} style={({ pressed }) => [styles.afterLink, pressed && styles.afterPressed]} hitSlop={8} accessibilityLabel="Open the afterparty discussion">
          <Text style={styles.afterTxt}>Afterparty</Text>
          <Icon name="chevron-right" size={14} color={colors.amber} />
        </PublicPressableLink>
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

      {showComments && <AfterpartyPreview log={log} onOpen={onOpen} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 16, ...shadow.card },
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
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { color: colors.text, fontFamily: displayFont, fontWeight: "800", fontSize: 14, letterSpacing: -0.1 },
  sub: { color: colors.textFaint, fontFamily: font, fontSize: 12, marginTop: 1 },
  scorePill: { alignItems: "center", backgroundColor: colors.bgElev, borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6, gap: 3, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 5px rgba(0,0,0,0.16)" },
  scorePillOpen: { borderColor: colors.gold },
  scoreNum: { color: colors.gold, fontFamily: mono, fontSize: 18, fontWeight: "800", lineHeight: 20 },
  seenTxt: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },

  hoverTags: { position: "absolute", top: 56, right: 14, zIndex: 20, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 8, ...shadow.sheet },
  flaggedChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, marginTop: 10, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, backgroundColor: "rgba(224,108,108,0.10)" },
  flaggedTxt: { color: colors.danger, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1 },

  statsPanel: { marginTop: 12, backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 12 },
  statsHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  statsScore: { color: colors.gold, fontFamily: mono, fontSize: 22, fontWeight: "900", lineHeight: 24 },
  statsOutOf: { color: colors.textFaint, fontSize: 13, fontWeight: "700" },
  statsSub: { color: colors.textFaint, fontSize: 11, marginTop: 1 },

  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" },
  tagChip: { borderWidth: 1.5, borderRadius: radius.sm, borderCurve: "continuous", paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.surfaceAlt },
  tagTxt: { fontFamily: displayFont, fontSize: 12.5, fontWeight: "900", letterSpacing: 1.4 },
  taggedPeopleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12 },
  taggedPeopleLead: { fontSize: 11.5, fontWeight: "700" },
  taggedPersonChip: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.12)" },
  taggedPersonProfile: { minHeight: 44, maxWidth: 190, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 10 },
  taggedPersonText: { flexShrink: 1, fontSize: 11.5, fontWeight: "800" },
  taggedPersonRemove: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderLeftWidth: 1, borderLeftColor: colors.lineSoft },

  performanceCard: { marginTop: 12, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  performanceEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.35 },
  performanceTitle: { color: colors.text, fontFamily: displayFont, fontSize: 19, lineHeight: 23, fontWeight: "900", letterSpacing: -0.2, marginTop: 4 },
  performanceMeta: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  performanceArtist: { color: colors.text, fontWeight: "800" },
  performanceVenue: { color: colors.cool, fontWeight: "800" },
  performanceDate: { color: colors.amber, fontFamily: mono, fontSize: 11.5 },

  reviewWrap: { borderLeftWidth: 3, borderLeftColor: colors.amber, paddingLeft: 12, marginTop: 10 },
  review: { color: colors.text, fontFamily: font, fontSize: 16, lineHeight: 24, fontWeight: "500" },
  noReview: { color: colors.textFaint, fontSize: 14, marginTop: 10, fontStyle: "italic" },

  // Status (Facebook/Twitter-style) card pieces.
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  statusText: { color: colors.text, fontFamily: font, fontSize: 16, lineHeight: 23, marginTop: 12 },
  statusFooter: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.lineSoft },
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

  footer: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
  fBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 32, minHeight: 32, paddingHorizontal: 4, borderRadius: radius.sm },
  fCount: { color: colors.textDim, fontSize: 13, fontFamily: mono },
  notForMe: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingHorizontal: 6, borderRadius: radius.sm },
  notForMeTxt: { color: colors.textDim, fontSize: 11, fontWeight: "700" },
  whyWrap: { marginTop: 14, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  whyButton: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: radius.sm },
  whyLabel: { flex: 1, color: colors.text, fontSize: 12.5, fontWeight: "800" },
  whyAction: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  whyDetail: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 7 },
  controlPressed: { backgroundColor: colors.surfaceAlt, transform: [{ scale: 0.96 }] },
  afterLink: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, borderWidth: 1, borderBottomWidth: 2, borderColor: colors.line, paddingHorizontal: 10, minHeight: 32, ...shadow.control },
  afterPressed: { transform: [{ translateY: 1 }], boxShadow: "inset 0 1px 2px rgba(0,0,0,0.16)" },
  afterTxt: { color: colors.amber, fontFamily: displayFont, fontSize: 13, fontWeight: "800" },
});
