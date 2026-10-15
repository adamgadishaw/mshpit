import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import NativeSwipeRail from "./NativeSwipeRail";

export default function PostSwipeActions({ post, children, onRequireAuth, enabled = false, accountId, likeInfo, toggleLike, setPostRepost, surfaceColor }) {
  const scope = `${accountId || "guest"}:${post.id}`;
  const current = useRef(scope); current.current = scope;
  const pending = useRef(null), mounted = useRef(true);
  const confirmed = useRef({ scope, reposted: !!post.reposted, observed: !!post.reposted });
  if (confirmed.current.scope !== scope || confirmed.current.observed !== !!post.reposted) {
    confirmed.current = { scope, reposted: !!post.reposted, observed: !!post.reposted };
  }
  const [feedback, setFeedback] = useState({ scope, text: "", undo: false });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scoped = feedback.scope === scope ? feedback : { text: "", undo: false };
  const commit = async direction => {
    if (!mounted.current) return;
    if (!accountId) { onRequireAuth?.(); return; }
    if (pending.current === scope) return;
    const like = direction === "positive", undo = direction === "undo";
    if (like && likeInfo(post.id, post.likes || 0).liked) {
      AccessibilityInfo?.announceForAccessibility?.("Already liked."); setFeedback({ scope, text: "", undo: false }); return;
    }
    if (!like && !undo && confirmed.current.reposted) {
      setFeedback({ scope, text: "Already reposted.", undo: true }); return;
    }
    pending.current = scope;
    setFeedback({ scope, text: "Saving…", undo: false });
    try {
      const result = like ? await toggleLike(post.id, post.likes || 0) : await setPostRepost(post.id, !undo);
      if (!mounted.current || current.current !== scope) return;
      if (result?.ok && !like) confirmed.current.reposted = !undo;
      if (result?.ok && like) AccessibilityInfo?.announceForAccessibility?.("Liked.");
      setFeedback({ scope, text: result?.ok ? (like ? "" : undo ? "Repost removed." : "Reposted.") : "Not saved. Try again.", undo: !!result?.ok && !like && !undo });
    } catch {
      if (mounted.current && current.current === scope) setFeedback({ scope, text: "Not saved. Try again.", undo: false });
    } finally { if (pending.current === scope) pending.current = null; }
  };
  if (!enabled) return children;
  return <View>
    <NativeSwipeRail enabled={scoped.text !== "Saving…"} onCommit={commit} surfaceColor={surfaceColor} testID={`post-swipe-${post.id}`}>
      <View pointerEvents={scoped.text === "Saving…" ? "none" : "auto"}>{children}</View>
    </NativeSwipeRail>
    {scoped.text ? <View style={styles.status}>
      <Text accessibilityLiveRegion="polite" style={styles.text}>{scoped.text}</Text>
      {scoped.undo ? <Pressable onPress={() => commit("undo")} style={styles.undo} accessibilityRole="button" accessibilityLabel="Undo this repost"><Text style={styles.undoText}>Undo</Text></Pressable> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({ status: { flexDirection: "row", alignItems: "center", gap: 12 }, text: { color: colors.textDim, fontSize: 14, flex: 1 }, undo: { minHeight: 48, minWidth: 48, justifyContent: "center" }, undoText: { color: colors.amber, fontSize: 14, fontWeight: "600" } });
