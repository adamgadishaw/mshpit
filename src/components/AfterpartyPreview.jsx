import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Platform } from "react-native";
import { colors, font, mono, radius } from "../theme";
import { useStore } from "../store";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { inlineCommentPreview } from "../domain/commentPreview.mjs";

const web = Platform.OS === "web";

// The "comment section preloaded" strip that makes the feed read like Facebook /
// Twitter: the latest couple of comments sit right on the card, with a one-line
// composer under them. Tapping "View all" opens the full Afterparty (PostScreen).
// Comments are lazy-pulled once per card via the store's in-flight-guarded load.
export default function AfterpartyPreview({ log, onOpen, max = 2, palette = null }) {
  const { session, commentsFor, loadComments, addComment, userById, blockedIds } = useStore();
  const localComments = commentsFor(log.id);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // Current feed/profile responses carry the latest two comments in the same
  // request. Only legacy/local post shapes without that field use the old lazy
  // read; this removes the one-request-per-card mount storm on phones.
  useEffect(() => {
    if (!Array.isArray(log.commentPreview) && Number(log.comments) > 0) loadComments(log.id, { limit: max });
    // Store actions are intentionally not dependencies: the legacy monolithic
    // context recreates them on each render and would restart this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.id, max, log.comments, log.commentPreview]);
  const comments = useMemo(
    () => inlineCommentPreview(log.commentPreview, localComments, { isBlocked: (id) => blockedIds.includes(id) }),
    [log.commentPreview, localComments, blockedIds],
  );

  // Deleted parents come back as tombstones so their replies keep their place in
  // the full thread. A two-line card preview has no room for that context, so it
  // shows only real comments; PostScreen and the Afterparty still render them.
  const visible = comments.filter((c) => !c.deleted);
  const total = Math.max(visible.length, Number(log.comments) || 0);
  const latest = visible.slice(-max);
  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      const result = await addComment(log.id, value);
      if (result?.ok !== false) setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {total > latest.length && (
        <Pressable onPress={() => onOpen?.(log)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`View all ${total} comments`}>
          <Text style={[styles.viewAll, palette && { color: palette.mutedTextColor }]}>View all {total} comments</Text>
        </Pressable>
      )}

      {latest.map((c) => {
        const author = userById?.(c.userId) || { name: c.name, initials: c.initials, avatarUri: c.avatarUri, avatarColor: c.avatarColor };
        return (
          <Pressable key={c.id} style={styles.row} onPress={() => onOpen?.(log)}>
            <Avatar user={author} size={28} />
            <View style={[styles.bubble, palette && styles.campaignBubble]}>
              <Text style={[styles.bubbleName, palette && { color: palette.textColor }]}>{author.name || c.name}</Text>
              <Text style={[styles.bubbleText, palette && { color: palette.textColor }]}>{c.text}</Text>
            </View>
          </Pressable>
        );
      })}

      {session ? (
        <View style={styles.composer}>
          <Avatar user={session} size={28} />
          <TextInput
            style={[styles.input, palette && styles.campaignInput, palette && { color: palette.textColor }]}
            placeholder="Write a comment..."
            placeholderTextColor={palette?.mutedTextColor || colors.textFaint}
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
            editable={!sending}
            returnKeyType="send"
            blurOnSubmit={!web}
          />
          <Pressable style={[styles.send, palette && styles.campaignSend, palette && { backgroundColor: palette.accentColor }, (!text.trim() || sending) && styles.sendOff, palette && (!text.trim() || sending) && styles.campaignSendOff]} onPress={send} disabled={!text.trim() || sending} hitSlop={6} accessibilityRole="button" accessibilityLabel="Post comment">
            <Icon name="chevron-right" size={16} color={text.trim() ? "#1A1206" : palette?.mutedTextColor || colors.textFaint} />
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.signedOut} onPress={() => onOpen?.(log)}>
          <Text style={[styles.signedOutTxt, palette && { color: palette.mutedTextColor }]}>Log in to join the conversation</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, gap: 9 },
  viewAll: { color: colors.textDim, fontFamily: font, fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bubble: { flex: 1, backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.lineSoft },
  campaignBubble: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.14)" },
  bubbleName: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "800" },
  bubbleText: { color: colors.text, fontFamily: font, fontSize: 14, lineHeight: 19, marginTop: 1 },
  composer: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: web ? 9 : 7, fontSize: 14, ...(web ? { outlineStyle: "none" } : null) },
  campaignInput: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.16)" },
  send: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  campaignSend: { width: 44, height: 44, borderRadius: 22 },
  sendOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  campaignSendOff: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.16)" },
  signedOut: { paddingVertical: 4 },
  signedOutTxt: { color: colors.textFaint, fontFamily: mono, fontSize: 12 },
});
