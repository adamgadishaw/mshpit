import { useEffect, useState } from "react";
import { ActivityIndicator, View, Text, Pressable } from "react-native";
import { colors, displayFont, radius } from "../../theme";
import { formatDate } from "../../domain/dates.mjs";
import { createLoadState, projectLoadState, resolveLoadState, rejectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";
import { toAppError } from "../../lib/diagnostics";
import SmartImage from "../../components/SmartImage";
import Button from "../../components/Button";
import { fetchCreatorPosts } from "./creatorPostsApi.mjs";
import CreatorUpdatePreference from "./CreatorUpdatePreference";

// Public entrypoint for artist/venue/event pages. Reads use ordinary post
// visibility; opening a row uses the app's existing post and comments screen.
export default function CreatorPostsSection({ entityType, entityKey, accountId = null, onOpenPost, onCompose, following, onPostsLoaded }) {
  const scope = `${accountId || "guest"}:${entityType}:${entityKey}:creator-posts`;
  const [resource, setResource] = useState(() => createLoadState({ scope, status: "loading" }));
  const [attempt, setAttempt] = useState(0);
  const current = projectLoadState(resource, scope);
  useEffect(() => {
    const controller = new AbortController();
    setResource(createLoadState({ scope, status: "loading" }));
    fetchCreatorPosts({ entityType, entityKey, accountId, signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setResource(resolveLoadState({ scope, data })); onPostsLoaded?.(data); }
    }).catch(error => {
      if (!isLoadCancellation(error, controller.signal)) setResource(previous => rejectLoadState(previous, { scope, error: toAppError(error), retainData: false }));
    });
    return () => controller.abort();
  }, [scope, entityType, entityKey, accountId, attempt, onPostsLoaded]);
  return <View style={{ gap: 12, marginVertical: 16 }}>
    <Text style={{ color: colors.text, fontFamily: displayFont, fontWeight: "800", fontSize: 20 }}>Latest updates</Text>
    {!!accountId && !onCompose && <CreatorUpdatePreference key={String(following)} entityType={entityType} entityKey={entityKey} accountId={accountId} />}
    {current.status === "loading" ? <ActivityIndicator color={colors.amber} accessibilityLabel="Loading page updates" />
      : current.status === "error" ? <View style={{ gap: 10 }}><Text selectable accessibilityRole="alert" style={{ color: colors.textDim }}>Updates couldn’t be loaded.</Text><Button title="Try again" onPress={() => setAttempt(n => n + 1)} small /></View>
        : current.data.length === 0 ? <Text style={{ color: colors.textDim }}>{onCompose ? "Share your first update with followers." : "No updates from this page yet."}</Text>
          : current.data.map(post => <Pressable key={post.id} accessibilityRole="button" accessibilityLabel={`Open update: ${post.creatorUpdate.title}`} onPress={() => onOpenPost?.(post)} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", gap: 12 }}>
            {!!post.media?.find(item => item.kind === "image")?.url && <SmartImage uri={post.media.find(item => item.kind === "image").url} style={{ width: 72, height: 72, borderRadius: radius.md }} />}
            <View style={{ flex: 1, gap: 5 }}><Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{post.creatorUpdate.title}</Text>
              {!!post.creatorUpdate.date && <Text style={{ color: colors.amber }}>{formatDate(post.creatorUpdate.date)}{post.creatorUpdate.location ? ` · ${post.creatorUpdate.location}` : ""}</Text>}
              {!!post.review && <Text style={{ color: colors.textDim }} numberOfLines={3}>{post.review}</Text>}
              <Text style={{ color: colors.textFaint }}>{post.timeAgo || "Open update"}</Text>
            </View>
          </Pressable>)}
    {!!onCompose && <Button title="Post to followers" icon="share" onPress={onCompose} small />}
  </View>;
}
