import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, radius, space } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import { BadgeRow } from "../components/Badge";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import useScopedRefresh from "../hooks/useScopedRefresh";

// The real list behind the FOLLOWERS / FOLLOWING numbers on a profile. Tap a row
// to open that person, follow back inline.
export default function FollowListScreen({ userId, mode = "followers", onClose, onOpenProfile }) {
  const { session, userById, followersOf, followingOf, isFollowing, follow, unfollow, userBadges } = useStore();
  const owner = userById(userId);
  const [list, setList] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(false);
  const followRefreshScope = refreshScope(session?.id, "follow-list", `${userId}:${mode}`);
  const scopeRef = useRef(followRefreshScope);
  scopeRef.current = followRefreshScope;
  const loaderRef = useRef(null);
  loaderRef.current = mode === "followers" ? followersOf : followingOf;

  const readDirectory = async ({ signal, preserveRows }) => {
    if (!preserveRows) setList(null);
    setLoadError(false);
    const rows = await loaderRef.current(userId, { signal, strict: true });
    if (signal.aborted || scopeRef.current !== followRefreshScope || !rows) return { stale: true };
    setList(rows);
    return rows;
  };
  const { refresh: refreshFollowList, refreshing: followListRefreshing } = useScopedRefresh({
    scope: followRefreshScope,
    task: ({ signal }) => readDirectory({ signal, preserveRows: true }),
    onError: () => setLoadError(true),
  });

  useEffect(() => {
    const controller = new AbortController();
    void readDirectory({ signal: controller.signal, preserveRows: false }).catch(() => {
      if (!controller.signal.aborted && scopeRef.current === followRefreshScope) setLoadError(true);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followRefreshScope]);

  const title = mode === "followers" ? "Followers" : "Following";

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker={owner ? `@${owner.handle}` : "PROFILE"} title={title} onBack={onClose} />
      <VinylRefreshBoundary
        refreshing={followListRefreshing}
        onRefresh={refreshFollowList}
        accessibilityLabel={`Refresh ${title.toLowerCase()}`}
      >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {list === null && !loadError && <Text style={styles.hint}>Loading...</Text>}
        {loadError && (
          <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorText}>
              {list === null
                ? "This list could not load. Check your connection and try again."
                : "This list could not refresh. The people already shown are still here."}
            </Text>
            <Pressable onPress={refreshFollowList} accessibilityRole="button" accessibilityLabel={`Retry ${title.toLowerCase()}`}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}
        {list !== null && list.length === 0 && (
          <View style={styles.empty}>
            <Icon name="you" size={26} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{mode === "followers" ? "No followers yet" : "Not following anyone yet"}</Text>
            <Text style={styles.emptySub}>{mode === "followers" ? "When people follow this account they show up here." : "Accounts this person follows will show up here."}</Text>
          </View>
        )}
        {(list || []).map((u) => {
          const self = session?.id === u.id;
          const fol = isFollowing(u.id);
          return (
            <View key={u.id} style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => onOpenProfile?.(u.id)}>
                <Avatar user={u} size={42} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
                    <BadgeRow badges={userBadges(u)} size={14} />
                  </View>
                  <Text style={styles.handle} numberOfLines={1}>@{u.handle}{u.home?.city ? ` · ${u.home.city}` : ""}</Text>
                </View>
              </Pressable>
              {session && !self && (
                <Pressable style={[styles.followBtn, fol && styles.followingBtn]} onPress={() => (fol ? unfollow(u.id) : follow(u.id))}>
                  <Text style={[styles.followTxt, fol && styles.followingTxt]}>{fol ? "Following" : "Follow"}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
      </VinylRefreshBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(10) },
  hint: { color: colors.textDim, fontSize: 13, textAlign: "center", paddingTop: 40 },
  error: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 12, marginBottom: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  errorText: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  retryText: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, marginBottom: 4 },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: colors.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  handle: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  followBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  followingBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  followTxt: { color: "#1A1206", fontSize: 12.5, fontWeight: "800" },
  followingTxt: { color: colors.textDim },
  empty: { alignItems: "center", gap: 8, paddingTop: 50, paddingHorizontal: 30 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 4 },
  emptySub: { color: colors.textDim, fontSize: 13.5, textAlign: "center", lineHeight: 19 },
});
