import { useState, useEffect } from "react";
import { Alert, Platform, View, Text, StyleSheet, Pressable, TextInput, Linking } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import { afterpartySearches } from "../lib/afterparty";
import Icon from "./Icon";
import Avatar from "./Avatar";
import { LIMITS } from "../domain/validation.mjs";

const typeIcon = (t) => (t === "food" ? "food" : t === "activity" ? "star" : "drink");

export default function AfterpartySection({ log, coord, onOpenProfile, onRequireAuth }) {
  const { session, commentsFor, addComment, deleteOwnComment, loadComments, likeInfo, toggleLike } = useStore();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const nearbySearches = afterpartySearches(coord);
  const thread = commentsFor(log.id);
  // Hydrate this post's comments from the server (slice 3). No-op for bundled demo
  // posts, which keep their seed comments.
  useEffect(() => { if (log.id) loadComments(log.id); }, [log.id]);
  const { count, liked } = likeInfo(log.id, log.likes || 0);

  const post = async () => {
    if (!session) return onRequireAuth?.();
    if (!draft.trim() || sending) return;
    setSending(true);
    const result = await addComment(log.id, draft, replyTo?.id || null);
    setSending(false);
    if (result?.ok) { setDraft(""); setReplyTo(null); }
  };

  const removeComment = (comment) => {
    const run = () => deleteOwnComment(log.id, comment.id);
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm("Delete this comment? Replies will stay in the thread.")) run();
      return;
    }
    Alert.alert("Delete comment?", "Replies will stay in the thread.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: run },
    ]);
  };

  return (
    <View>
      <View style={styles.headRow}>
        <Text style={styles.afterTitle}>AFTERPARTY</Text>
        <Pressable style={styles.likeBtn} onPress={() => (session ? toggleLike(log.id, log.likes || 0) : onRequireAuth?.())}>
          <Icon name="heart" filled={liked} size={16} color={liked ? colors.magenta : colors.textDim} />
          <Text style={[styles.likeTxt, liked && { color: colors.magenta }]}>{count}</Text>
        </Pressable>
      </View>

      {/* Live category searches; Pit intentionally makes no business/hour claims. */}
      <Text style={styles.sub}>EXPLORE NEAR THE VENUE</Text>
      {nearbySearches.length > 0 ? (
        <>
          <Text style={styles.nearbyNote}>
            Opens live Google Maps results. Verify hours, distance, age rules, and accessibility before you go.
          </Text>
          {nearbySearches.map((search) => (
            <Pressable
              key={search.id}
              style={styles.spot}
              onPress={() => { void Linking.openURL(search.url).catch(() => {}); }}
              accessibilityRole="link"
              accessibilityLabel={`Search Google Maps for ${search.label} near ${log.venue || "the venue"}`}
            >
              <View style={styles.spotIcon}>
                <Icon name={typeIcon(search.type)} size={16} color={colors.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.spotName}>{search.label}</Text>
                <Text style={styles.spotMeta}>{search.description}</Text>
              </View>
              <View style={styles.linkBtn}>
                <Text style={styles.linkTxt}>Search Maps</Text>
                <Icon name="external" size={13} color={colors.amber} />
              </View>
            </Pressable>
          ))}
        </>
      ) : (
        <View style={styles.unavailable} accessibilityRole="text">
          <Icon name="pin" size={17} color={colors.textDim} />
          <View style={{ flex: 1 }}>
            <Text style={styles.unavailableTitle}>Nearby search unavailable</Text>
            <Text style={styles.unavailableText}>Pit does not have a verified location for this venue, so it will not guess at nearby businesses or hours.</Text>
          </View>
        </View>
      )}

      {/* discussion */}
      <Text style={styles.sub}>DISCUSSION · {thread.length}</Text>
      {replyTo && (
        <View style={styles.replyingTo}>
          <Text style={styles.replyingText} numberOfLines={1}>Replying to {replyTo.name || "comment"}</Text>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}><Icon name="x" size={13} color={colors.textDim} /></Pressable>
        </View>
      )}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={session ? "Add to the afterparty…" : "Log in to comment"}
          placeholderTextColor={colors.textFaint}
          value={draft}
          onChangeText={setDraft}
          editable={!!session && !sending}
          onSubmitEditing={post}
          returnKeyType="send"
          maxLength={LIMITS.message}
        />
        <Pressable style={[styles.send, (!draft.trim() || sending) && { opacity: 0.4 }]} onPress={post} disabled={!draft.trim() || sending}>
          <Icon name="chevron-right" size={18} color="#1A1206" />
        </Pressable>
      </View>

      {thread.length === 0 && <Text style={styles.empty}>No comments yet - start the afterparty.</Text>}
      {thread.map((c) => (
        <View key={c.id} style={[styles.comment, c.parentId && styles.commentReply]}>
          {c.deleted
            ? <View style={styles.deletedAvatar}><Icon name="x" size={12} color={colors.textFaint} /></View>
            : <Avatar user={{ initials: c.initials, name: c.name }} size={30} onPress={c.userId ? () => onOpenProfile?.(c.userId) : undefined} />}
          <View style={{ flex: 1 }}>
            {c.deleted ? <Text style={styles.deletedText}>Comment deleted</Text> : <>
              <Text style={styles.cName}>{c.name}</Text>
              <Text style={styles.cText}>{c.text}</Text>
              <View style={styles.commentActions}>
                <Pressable onPress={() => setReplyTo({ id: c.id, name: c.name })} hitSlop={6}><Text style={styles.replyBtn}>Reply</Text></Pressable>
                {session?.id === c.userId && <Pressable onPress={() => removeComment(c)} hitSlop={6}><Text style={styles.deleteBtn}>Delete</Text></Pressable>}
              </View>
            </>}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  afterTitle: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: 0.5 },
  likeBtn: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  likeTxt: { color: colors.textDim, fontFamily: mono, fontSize: 13, fontWeight: "700" },
  sub: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 18, marginBottom: 10 },
  nearbyNote: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  spot: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  spotIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  spotName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  spotMeta: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7 },
  linkTxt: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  unavailable: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 13 },
  unavailableTitle: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  unavailableText: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 3 },
  composer: { flexDirection: "row", gap: 8, alignItems: "center" },
  replyingTo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, paddingHorizontal: 4 },
  replyingText: { color: colors.amber, fontSize: 12.5, fontWeight: "700", flex: 1 },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", marginTop: 10 },
  comment: { flexDirection: "row", gap: 10, marginTop: 14 },
  commentReply: { marginLeft: 22, borderLeftWidth: 2, borderLeftColor: colors.lineSoft, paddingLeft: 10 },
  deletedAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.lineSoft, alignItems: "center", justifyContent: "center" },
  cName: { color: colors.text, fontSize: 13, fontWeight: "700" },
  cText: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginTop: 2 },
  deletedText: { color: colors.textFaint, fontSize: 13.5, fontStyle: "italic", paddingTop: 5 },
  commentActions: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 5 },
  replyBtn: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  deleteBtn: { color: colors.danger, fontSize: 12, fontWeight: "700" },
});
