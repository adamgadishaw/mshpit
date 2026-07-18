import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { colors, mono, radius, roleColor } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import TicketStub from "../components/TicketStub";
import { BadgeRow } from "../components/Badge";

const ago = (ts) => {
  if (!ts) return "";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

// One comment row + its nested replies. A reply-to-comment is indented and shows
// who it answers, so the thread reads like a forum, not a flat list.
function CommentNode({ c, replies, depth, onReply, onOpenProfile, userById, userBadges }) {
  const author = userById?.(c.userId) || { name: c.name, initials: c.initials, avatarUri: c.avatarUri, avatarColor: c.avatarColor, role: c.role, verified: c.verified };
  return (
    <View style={depth > 0 ? styles.replyWrap : null}>
      <View style={styles.cRow}>
        <Avatar user={author} size={30} onPress={c.userId ? () => onOpenProfile?.(c.userId) : undefined} />
        <View style={{ flex: 1 }}>
          <View style={styles.cHead}>
            <Pressable onPress={c.userId ? () => onOpenProfile?.(c.userId) : undefined}>
              <Text style={[styles.cName, roleColor(author.role) && { color: roleColor(author.role) }]}>{author.name}</Text>
            </Pressable>
            <BadgeRow badges={userBadges(author)} size={12} />
            <Text style={styles.cTime}>· {ago(c.at)}</Text>
          </View>
          <Text style={styles.cText}>{c.text}</Text>
          <Pressable onPress={() => onReply(c)} hitSlop={6}><Text style={styles.replyBtn}>Reply</Text></Pressable>
        </View>
      </View>
      {replies.map((r) => (
        <CommentNode key={r.id} c={r.c} replies={r.replies} depth={depth + 1} onReply={onReply} onOpenProfile={onOpenProfile} userById={userById} userBadges={userBadges} />
      ))}
    </View>
  );
}

// Post detail — the actual post + its comment thread. This is where like/comment
// notifications land (not the performance page), and where forum-style replies live.
export default function PostScreen({ log, onClose, onOpenProfile, onOpenArtist, onOpenVenue, onOpenShow, onReport, onEdit, onOpenPhotos }) {
  const { session, feed, commentsFor, addComment, loadComments, userById, userBadges } = useStore();
  // Navigation keeps the post that was originally opened. Resolve it against
  // live feed state so an edit made on this screen appears immediately.
  const activeLog = feed.find((post) => post.id === log.id) || log;
  const flat = commentsFor(log.id);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null); // { id, name } or null (= reply to the post)
  const scrollRef = useRef(null);

  // Live comments: hydrate + poll so replies appear without a refresh.
  useEffect(() => {
    loadComments(log.id);
    const t = setInterval(() => loadComments(log.id), 4000);
    return () => clearInterval(t);
  }, [log.id]);

  // Build the reply tree. Anything whose parent isn't present is treated as a
  // top-level reply to the post, so nothing is ever hidden.
  const tree = useMemo(() => {
    const byId = new Map(flat.map((c) => [c.id, c]));
    const kids = {};
    const roots = [];
    for (const c of flat) {
      const p = c.parentId && byId.has(c.parentId) ? c.parentId : null;
      if (p) (kids[p] ||= []).push(c); else roots.push(c);
    }
    const build = (c) => ({ c, replies: (kids[c.id] || []).map(build) });
    return roots.map(build);
  }, [flat]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    addComment(log.id, t, replyTo?.id || null);
    setText(""); setReplyTo(null);
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="POST" title="Comments" onBack={onClose} />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TicketStub log={activeLog} showComments={false} onOpen={() => onOpenShow?.(activeLog)} onOpenProfile={onOpenProfile} onOpenArtist={onOpenArtist} onOpenVenue={onOpenVenue} onReport={onReport} onEdit={onEdit} onOpenPhotos={onOpenPhotos} />

        <Text style={styles.sectionLabel}>{flat.length} COMMENT{flat.length === 1 ? "" : "S"}</Text>
        {tree.length === 0 && <Text style={styles.empty}>No comments yet. Start the conversation.</Text>}
        {tree.map((node) => (
          <CommentNode key={node.c.id} c={node.c} replies={node.replies} depth={0} onReply={(c) => setReplyTo({ id: c.id, name: c.name || userById?.(c.userId)?.name })} onOpenProfile={onOpenProfile} userById={userById} userBadges={userBadges} />
        ))}
        <View style={{ height: 20 }} />
      </ScrollView>

      {session ? (
        <View style={styles.composerWrap}>
          {replyTo && (
            <View style={styles.replyingTo}>
              <Text style={styles.replyingTxt} numberOfLines={1}>Replying to {replyTo.name || "comment"}</Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8}><Icon name="x" size={13} color={colors.textDim} /></Pressable>
            </View>
          )}
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder={replyTo ? "Write a reply..." : "Reply to this post..."}
              placeholderTextColor={colors.textFaint}
              value={text}
              onChangeText={setText}
              onSubmitEditing={send}
              returnKeyType="send"
              multiline
              maxLength={2000}
            />
            <Pressable style={[styles.send, !text.trim() && styles.sendOff]} onPress={send} disabled={!text.trim()}>
              <Icon name="chevron-right" size={18} color="#1A1206" />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.composerWrap}><Text style={styles.signin}>Sign in to comment.</Text></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 24 },
  sectionLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginTop: 4, marginBottom: 12 },
  empty: { color: colors.textDim, fontSize: 14, fontStyle: "italic", marginBottom: 12 },
  cRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  replyWrap: { marginLeft: 22, borderLeftWidth: 2, borderLeftColor: colors.lineSoft, paddingLeft: 12 },
  cHead: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  cName: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  cTime: { color: colors.textFaint, fontSize: 11, fontFamily: mono },
  cText: { color: colors.text, fontSize: 14.5, lineHeight: 21, marginTop: 3 },
  replyBtn: { color: colors.amber, fontSize: 12.5, fontWeight: "700", marginTop: 6 },
  composerWrap: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bgElev, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
  replyingTo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 6, paddingBottom: 8 },
  replyingTxt: { color: colors.amber, fontSize: 12.5, fontWeight: "700", flex: 1 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  sendOff: { opacity: 0.4 },
  signin: { color: colors.textDim, fontSize: 13, textAlign: "center", paddingVertical: 6 },
});
