import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { colors, mono, radius, space } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import { fanClubSearchResults } from "../domain/fanClubDirectory.mjs";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import useScopedRefresh from "../hooks/useScopedRefresh";

// Fan clubs, front and center: a browsable directory of active, server-approved
// artist communities. Catalogue-only candidates fail closed unless the API has
// explicitly marked them eligible, so a protected legacy profile is never
// advertised as a club that somebody can start.
export default function FanClubsScreen({ onClose, onOpenFanClub }) {
  const { session, fanClubsDirectory, fanClubDirectoryStatus, loadFanClubsDirectory, artistsAlphabetical, searchArtistsApi } = useStore();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  // Re-read on every store render so a completed join/leave updates the
  // directory immediately instead of being frozen to the mount-time snapshot.
  const active = fanClubsDirectory();
  const directoryRefreshScope = refreshScope(session?.id, "fan-club-directory", "all");
  const { refresh: refreshDirectory, refreshing: directoryRefreshing } = useScopedRefresh({
    scope: directoryRefreshScope,
    task: async ({ signal }) => {
      const result = await loadFanClubsDirectory({ signal });
      if (!result?.ok && !result?.stale) throw new Error("Fan clubs could not be refreshed.");
      return result;
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    void loadFanClubsDirectory({ signal: controller.signal }).catch(() => {
      // Initial hydration cancellation is expected when account scope changes.
    });
    return () => controller.abort();
  }, [session?.id]);

  // Ask the server for the matching catalog identities because that response
  // carries the authoritative `fanClubAvailable` policy bit. A short debounce
  // keeps type-ahead responsive without turning every keystroke into a request.
  useEffect(() => {
    if (query.length < 2) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchArtistsApi(query, {
        signal: controller.signal,
        limit: 40,
        remoteFallback: false,
      });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Store actions are facade functions recreated with state; the query owns
    // this request lifecycle and cached results trigger the desired rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Active rows have crossed the server's memorial policy boundary. The domain
  // projection ignores catalogue rows without an explicit eligibility flag.
  const results = query ? fanClubSearchResults(active, artistsAlphabetical(1000), query, 40) : [];

  const Row = ({ c }) => (
    <Pressable style={styles.row} onPress={() => onOpenFanClub?.(c.artist)}>
      <View style={styles.dot}><Icon name="comment" size={16} color={colors.amber} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{c.artist}</Text>
        <Text style={styles.sub}>
          {c.members > 0 ? `${c.members} member${c.members === 1 ? "" : "s"}` : "Be the first to join"}
          {c.messages > 0 ? ` · ${c.messages} message${c.messages === 1 ? "" : "s"}` : ""}
        </Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textDim} />
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="COMMUNITY" title="Fan clubs" onBack={onClose} />

      <View style={styles.fieldWrap}>
        <View style={styles.field}>
          <Icon name="search" size={18} color={colors.textDim} />
          <TextInput
            style={styles.input}
            placeholder="Find an active artist fan club"
            placeholderTextColor={colors.textFaint}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            maxLength={80}
          />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Icon name="x" size={16} color={colors.textFaint} /></Pressable>}
        </View>
      </View>

      <VinylRefreshBoundary
        refreshing={directoryRefreshing}
        onRefresh={refreshDirectory}
        accessibilityLabel="Refresh fan clubs"
      >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {query ? (
          <>
            <Text style={styles.sectionLabel}>CLUBS · {results.length}</Text>
            {results.length === 0 && <Text style={styles.empty}>No active fan clubs match "{q}".</Text>}
            {results.map((c) => <Row key={c.artist} c={c} />)}
          </>
        ) : (
          <>
            <Text style={styles.hint}>Permanent chats for active artist communities. Swap shows, plan trips, no ticket needed.</Text>
            <Text style={styles.sectionLabel}>ACTIVE CLUBS · {active.length}</Text>
            {active.length === 0 && <Text style={styles.empty}>{fanClubDirectoryStatus === "loading" ? "Refreshing active clubs…" : "No clubs yet, search an artist to start one."}</Text>}
            {active.map((c) => <Row key={c.artist} c={c} />)}
          </>
        )}
      </ScrollView>
      </VinylRefreshBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  fieldWrap: { paddingHorizontal: 16, paddingBottom: 6 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  content: { padding: 16, paddingTop: 10, paddingBottom: 48 },
  hint: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 14, marginBottom: space(2) },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  dot: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
});
