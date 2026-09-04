import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { colors, mono, radius, roleColor } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import TicketStub from "../components/TicketStub";
import { BadgeRow } from "../components/Badge";
import { LIMITS } from "../domain/validation.mjs";
import { applyPostLocalOverride, withRemovedSelfPostTag } from "../domain/postLocalOverrides.mjs";
import { accountTargetScope } from "../domain/screenScope.mjs";
import { PublicTextLink } from "../components/PublicWebLinks";
import { profilePath } from "../domain/urls.mjs";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import { resolvePostAuthor } from "../domain/postAuthor.mjs";

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
function CommentNode({ c, replies, depth, onReply, onDelete, onReport, sessionId, onOpenProfile, userById, userBadges }) {
  const author = resolvePostAuthor({ userId: c.userId, cached: userById?.(c.userId), embedded: { name: c.name, initials: c.initials, avatarUri: c.avatarUri, avatarColor: c.avatarColor, role: c.role, verified: c.verified, profileUpdatedAt: c.profileUpdatedAt } });
  const own = !c.deleted && !!sessionId && c.userId === sessionId;
  return (
    <View style={depth > 0 ? (depth <= 3 ? styles.replyWrap : styles.deepReplyWrap) : null}>
      <View style={styles.cRow}>
        {c.deleted
          ? <View style={styles.deletedAvatar}><Icon name="x" size={12} color={colors.textFaint} /></View>
          : <Avatar user={author} size={30} onPress={c.userId ? () => onOpenProfile?.(c.userId) : undefined} />}
        <View style={{ flex: 1 }}>
          <View style={styles.cHead}>
            {!c.deleted && (
              <PublicTextLink
                href={author.handle ? profilePath(author.handle) : null}
                onNavigate={c.userId ? () => onOpenProfile?.(c.userId) : undefined}
                style={[styles.cName, roleColor(author.role) && { color: roleColor(author.role) }]}
              >
                {author.name}
              </PublicTextLink>
            )}
            {!c.deleted && <BadgeRow badges={userBadges(author)} size={12} />}
            <Text style={styles.cTime}>· {ago(c.at)}</Text>
          </View>
          <Text style={[styles.cText, c.deleted && styles.deletedText]}>{c.deleted ? "Comment deleted" : c.text}</Text>
          {!c.deleted && <View style={styles.commentActions}>
            <Pressable onPress={() => onReply(c)} hitSlop={6}><Text style={styles.replyBtn}>Reply</Text></Pressable>
            {own && <Pressable onPress={() => onDelete(c)} hitSlop={6}><Text style={styles.deleteBtn}>Delete</Text></Pressable>}
            {!own && c.userId && onReport ? (
              <Pressable
                onPress={() => onReport({
                  targetType: "comment",
                  targetId: c.id,
                  ownerId: c.userId,
                  targetName: "comment",
                  title: `Comment by ${author.name || c.name || "a member"}`,
                  summary: c.text,
                })}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Report comment by ${author.name || c.name || "this member"}`}
              >
                <Text style={styles.reportBtn}>Report</Text>
              </Pressable>
            ) : null}
          </View>}
        </View>
      </View>
      {replies.map((r) => (
        <CommentNode key={r.c.id} c={r.c} replies={r.replies} depth={depth + 1} onReply={onReply} onDelete={onDelete} onReport={onReport} sessionId={sessionId} onOpenProfile={onOpenProfile} userById={userById} userBadges={userBadges} />
      ))}
    </View>
  );
}

// Post detail — the actual post + its comment thread. This is where like/comment
// notifications land (not the performance page), and where forum-style replies live.
export default function PostScreen({ log, onClose, onOpenProfile, onOpenArtist, onOpenArtistArchive, onOpenVenue, onOpenShow, onReport, onEdit, onOpenPhotos, onPlay, onRemoveMyPostTag }) {
  const { session, feed, commentsFor, addComment, deleteOwnComment, deleteOwnPost, loadComments, userById, userBadges } = useStore();
  const [postLocalOverrides, setPostLocalOverrides] = useState({});
  // Navigation keeps the post that was originally opened. Resolve it against
  // live feed state so an edit made on this screen appears immediately. A
  // server-confirmed self-untag also overlays notification-fetched posts that
  // were never part of this feed page.
  const activeLog = applyPostLocalOverride(
    feed.find((post) => post.id === log.id) || log,
    postLocalOverrides,
    session?.id || null,
  );
  const isOnlineReview = activeLog.experienceType === "online" || activeLog.experience_type === "online";
  const reconcileSelfTagRemoval = (result) => {
    if (!result?.userId || !result?.id) return;
    setPostLocalOverrides((current) => withRemovedSelfPostTag(current, {
      accountId: result.userId,
      postId: result.id,
      userId: result.userId,
      version: result.version,
    }));
  };
  const flat = commentsFor(log.id);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null); // { id, name } or null (= reply to the post)
  const [sending, setSending] = useState(false);
  const commentScope = accountTargetScope(session?.id, `post-comments:${String(log.id || "")}`);
  const [commentRequestVersion, setCommentRequestVersion] = useState(0);
  const [commentResource, setCommentResource] = useState(() => ({
    scope: commentScope,
    status: flat.length > 0 ? "refreshing" : "loading",
    loaded: flat.length > 0,
    error: null,
  }));
  const scrollRef = useRef(null);
  const commentScopeRef = useRef(commentScope);
  commentScopeRef.current = commentScope;

  // Hydrate once on open (and on an explicit retry). Comments are not a live
  // chat, so this detail screen no longer spends a request every 15 seconds.
  useEffect(() => {
    const controller = new AbortController();
    const scope = commentScope;
    const hasCachedComments = flat.length > 0;
    setCommentResource((current) => {
      const loaded = current.scope === scope ? current.loaded : hasCachedComments;
      return { scope, status: loaded ? "refreshing" : "loading", loaded, error: null };
    });
    void loadComments(log.id, { limit: 50, force: true, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || commentScopeRef.current !== scope) return;
      setCommentResource((current) => {
        const loaded = current.scope === scope && current.loaded;
        if (result?.ok) return { scope, status: "ready", loaded: true, error: null };
        return {
          scope,
          status: loaded ? "stale" : "error",
          loaded,
          error: result?.error || new Error("Comments could not be loaded."),
        };
      });
    });
    return () => controller.abort();
    // Store actions are intentionally excluded: they are recreated as store state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentScope, commentRequestVersion]);

  const postRefreshScope = refreshScope(session?.id, "post", log.id);
  const { refresh: refreshPost, refreshing: postRefreshing } = useScopedRefresh({
    scope: postRefreshScope,
    task: async ({ signal }) => {
      const scope = commentScope;
      setCommentResource((current) => ({
        scope,
        status: current.scope === scope && current.loaded ? "refreshing" : "loading",
        loaded: current.scope === scope && current.loaded,
        error: null,
      }));
      const result = await loadComments(log.id, { limit: 50, force: true, signal });
      if (signal.aborted || commentScopeRef.current !== scope) return { stale: true };
      setCommentResource((current) => {
        const loaded = result?.ok || (current.scope === scope && current.loaded);
        return {
          scope,
          status: result?.ok ? "ready" : loaded ? "stale" : "error",
          loaded,
          error: result?.ok ? null : result?.error || new Error("Comments could not be loaded."),
        };
      });
      if (!result?.ok && result?.error) throw result.error;
      return result;
    },
  });

  // Never present another post's request state while navigation swaps the post
  // prop on this mounted screen.
  const scopedCommentResource = commentResource.scope === commentScope
    ? commentResource
    : { scope: commentScope, status: "loading", loaded: flat.length > 0, error: null };
  const commentsUsable = scopedCommentResource.loaded;
  const commentsPending = !commentsUsable && scopedCommentResource.status === "loading";
  const commentErrorMessage = scopedCommentResource.error?.userMessage
    || "The comment thread could not be reached. Check your connection and try again.";

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

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const result = await addComment(log.id, t, replyTo?.id || null);
    setSending(false);
    if (result?.ok) { setText(""); setReplyTo(null); }
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

  // Deleting the post you're viewing must also leave this now-empty screen.
  const removePost = (postId) => { deleteOwnPost(postId); onClose?.(); };

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        kicker={isOnlineReview ? "ONLINE CONCERT REVIEW" : activeLog.review ? "REVIEW" : "POST"}
        title="Original post"
        onBack={onClose}
        backLabel="Leave the original post"
        backHint={isOnlineReview ? "Returns to the page or feed you came from" : "Returns to the show, artist, or feed you came from"}
      />
      <VinylRefreshBoundary
        refreshing={postRefreshing}
        onRefresh={refreshPost}
        accessibilityLabel="Refresh post and comments"
      >
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TicketStub log={activeLog} compactContent={false} showComments={false} onOpen={isOnlineReview ? undefined : () => onOpenShow?.(activeLog)} onOpenShow={isOnlineReview ? undefined : onOpenShow} onOpenProfile={onOpenProfile} onOpenArtist={onOpenArtist} onOpenArtistArchive={isOnlineReview ? undefined : onOpenArtistArchive} onOpenVenue={isOnlineReview ? undefined : onOpenVenue} onReport={onReport} onEdit={onEdit} onDelete={removePost} onOpenPhotos={onOpenPhotos} onPlay={onPlay} onRemoveMyPostTag={onRemoveMyPostTag} onSelfTagRemoved={reconcileSelfTagRemoval} />

        <Text style={styles.sectionLabel}>
          {commentsUsable ? `${flat.length} COMMENT${flat.length === 1 ? "" : "S"}` : "COMMENTS"}
        </Text>
        {commentsPending ? (
          <View style={styles.threadState} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.amber} />
            <Text style={styles.threadStateText}>Loading comments...</Text>
          </View>
        ) : null}
        {scopedCommentResource.status === "error" || scopedCommentResource.status === "stale" ? (
          <View style={styles.threadError} accessibilityLiveRegion="polite">
            <Text style={styles.threadErrorTitle}>
              {scopedCommentResource.status === "stale" ? "Comments may be out of date" : "Comments are unavailable"}
            </Text>
            <Text style={styles.threadErrorCopy}>{commentErrorMessage}</Text>
            <Pressable
              style={styles.retry}
              onPress={() => setCommentRequestVersion((version) => version + 1)}
              accessibilityRole="button"
              accessibilityLabel="Retry loading comments"
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {commentsUsable && tree.length === 0 ? <Text style={styles.empty}>No comments yet. Start the conversation.</Text> : null}
        {commentsUsable ? tree.map((node) => (
          <CommentNode key={node.c.id} c={node.c} replies={node.replies} depth={0} onReply={(c) => setReplyTo({ id: c.id, name: c.name || userById?.(c.userId)?.name })} onDelete={removeComment} onReport={onReport} sessionId={session?.id} onOpenProfile={onOpenProfile} userById={userById} userBadges={userBadges} />
        )) : null}
        <View style={{ height: 20 }} />
      </ScrollView>
      </VinylRefreshBoundary>

      {!commentsUsable ? (
        <View style={styles.composerWrap}>
          <Text style={styles.signin}>{commentsPending ? "Connecting to comments..." : "Reconnect to the thread to comment."}</Text>
        </View>
      ) : session ? (
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
              maxLength={LIMITS.message}
            />
            <Pressable style={[styles.send, (!text.trim() || sending) && styles.sendOff]} onPress={send} disabled={!text.trim() || sending} accessibilityRole="button" accessibilityLabel={sending ? "Sending comment" : "Send comment"}>
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
  content: { padding: 16, paddingBottom: 24, ...(Platform.OS === "web" ? { width: "100%", maxWidth: 900, alignSelf: "center" } : null) },
  sectionLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginTop: 4, marginBottom: 12 },
  empty: { color: colors.textDim, fontSize: 14, fontStyle: "italic", marginBottom: 12 },
  threadState: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 14 },
  threadStateText: { color: colors.textDim, fontSize: 13.5 },
  threadError: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginBottom: 16 },
  threadErrorTitle: { color: colors.text, fontSize: 14, fontWeight: "800", marginBottom: 4 },
  threadErrorCopy: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  retry: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.amber, borderRadius: radius.full, paddingHorizontal: 13, paddingVertical: 7, marginTop: 11 },
  retryText: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  cRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  replyWrap: { marginLeft: 22, borderLeftWidth: 2, borderLeftColor: colors.lineSoft, paddingLeft: 12 },
  deepReplyWrap: { borderLeftWidth: 2, borderLeftColor: colors.lineSoft, paddingLeft: 8 },
  deletedAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.lineSoft },
  cHead: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  cName: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  cTime: { color: colors.textFaint, fontSize: 11, fontFamily: mono },
  cText: { color: colors.text, fontSize: 14.5, lineHeight: 21, marginTop: 3 },
  deletedText: { color: colors.textFaint, fontSize: 13.5, fontStyle: "italic" },
  commentActions: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 6 },
  replyBtn: { color: colors.amber, fontSize: 12.5, fontWeight: "700", marginTop: 6 },
  deleteBtn: { color: colors.danger, fontSize: 12.5, fontWeight: "700", marginTop: 6 },
  reportBtn: { color: colors.textDim, fontSize: 12.5, fontWeight: "700", marginTop: 6 },
  composerWrap: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bgElev, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
  replyingTo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 6, paddingBottom: 8 },
  replyingTxt: { color: colors.amber, fontSize: 12.5, fontWeight: "700", flex: 1 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  sendOff: { opacity: 0.4 },
  signin: { color: colors.textDim, fontSize: 13, textAlign: "center", paddingVertical: 6 },
});
