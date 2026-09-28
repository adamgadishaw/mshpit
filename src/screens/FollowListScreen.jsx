import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { colors, radius, space } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import { BadgeRow } from "../components/Badge";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import { connectionScope } from "../domain/connectionList.mjs";
import { isArtistFollowed } from "../domain/artistFollowFanClub.mjs";
import { useConnections } from "../features/connections/useConnections";
import useScopedRefresh from "../hooks/useScopedRefresh";

const KINDS = [["followers", "Followers"], ["following", "People following"], ["artists", "Artists followed"]];

export default function FollowListScreen({ userId, mode = "followers", onClose, onOpenProfile, onOpenArtist, onRequireAuth }) {
  const { session, authReady, chatAuthEpoch, blockedIds, isFollowing, follow, unfollow, userBadges, setArtistFollowing } = useStore();
  const [kind, setKind] = useState(mode);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const scope = connectionScope({ accountId: session?.id, userId, kind, query, filter, blockedIds, epoch: [chatAuthEpoch, authReady] });
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const pendingRef = useRef(new Set());
  const [actions, setActions] = useState({ scope, pending: [], error: "" });
  const actionView = actions.scope === scope ? actions : { pending: [], error: "" };
  const list = useConnections({ scope, userId: authReady ? userId : null, kind, query, filter, accountId: session?.id || null });
  const refreshScope = scope;
  const pullRefresh = useScopedRefresh({ scope: refreshScope, enabled: authReady, task: ({ signal }) => list.refresh({ signal }) });
  useEffect(() => { setKind(mode); setQuery(""); setFilter("all"); }, [userId, mode]);
  const title = KINDS.find(([key]) => key === kind)?.[1] || "Followers";
  const changeKind = (next) => { setKind(next); setFilter("all"); setQuery(""); };
  const act = async (row, following) => {
    if (!session) { onRequireAuth?.(); return; }
    const key = `${scope}:${row.id}`;
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    const patch = (value) => { if (scopeRef.current === scope) setActions((current) => ({ ...(current.scope === scope ? current : { scope, pending: [], error: "" }), ...value })); };
    patch({ pending: [...pendingRef.current].filter((item) => item.startsWith(scope + ":")), error: "" });
    let result;
    try { result = kind === "artists" ? await setArtistFollowing(row.key || row.name, !following) : await (following ? unfollow(row.id) : follow(row.id)); }
    catch { result = { ok: false }; }
    pendingRef.current.delete(key);
    patch({ pending: [...pendingRef.current].filter((item) => item.startsWith(scope + ":")), error: result?.ok === true ? "" : "That follow change could not be saved. Please try again." });
    if (result?.ok && scopeRef.current === scope && kind === "artists" && userId === session.id && following) void list.refresh();
  };
  const artists = kind === "artists";
  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="Connections" title={title} onBack={onClose} />
      <View style={styles.controls}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {KINDS.map(([key, label]) => <Pressable key={key} style={[styles.chip, kind === key && styles.chipOn]} onPress={() => changeKind(key)} accessibilityRole="tab" accessibilityState={{ selected: kind === key }}><Text style={[styles.chipText, kind === key && styles.chipTextOn]}>{label}</Text></Pressable>)}
        </View>
        <View style={styles.search}>
          <Icon name="search" size={17} color={colors.textDim} />
          <TextInput value={query} onChangeText={setQuery} maxLength={80} autoCapitalize="none" autoCorrect={false} style={styles.searchInput}
            placeholder={artists ? "Search artists" : "Search name or @username"} placeholderTextColor={colors.textFaint} accessibilityLabel={artists ? "Search followed artists" : "Search connections"} />
          {!!query && <Pressable onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel="Clear connection search" style={styles.clear}><Icon name="close" size={16} color={colors.textDim} /></Pressable>}
        </View>
        {!artists && <View style={styles.tabs}>
          {[["all", "All"], ["verified", "Verified"], ...(session ? [["following", "You follow"]] : [])].map(([key, label]) => <Pressable key={key} style={[styles.filter, filter === key && styles.chipOn]} onPress={() => setFilter(key)} accessibilityRole="button" accessibilityState={{ selected: filter === key }}><Text style={styles.chipText}>{label}</Text></Pressable>)}
        </View>}
        {!!actionView.error && <Text style={styles.errorText} accessibilityRole="alert">{actionView.error}</Text>}
      </View>
      <VinylRefreshBoundary refreshing={pullRefresh.refreshing} onRefresh={pullRefresh.refresh} accessibilityLabel={`Refresh ${title.toLowerCase()}`}>
        <FlatList data={list.rows} keyExtractor={(row) => row.id} contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
          ListHeaderComponent={list.error ? <View style={styles.error} accessibilityRole="alert"><Text style={styles.errorText}>{list.error}</Text><Pressable onPress={list.refresh} accessibilityRole="button" style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
          ListEmptyComponent={list.status === "loading" ? <View style={styles.empty}><ActivityIndicator color={colors.amber} /><Text style={styles.hint}>Loading connections…</Text></View> : list.error ? null : <View style={styles.empty}><Icon name={artists ? "music" : "you"} size={26} color={colors.textFaint} /><Text style={styles.emptyTitle}>{query || filter !== "all" ? "No matching connections" : artists ? "No followed artists yet" : kind === "followers" ? "No followers yet" : "Not following people yet"}</Text><Text style={styles.emptySub}>{query || filter !== "all" ? "Try another name or clear your filters." : artists ? "Artists followed from their pages appear here, separately from people and Fan Clubs." : "Visible accounts will appear here when this person connects with them."}</Text>{(query || filter !== "all") && <Pressable style={styles.retry} onPress={() => { setQuery(""); setFilter("all"); }} accessibilityRole="button"><Text style={styles.retryText}>Clear filters</Text></Pressable>}</View>}
          ListFooterComponent={list.nextCursor ? <Pressable onPress={list.more} disabled={list.status === "refreshing"} style={styles.more} accessibilityRole="button" accessibilityState={{ busy: list.status === "refreshing", disabled: list.status === "refreshing" }}><Text style={styles.retryText}>{list.status === "refreshing" ? "Loading…" : "Show more"}</Text></Pressable> : null}
          renderItem={({ item: row }) => {
            const following = artists ? isArtistFollowed(session?.favoriteArtists, row.name) : isFollowing(row.id);
            const pending = actionView.pending.includes(`${scope}:${row.id}`);
            return <View style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => artists ? onOpenArtist?.(row.name) : onOpenProfile?.(row.id)} disabled={!!row.unavailable} accessibilityRole="button" accessibilityLabel={`Open ${row.name}`}>
                <Avatar user={artists ? { name: row.name, avatarUri: row.photo, initials: row.name.slice(0, 2).toUpperCase() } : row} size={42} />
                <View style={styles.rowText}><View style={styles.nameRow}><Text style={styles.name} numberOfLines={1}>{row.name}</Text>{!artists && <BadgeRow badges={userBadges(row)} size={14} />}</View><Text style={styles.handle} numberOfLines={1}>{artists ? row.unavailable ? "Page currently unavailable" : row.genre || "Artist" : `@${row.handle}${row.home?.city ? " · " + row.home.city : ""}`}</Text></View>
              </Pressable>
              {(artists || session?.id !== row.id) && <Pressable style={[styles.followBtn, following && styles.followingBtn]} disabled={pending} onPress={() => act(row, following)} accessibilityRole="button" accessibilityLabel={`${following ? "Unfollow" : "Follow"} ${row.name}`} accessibilityState={{ selected: following, disabled: pending, busy: pending }}><Text style={[styles.followTxt, following && styles.followingTxt]}>{pending ? "Saving…" : following ? "Following" : "Follow"}</Text></Pressable>}
            </View>;
          }} />
      </VinylRefreshBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  controls: { paddingHorizontal: space(4), paddingBottom: 12, gap: 10 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  chipOn: { borderColor: colors.amber, backgroundColor: colors.surface },
  chipText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  chipTextOn: { color: colors.amber },
  filter: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineSoft },
  search: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46, paddingLeft: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, color: colors.text, fontSize: 14 },
  clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: space(4), paddingBottom: space(10) },
  hint: { color: colors.textDim, fontSize: 13 },
  error: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginBottom: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  errorText: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10 },
  retryText: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  rowText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: colors.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  handle: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  followBtn: { minWidth: 90, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  followingBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  followTxt: { color: "#1A1206", fontSize: 12.5, fontWeight: "800" },
  followingTxt: { color: colors.textDim },
  empty: { alignItems: "center", gap: 8, paddingTop: 36, paddingHorizontal: 20 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 4 },
  emptySub: { color: colors.textDim, fontSize: 13.5, textAlign: "center", lineHeight: 19 },
  more: { minHeight: 48, alignItems: "center", justifyContent: "center", marginVertical: 12 },
});
