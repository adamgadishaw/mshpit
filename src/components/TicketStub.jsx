import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, displayFont, font, mono, radius, shadow, roleColor } from "../theme";
import Stars from "./Stars";
import Icon from "./Icon";
import Avatar from "./Avatar";
import SmartImage from "./SmartImage";
import RatingBars from "./RatingBars";
import SpinStar from "./SpinStar";
import AfterpartyPreview from "./AfterpartyPreview";
import { useStore } from "../store";
import { BadgeRow } from "./Badge";

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

const relativeTime = (timestamp) => {
  if (!timestamp) return "now";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24); return days < 30 ? `${days}d` : `${Math.floor(days / 30)}mo`;
};

// Real photo thumbnails only, never empty placeholder tiles (that reads as a
// broken/prototype UI). Renders nothing when the post has no photos. Tapping a
// thumbnail opens THAT photo full screen (Facebook-style viewer, per-photo
// likes); the +N tile opens the set at the first hidden photo.
function MediaStrip({ photos, onOpenPhoto }) {
  const shown = photos.slice(0, 4);
  return (
    <View style={styles.media}>
      {shown.map((uri, i) => (
        <SmartImage key={i} uri={uri} style={styles.mediaTile} contain={false} onPress={onOpenPhoto ? () => onOpenPhoto(i) : undefined} />
      ))}
      {photos.length > 4 && (
        <Pressable style={[styles.mediaTile, styles.mediaMoreTile]} onPress={onOpenPhoto ? () => onOpenPhoto(4) : undefined} accessibilityRole="button" accessibilityLabel={`Show ${photos.length - 4} more photos`}>
          <Text style={styles.mediaMore}>+{photos.length - 4}</Text>
        </Pressable>
      )}
    </View>
  );
}

// Status posts show photos big and edge-to-edge like Facebook/Twitter: one photo
// fills a hero frame, several fall back to the compact thumbnail strip.
function StatusMedia({ photos, onOpenPhoto }) {
  if (!photos?.length) return null;
  if (photos.length === 1) {
    return (
      <Pressable style={styles.statusHero} onPress={onOpenPhoto ? () => onOpenPhoto(0) : undefined} accessibilityRole={onOpenPhoto ? "button" : undefined} accessibilityLabel="Open photo">
        <SmartImage uri={photos[0]} style={StyleSheet.absoluteFill} contain />
      </Pressable>
    );
  }
  return <MediaStrip photos={photos} onOpenPhoto={onOpenPhoto} />;
}

