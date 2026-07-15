import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, displayFont, font, mono, radius, shadow, roleColor } from "../theme";
import Stars from "./Stars";
import Icon from "./Icon";
import Avatar from "./Avatar";
import SmartImage from "./SmartImage";
import { useStore } from "../store";
import { BadgeRow } from "./Badge";

const relativeTime = (timestamp) => {
  if (!timestamp) return "now";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24); return days < 30 ? `${days}d` : `${Math.floor(days / 30)}mo`;
};

// Real photo thumbnails only, never empty placeholder tiles (that reads as a
// broken/prototype UI). Renders nothing when the post has no photos.
function MediaStrip({ photos }) {
  const shown = photos.slice(0, 4);
  return (
    <View style={styles.media}>
      {shown.map((uri, i) => (
        <SmartImage key={i} uri={uri} style={styles.mediaTile} contain={false} />
      ))}
      {photos.length > 4 && (
        <View style={[styles.mediaTile, styles.mediaMoreTile]}>
          <Text style={styles.mediaMore}>+{photos.length - 4}</Text>
        </View>
      )}
    </View>
  );
}

// Review-forward feed card: the review is the centerpiece. Artist / venue / date
// sit on a ticket-stub line below, the score reads at a glance, and the footer
// opens the Afterparty (like + comments) for that concert.
export default function TicketStub({ log, onOpen, onComment, onPreview, onOpenProfile, onOpenArtist, onOpenVenue, onReport, onEdit }) {
  const openComments = () => (onComment || onOpen)?.(log);
  const { userById, likeInfo, toggleLike, commentsFor, session, userBadges } = useStore();
  const author = userById?.(log.userId) || { initials: log.user?.initials, name: log.user?.name, handle: log.user?.handle };
  const [revealed, setRevealed] = useState(!log.inTourWindow);
  const canEdit = !!onEdit && !!session && (session.id === log.userId || session.role === "admin");
  const setlist = Array.isArray(log.setlist) ? log.setlist : [];
  const timeLabel = log.timeAgo || relativeTime(log.createdAt);

  const { count: likeCount, liked } = likeInfo(log.id, log.likes || 0);
  const commentCount = commentsFor(log.id).length || log.comments || 0;
  // Server posts can arrive with null scores (photo-only posts); never crash the feed.
  const band = log.band ?? 0, room = log.room ?? 0, overall = log.overall ?? 0;
  const factors = log.dims
    ? `Band ${band.toFixed(1)} · Room ${room.toFixed(1)} · Night ${(((log.dims.crowd || 0) + (log.dims.experience || 0)) / 2 || overall).toFixed(1)}`
    : `Band ${band.toFixed(1)} · Room ${room.toFixed(1)}`;

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
        <View style={styles.scorePill}>
          <Text style={styles.scoreNum}>{overall.toFixed(1)}</Text>
          <Stars value={overall} size={11} gap={1} />
        </View>
      </View>

      <Text style={styles.ratedLine}>
        reviewed <Text style={styles.artistLink} onPress={() => onOpenArtist?.(log.artist)}>{log.artist}</Text>
      </Text>

      {/* THE REVIEW - the main event */}
      <Pressable onPress={() => onOpen?.(log)}>
        {log.review ? (
          <View style={styles.reviewWrap}>
            <Text style={styles.review}>{log.review}</Text>
          </View>
        ) : (
          <Text style={styles.noReview}>Logged this show - no review yet. Tap to open.</Text>
        )}
        {log.photos?.length > 0 && <MediaStrip photos={log.photos} />}
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
  scoreNum: { color: colors.gold, fontFamily: mono, fontSize: 18, fontWeight: "800", lineHeight: 20 },

  ratedLine: { color: colors.textDim, fontFamily: font, fontSize: 13, marginTop: 12 },
  artistLink: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "800", letterSpacing: -0.15 },

  reviewWrap: { borderLeftWidth: 3, borderLeftColor: colors.amber, paddingLeft: 12, marginTop: 10 },
  review: { color: colors.text, fontFamily: font, fontSize: 16, lineHeight: 24, fontWeight: "500" },
  noReview: { color: colors.textFaint, fontSize: 14, marginTop: 10, fontStyle: "italic" },

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
