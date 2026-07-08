import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, mono, radius, shadow } from "../theme";
import Stars from "./Stars";
import Icon from "./Icon";
import Avatar from "./Avatar";
import { useStore } from "../store";

function MediaStrip({ count }) {
  return (
    <View style={styles.media}>
      {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
        <View key={i} style={styles.mediaTile}>
          <Icon name={i === 0 ? "play" : "photo"} size={16} color={colors.textFaint} />
        </View>
      ))}
      {count > 4 && <Text style={styles.mediaMore}>+{count - 4}</Text>}
    </View>
  );
}

// Review-forward feed card: the review is the centerpiece. Artist / venue / date
// sit on a ticket-stub line below, the score reads at a glance, and the footer
// opens the Afterparty (like + comments) for that concert.
export default function TicketStub({ log, onOpen, onPreview, onOpenProfile, onOpenArtist, onOpenVenue, onReport }) {
  const { userById, likeInfo, toggleLike, commentsFor, session } = useStore();
  const author = userById?.(log.userId) || { initials: log.user?.initials, name: log.user?.name, handle: log.user?.handle };
  const [revealed, setRevealed] = useState(!log.inTourWindow);

  const { count: likeCount, liked } = likeInfo(log.id, log.likes || 0);
  const commentCount = commentsFor(log.id).length || log.comments || 0;
  const factors = log.dims
    ? `Band ${log.band.toFixed(1)} · Room ${log.room.toFixed(1)} · Night ${(((log.dims.crowd || 0) + (log.dims.experience || 0)) / 2 || log.overall).toFixed(1)}`
    : `Band ${log.band.toFixed(1)} · Room ${log.room.toFixed(1)}`;

  return (
    <View style={styles.card}>
      {/* who + score */}
      <View style={styles.header}>
        <Avatar user={author} size={38} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined} />
        <Pressable style={{ flex: 1 }} onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined}>
          <Text style={styles.name}>{author.name}</Text>
          <Text style={styles.sub}>@{author.handle} · {log.timeAgo}</Text>
        </Pressable>
        <View style={styles.scorePill}>
          <Text style={styles.scoreNum}>{log.overall.toFixed(1)}</Text>
          <Stars value={log.overall} size={11} gap={1} />
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
        {log.media > 0 && <MediaStrip count={log.media} />}
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
      {log.setlist.length > 0 && (
        <Pressable style={styles.setRow} onPress={() => setRevealed((v) => !v)}>
          <Icon name={revealed ? "chevron-down" : "chevron-right"} size={15} color={colors.textFaint} />
          <Text style={styles.setTitle}>SETLIST · {log.setlist.length}</Text>
          {!revealed && <Text style={styles.lock}>tap to reveal</Text>}
        </Pressable>
      )}
      {revealed && log.setlist.length > 0 && (
        <Text style={styles.setBody}>{log.setlist.join("  ·  ")}</Text>
      )}

      {/* footer → the Afterparty */}
      <View style={styles.footer}>
        <Pressable style={styles.fBtn} onPress={() => (session ? toggleLike(log.id, log.likes || 0) : onOpen?.(log))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${liked ? "Unlike" : "Like"}, ${likeCount} likes`}>
          <Icon name="heart" size={18} color={liked ? colors.magenta : colors.textDim} filled={liked} />
          <Text style={[styles.fCount, liked && { color: colors.magenta }]}>{likeCount}</Text>
        </Pressable>
        <Pressable style={styles.fBtn} onPress={() => onOpen?.(log)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Comments, ${commentCount}`}>
          <Icon name="comment" size={17} color={colors.textDim} />
          <Text style={styles.fCount}>{commentCount}</Text>
        </Pressable>
        <Pressable style={styles.afterLink} onPress={() => onOpen?.(log)} hitSlop={8}>
          <Text style={styles.afterTxt}>Afterparty</Text>
          <Icon name="chevron-right" size={14} color={colors.amber} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.fBtn} hitSlop={8} onPress={() => onReport?.(log)} accessibilityRole="button" accessibilityLabel="Report post">
          <Icon name="flag" size={15} color={colors.textFaint} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 16, marginBottom: 16, ...shadow.card },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: colors.text, fontWeight: "700", fontSize: 14 },
  sub: { color: colors.textFaint, fontSize: 12, marginTop: 1 },
  scorePill: { alignItems: "center", backgroundColor: colors.bgElev, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 6, gap: 3 },
  scoreNum: { color: colors.gold, fontFamily: mono, fontSize: 18, fontWeight: "800", lineHeight: 20 },

  ratedLine: { color: colors.textDim, fontSize: 13, marginTop: 12 },
  artistLink: { color: colors.text, fontSize: 16, fontWeight: "800" },

  reviewWrap: { borderLeftWidth: 3, borderLeftColor: colors.amber, paddingLeft: 12, marginTop: 10 },
  review: { color: colors.text, fontSize: 17, lineHeight: 25, fontWeight: "500" },
  noReview: { color: colors.textFaint, fontSize: 14, marginTop: 10, fontStyle: "italic" },

  media: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  mediaTile: { width: 52, height: 52, borderRadius: 8, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  mediaMore: { color: colors.textFaint, fontSize: 12, marginLeft: 2 },

  perfWrap: { flexDirection: "row", alignItems: "center", height: 16, marginVertical: 14 },
  dashed: { flex: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.line },
  notch: { position: "absolute", width: 16, height: 16, borderRadius: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.lineSoft },

  stubRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  venueLine: { fontSize: 14 },
  venueLink: { color: colors.text, fontWeight: "700" },
  dim: { color: colors.textDim },
  factors: { color: colors.textFaint, fontFamily: mono, fontSize: 11, marginTop: 4 },
  date: { color: colors.amber, fontFamily: mono, fontSize: 12, letterSpacing: 1 },

  setRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  setTitle: { color: colors.textDim, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  lock: { color: colors.textFaint, fontSize: 11, marginLeft: 4 },
  setBody: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 8 },

  footer: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 16 },
  fBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  fCount: { color: colors.textDim, fontSize: 13, fontFamily: mono },
  afterLink: { flexDirection: "row", alignItems: "center", gap: 2 },
  afterTxt: { color: colors.amber, fontSize: 13, fontWeight: "700" },
});