// Review-forward feed card: the review is the centerpiece. Artist / venue / date
// sit on a ticket-stub line below, the score reads at a glance, and the footer
// opens the Afterparty (like + comments) for that concert.
export default function TicketStub({ log, onOpen, onComment, onPreview, onOpenProfile, onOpenArtist, onOpenVenue, onReport, onEdit, onOpenPhotos, showComments = true }) {
  const openComments = () => (onComment || onOpen)?.(log);
  const { userById, likeInfo, toggleLike, commentsFor, session, userBadges } = useStore();
  const author = userById?.(log.userId) || { initials: log.user?.initials, name: log.user?.name, handle: log.user?.handle };
  const [revealed, setRevealed] = useState(!log.inTourWindow);
  // Editing is the author's alone. Admins moderate (remove/mute/ban); they
  // never rewrite someone's review, so no admin bypass here.
  const canEdit = !!onEdit && !!session && session.id === log.userId;
  const isStaffViewer = session && (session.role === "admin" || session.role === "moderator");
  const setlist = Array.isArray(log.setlist) ? log.setlist : [];
  const timeLabel = log.timeAgo || relativeTime(log.createdAt);
  const tags = Array.isArray(log.tags) ? log.tags : [];
  // Score analytics: tap the star pill to see WHY the night got its score;
  // hovering it (web) previews the reviewer's tag words.
  const [statsOpen, setStatsOpen] = useState(false);
  const [hoverTags, setHoverTags] = useState(false);

  const { count: likeCount, liked } = likeInfo(log.id, log.likes || 0);
  const commentCount = commentsFor(log.id).length || log.comments || 0;
  // Server posts can arrive with null scores (photo-only posts); never crash the feed.
  const band = log.band ?? 0, room = log.room ?? 0, overall = log.overall ?? 0;
  const factors = log.dims
    ? `Band ${band.toFixed(1)} · Room ${room.toFixed(1)} · Night ${(((log.dims.crowd || 0) + (log.dims.experience || 0)) / 2 || overall).toFixed(1)}`
    : `Band ${band.toFixed(1)} · Room ${room.toFixed(1)}`;

  // A plain status update: a Facebook/Twitter-style social card (no ticket stub,
  // no score, no artist/venue line) with the comment section preloaded below.
  if (log.kind === "status") {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Avatar user={author} size={40} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined} />
          <Pressable style={{ flex: 1 }} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{author.name}</Text>
              <BadgeRow badges={userBadges(author)} size={14} />
            </View>
            <Text style={styles.sub}><Text style={roleColor(author.role) ? { color: roleColor(author.role), fontWeight: "800" } : null}>@{author.handle}</Text> · {timeLabel}{log.editedAt ? " · edited" : ""}</Text>
          </Pressable>
          {canEdit && (
            <Pressable style={styles.iconBtn} hitSlop={8} onPress={() => onEdit?.(log)} accessibilityRole="button" accessibilityLabel="Edit post">
              <Icon name="edit" size={16} color={colors.amber} />
            </Pressable>
          )}
          <Pressable style={styles.iconBtn} hitSlop={8} onPress={() => onReport?.(log)} accessibilityRole="button" accessibilityLabel="Report post">
            <Icon name="flag" size={15} color={colors.textFaint} />
          </Pressable>
        </View>

        {isStaffViewer && log.flags > 0 && (
          <View style={styles.flaggedChip} accessibilityLabel={`Reported content, ${log.flags} open ${log.flags === 1 ? "report" : "reports"}`}>
            <Icon name="flag" size={11} color={colors.danger} />
            <Text style={styles.flaggedTxt}>REPORTED · {log.flags}</Text>
          </View>
        )}

        {!!log.review && (
          <Pressable onPress={() => (onComment || onOpen)?.(log)}><Text style={styles.statusText}>{log.review}</Text></Pressable>
        )}
        {log.photos?.length > 0 && (
          <StatusMedia photos={log.photos} onOpenPhoto={onOpenPhotos ? (i) => onOpenPhotos(log.photos.map((uri) => ({ uri, by: log.user?.name })), i, log.id) : undefined} />
        )}

        <View style={styles.statusFooter}>
          <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} onPress={() => (session ? toggleLike(log.id, log.likes || 0) : onOpen?.(log))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${liked ? "Unlike" : "Like"}, ${likeCount} likes`}>
            <Icon name="heart" size={18} color={liked ? colors.magenta : colors.textDim} filled={liked} />
            <Text style={[styles.fCount, liked && { color: colors.magenta }]}>{likeCount}</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} onPress={openComments} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Comments, ${commentCount}`}>
            <Icon name="comment" size={17} color={colors.textDim} />
            <Text style={styles.fCount}>{commentCount}</Text>
          </Pressable>
        </View>

        {showComments && <AfterpartyPreview log={log} onOpen={onComment || onOpen} />}
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
          <Text style={styles.sub}><Text style={roleColor(author.role) ? { color: roleColor(author.role), fontWeight: "800" } : null}>@{author.handle}</Text> · {timeLabel}{log.editedAt ? " · edited" : ""}</Text>
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

      <Text style={styles.ratedLine}>
        reviewed <Text style={styles.artistLink} onPress={() => onOpenArtist?.(log.artist)}>{log.artist}</Text>
        {log.seen > 1 ? <Text style={styles.seenTxt}>  ·  {ordinal(log.seen)} time in the pit</Text> : null}
      </Text>

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
      <Pressable onPress={() => onOpen?.(log)}>
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
        {log.photos?.length > 0 && <MediaStrip photos={log.photos} onOpenPhoto={onOpenPhotos ? (i) => onOpenPhotos(log.photos.map((uri) => ({ uri, by: log.user?.name })), i, log.id) : undefined} />}
      </Pressable>

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
              <Text style={styles.venueLink} onPress={() => onOpenVenue?.(log.venue)}>{log.venue}</Text>
              <Text style={styles.dim}> · {log.city}</Text>
            </Text>
            <Text style={styles.factors}>{factors}</Text>
          </View>
          <Text style={styles.date}>{log.date}</Text>
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

      {/* footer → the Afterparty */}
      <View style={styles.footer}>
        <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} onPress={() => (session ? toggleLike(log.id, log.likes || 0) : onOpen?.(log))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${liked ? "Unlike" : "Like"}, ${likeCount} likes`}>
          <Icon name="heart" size={18} color={liked ? colors.magenta : colors.textDim} filled={liked} />
          <Text style={[styles.fCount, liked && { color: colors.magenta }]}>{likeCount}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} onPress={openComments} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Comments, ${commentCount}`}>
          <Icon name="comment" size={17} color={colors.textDim} />
          <Text style={styles.fCount}>{commentCount}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.afterLink, pressed && styles.afterPressed]} onPress={() => onOpen?.(log)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open the afterparty discussion">
          <Text style={styles.afterTxt}>Afterparty</Text>
          <Icon name="chevron-right" size={14} color={colors.amber} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {canEdit && (
          <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} hitSlop={8} onPress={() => onEdit?.(log)} accessibilityRole="button" accessibilityLabel="Edit post">
            <Icon name="edit" size={16} color={colors.amber} />
          </Pressable>
        )}
        <Pressable style={({ pressed }) => [styles.fBtn, pressed && styles.controlPressed]} hitSlop={8} onPress={() => onReport?.(log)} accessibilityRole="button" accessibilityLabel="Report post">
          <Icon name="flag" size={15} color={colors.textFaint} />
        </Pressable>
      </View>

      {showComments && <AfterpartyPreview log={log} onOpen={onOpen} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 16, ...shadow.card },
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

  ratedLine: { color: colors.textDim, fontFamily: font, fontSize: 13, marginTop: 12 },
  artistLink: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "800", letterSpacing: -0.15 },

  reviewWrap: { borderLeftWidth: 3, borderLeftColor: colors.amber, paddingLeft: 12, marginTop: 10 },
  review: { color: colors.text, fontFamily: font, fontSize: 16, lineHeight: 24, fontWeight: "500" },
  noReview: { color: colors.textFaint, fontSize: 14, marginTop: 10, fontStyle: "italic" },

  // Status (Facebook/Twitter-style) card pieces.
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  statusText: { color: colors.text, fontFamily: font, fontSize: 16, lineHeight: 23, marginTop: 12 },
  statusHero: { width: "100%", height: 300, marginTop: 12, borderRadius: radius.md, borderCurve: "continuous", overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  statusFooter: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.lineSoft },

  media: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  mediaTile: { width: 64, height: 64, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.lineSoft },
  mediaMoreTile: { alignItems: "center", justifyContent: "center" },
  mediaMore: { color: colors.textDim, fontFamily: mono, fontSize: 14, fontWeight: "700" },

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
  controlPressed: { backgroundColor: colors.surfaceAlt, transform: [{ scale: 0.96 }] },
  afterLink: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, borderWidth: 1, borderBottomWidth: 2, borderColor: colors.line, paddingHorizontal: 10, minHeight: 32, ...shadow.control },
  afterPressed: { transform: [{ translateY: 1 }], boxShadow: "inset 0 1px 2px rgba(0,0,0,0.16)" },
  afterTxt: { color: colors.amber, fontFamily: displayFont, fontSize: 13, fontWeight: "800" },
});
