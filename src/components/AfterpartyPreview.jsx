import { useMemo } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, font, radius } from "../theme";
import { useStore } from "../store";
import Avatar from "./Avatar";
import { inlineCommentPreview } from "../domain/commentPreview.mjs";
import { resolvePostAuthor } from "../domain/postAuthor.mjs";

// Feed cards show only the bounded preview already bundled with the post. They
// never start a comments request and never mount a composer; the complete
// thread is loaded only after someone explicitly opens Comments.
export default function CommentPreview({ log, onOpen, max = 1, palette = null }) {
  const { userById, blockedIds } = useStore();
  const limit = Math.max(0, Math.min(2, Math.trunc(Number(max) || 1)));
  const comments = useMemo(
    () => inlineCommentPreview(log.commentPreview, [], { isBlocked: (id) => blockedIds.includes(id) }),
    [log.commentPreview, blockedIds],
  );
  const visible = comments.filter((comment) => !comment.deleted);
  const total = Math.max(visible.length, Number(log.comments) || 0);
  const latest = visible.slice(-limit);
  if (total <= 0) return null;

  return (
    <View style={styles.wrap}>
      {latest.map((comment) => {
        const author = resolvePostAuthor({ userId: comment.userId, cached: userById?.(comment.userId), embedded: {
          name: comment.name,
          initials: comment.initials,
          avatarUri: comment.avatarUri,
          avatarColor: comment.avatarColor,
          profileUpdatedAt: comment.profileUpdatedAt,
        } });
        return (
          <Pressable
            key={comment.id}
            style={styles.row}
            onPress={() => onOpen?.(log)}
            accessibilityRole="button"
            accessibilityLabel={`Open comments. Latest comment from ${author.name || comment.name || "a fan"}: ${comment.text}`}
          >
            <Avatar user={author} size={26} />
            <View style={[styles.bubble, palette && styles.campaignBubble]}>
              <Text style={[styles.bubbleName, palette && { color: palette.textColor }]}>{author.name || comment.name}</Text>
              <Text style={[styles.bubbleText, palette && { color: palette.textColor }]} numberOfLines={2}>{comment.text}</Text>
            </View>
          </Pressable>
        );
      })}
      <Pressable onPress={() => onOpen?.(log)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open all ${total} comments`}>
        <Text style={[styles.viewAll, palette && { color: palette.mutedTextColor }]}>View {total === 1 ? "comment" : `all ${total} comments`}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 7 },
  viewAll: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bubble: { flex: 1, backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1, borderColor: colors.lineSoft },
  campaignBubble: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.14)" },
  bubbleName: { color: colors.text, fontFamily: font, fontSize: 12, fontWeight: "800" },
  bubbleText: { color: colors.text, fontFamily: font, fontSize: 13.5, lineHeight: 18, marginTop: 1 },
});
