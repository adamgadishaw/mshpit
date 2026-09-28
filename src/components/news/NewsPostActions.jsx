import { useRef, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, font } from "../../theme";
import Icon from "../Icon";
import { useNewsInteractions } from "./NewsInteractionContext";
import { RepostButton, RepostAttribution } from "../SocialReactionButtons";

export default function NewsPostActions({ story, post, accountId, onOpen, onOpenProfile, onReport, onDelete, onRequireAuth }) {
  const { session, likeInfo, toggleLike, deleteOwnPost, setPostRepost, removedIds = [] } = useNewsInteractions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const scope = `${session?.id || "guest"}:${story.postId}`;
  const current = useRef(scope);
  current.current = scope;
  const busy = useRef(false);
  const author = story.author || post?.user;
  const ownerId = author?.id || post?.userId;
  const log = post || { id: story.postId, userId: ownerId, user: author, kind: "status", review: story.body, news: story,
    reposts:story.reposts || 0,reposted:!!story.reposted,repostedBy:story.repostedBy || [] };
  const own = !!session?.id && session.id === ownerId;
  const reaction = likeInfo?.(story.postId, story.likes || 0, story.likedByMe === true) || { count: story.likes || 0, liked: story.likedByMe === true };
  if (accountId !== (session?.id || null) || removedIds.includes(story.postId)) return null;
  const mutate = async (action) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try {
      const result = await action();
      if (current.current === scope && !result?.ok) setError("That change wasn't saved. Please try again.");
    } catch {
      if (current.current === scope) setError("That change wasn't saved. Please try again.");
    } finally {
      busy.current = false;
      if (current.current === scope) setPending(false);
    }
  };
  const remove = () => {
    const run = () => { if (current.current === scope) void mutate(() => (onDelete || deleteOwnPost)(story.postId)); };
    if (Platform.OS === "web") { if (globalThis.confirm?.("Delete this news post? Its story will no longer be public.")) run(); }
    else Alert.alert("Delete this news post?", "Its story will no longer be public.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: run }]);
  };
  const action = (label, icon, press, selected = false) => <Pressable key={label} onPress={press} disabled={pending} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: pending, ...(icon === "heart" ? { selected } : {}) }} style={({ focused, pressed }) => [styles.action, focused && focusRing, pressed && { opacity: 0.7 }]}><Icon name={icon} size={17} color={selected ? colors.magenta : colors.textDim} filled={selected} /><Text style={styles.label}>{label}</Text></Pressable>;
  return <View style={styles.wrap}>
    <RepostAttribution post={log} accountId={accountId} onOpenProfile={onOpenProfile} />
    {ownerId && onOpenProfile ? <Pressable onPress={() => onOpenProfile(ownerId)} accessibilityRole="link" accessibilityLabel={`Open ${author?.name || author?.handle || "the author's"} profile`} style={({ focused }) => [styles.author, focused && focusRing]}><Text style={styles.label}>By {author?.name || author?.handle || "Mshpit News"}{author?.handle ? ` · @${author.handle}` : ""}</Text></Pressable> : null}
    <View style={styles.row}>
      {setPostRepost ? <RepostButton post={log} accountId={accountId} onRepost={setPostRepost} onRequireAuth={onRequireAuth} /> : null}
      {action(`${reaction.count} ${reaction.count === 1 ? "like" : "likes"}`, "heart", () => session?.id ? void mutate(() => toggleLike(story.postId, story.likes || 0, story.likedByMe === true)) : onRequireAuth?.(), reaction.liked)}
      {onOpen ? action(`${story.commentCount || 0} comments`, "comment", () => onOpen(story)) : null}
      {own && (onDelete || deleteOwnPost) ? action("Delete", "trash", remove) : null}
      {!own && onReport ? action("Report", "flag", () => onReport(log)) : null}
    </View>
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  wrap: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderColor: colors.lineSoft },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { minHeight: 44, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 6 },
  author: { minHeight: 36, justifyContent: "center" },
  label: { fontFamily: font, color: colors.textDim, fontSize: 12 },
  error: { color: colors.danger, fontFamily: font, fontSize: 13 },
});
