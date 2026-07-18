import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Platform } from "react-native";
import { colors, font, mono, radius } from "../theme";
import { useStore } from "../store";
import Avatar from "./Avatar";
import Icon from "./Icon";

const web = Platform.OS === "web";

// The "comment section preloaded" strip that makes the feed read like Facebook /
// Twitter: the latest couple of comments sit right on the card, with a one-line
// composer under them. Tapping "View all" opens the full Afterparty (PostScreen).
// Comments are lazy-pulled once per card via the store's in-flight-guarded load.
export default function AfterpartyPreview({ log, onOpen, max = 2 }) {
  const { session, commentsFor, loadComments, addComment, userById, userBadges } = useStore();
  const comments = commentsFor(log.id);
  const [text, setText] = useState("");

  useEffect(() => { loadComments(log.id); }, [log.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = comments.length || log.comments || 0;
  const latest = comments.slice(-max);
  const send = () => {
    const value = text.trim();
    if (!value) return;
    addComment(log.id, value);
    setText("");
  };

  return (
    <View style={styles.wrap}>
      {total > latest.length && (
        <Pressable onPress={() => onOpen?.(log)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`View all ${total} comments`}>
          <Text style={styles.viewAll}>View all {total} comments</Text>
        </Pressable>
      )}

      {latest.map((c) => {
        const author = userById?.(c.userId) || { name: c.name, initials: c.initials, avatarUri: c.avatarUri, avatarColor: c.avatarColor };
        return (
          <Pressable key={c.id} style={styles.row} onPress={() => onOpen?.(log)}>
            <Avatar user={author} size={28} />
            <View style={styles.bubble}>
              <Text style={styles.bubbleName}>{author.name || c.name}</Text>
              <Text style={styles.bubbleText}>{c.text}</Text>
            </View>
          </Pressable>
        );
      })}

      {session ? (
        <View style={styles.composer}>
          <Avatar user={session} size={28} />
          <TextInput
            style={styles.input}
            placeholder="Write a comment..."
            placeholderTextColor={colors.textFaint}
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
            returnKeyType="send"
            blurOnSubmit={!web}
          />
          <Pressable style={[styles.send, !text.trim() && styles.sendOff]} onPress={send} disabled={!text.trim()} hitSlop={6} accessibilityRole="button" accessibilityLabel="Post comment">
            <Icon name="chevron-right" size={16} color={text.trim() ? "#1A1206" : colors.textFaint} />
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.signedOut} onPress={() => onOpen?.(log)}>
          <Text style={styles.signedOutTxt}>Log in to join the conversation</Text>
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
  bubbleName: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "800" },
  bubbleText: { color: colors.text, fontFamily: font, fontSize: 14, lineHeight: 19, marginTop: 1 },
  composer: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: web ? 9 : 7, fontSize: 14, ...(web ? { outlineStyle: "none" } : null) },
  send: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  sendOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  signedOut: { paddingVertical: 4 },
  signedOutTxt: { color: colors.textFaint, fontFamily: mono, fontSize: 12 },
});
