import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import NativeSwipeRail from "./NativeSwipeRail";

export default function PostSwipeActions({ post, children, onRequireAuth, enabled = false, accountId, likeInfo, toggleLike, setPostRepost, surfaceColor, actionPresentation = null }) {
  const scope = `${accountId || "guest"}:${post.id}`;
  const current = useRef({ scope, presentation: actionPresentation }); current.current = { scope, presentation: actionPresentation };
  const pending = useRef(null), mounted = useRef(true);
  const confirmed = useRef({ scope, presentation: actionPresentation, reposted: !!post.reposted, observed: !!post.reposted });
  if (confirmed.current.scope !== scope || confirmed.current.presentation !== actionPresentation || confirmed.current.observed !== !!post.reposted) {
    confirmed.current = { scope, presentation: actionPresentation, reposted: !!post.reposted, observed: !!post.reposted };
  }
  const [feedback, setFeedback] = useState({ scope, presentation: actionPresentation, text: "", undo: false });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scoped = feedback.scope === scope && feedback.presentation === actionPresentation ? feedback : { text: "", undo: false };
  const isCurrent = () => mounted.current && current.current.scope === scope
    && current.current.presentation === actionPresentation && actionPresentation?.current() !== false;
  const commit = async direction => {
    if (!isCurrent()) return;
    if (!accountId) { onRequireAuth?.(); return; }
    if (pending.current?.scope === scope && pending.current?.presentation === actionPresentation) return;
    const like = direction === "positive", undo = direction === "undo";
    if (like && likeInfo(post.id, post.likes || 0).liked) {
      AccessibilityInfo?.announceForAccessibility?.("Already liked."); setFeedback({ scope, presentation: actionPresentation, text: "", undo: false }); return;
    }
    if (!like && !undo && confirmed.current.reposted) {
      setFeedback({ scope, presentation: actionPresentation, text: "Already reposted.", undo: true }); return;
    }
    const request = { scope, presentation: actionPresentation };
    pending.current = request;
    setFeedback({ scope, presentation: actionPresentation, text: "Saving…", undo: false });
    try {
      const result = like ? await toggleLike(post.id, post.likes || 0) : await setPostRepost(post.id, !undo);
      if (!isCurrent()) return;
      if (result?.ok && !like) confirmed.current.reposted = !undo;
      if (result?.ok && like) AccessibilityInfo?.announceForAccessibility?.("Liked.");
      setFeedback({ scope, presentation: actionPresentation, text: result?.ok ? (like ? "" : undo ? "Repost removed." : "Reposted.") : "Not saved. Try again.", undo: !!result?.ok && !like && !undo });
    } catch {
      if (isCurrent()) setFeedback({ scope, presentation: actionPresentation, text: "Not saved. Try again.", undo: false });
    } finally { if (pending.current === request) pending.current = null; }
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
