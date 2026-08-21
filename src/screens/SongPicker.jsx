import { useState, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, FlatList, Image, ActivityIndicator } from "react-native";
import { colors, radius } from "../theme";
import { SONGS } from "../seed/songs";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";
import { unifiedSearchRequestOptions } from "../domain/unifiedSearch.mjs";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";

const EMPTY_SEARCH = Object.freeze({ status: "idle", rows: [], error: "" });

// Pick a song to pin to your profile. This used to filter a hardcoded list of
// 50 songs, so anything else simply could not be chosen. It now searches the
// real index (the catalogue's ~2,500 songs first, then the provider), which is
// the same source the search screen uses. The bundled list is kept only as the
// idle suggestion before anyone types, so the screen is never blank.
export default function SongPicker({ kicker = "PICK A SONG", onSelect, onClose }) {
  const { searchSongsApi, session } = useStore();
  const [q, setQ] = useState("");
  const [revision, setRevision] = useState(0);
  const query = q.trim();
  const searchScope = accountTargetScope(session?.id, `song-picker:${query.toLowerCase()}`);
  const [searchState, setSearchState] = useState(() => ({ scope: searchScope, value: EMPTY_SEARCH }));
  const search = scopedScreenValue(searchState, searchScope, query.length >= 2
    ? { status: "loading", rows: [], error: "" }
    : EMPTY_SEARCH);

  useEffect(() => {
    const controller = new AbortController();
    if (query.length < 2) {
      setSearchState({ scope: searchScope, value: EMPTY_SEARCH });
      return () => controller.abort();
    }
    setSearchState({ scope: searchScope, value: { status: "loading", rows: [], error: "" } });
    const id = setTimeout(() => {
      searchSongsApi(query, unifiedSearchRequestOptions(controller))
        .then((list) => {
          if (!controller.signal.aborted) setSearchState({ scope: searchScope, value: { status: "ready", rows: Array.isArray(list) ? list : [], error: "" } });
        })
        .catch((error) => {
          if (!controller.signal.aborted && error?.name !== "AbortError") {
            setSearchState({ scope: searchScope, value: { status: "error", rows: [], error: "Song search could not update. Check your connection and try again." } });
          }
        });
    }, 250);
    return () => { clearTimeout(id); controller.abort(); };
    // searchSongsApi is a store action whose identity changes with store state;
    // request ownership is instead keyed to account, query, and retry revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, revision, searchScope]);

  const results = useMemo(() => {
    if (query.length < 2) return SONGS;
    return search.rows;
  }, [query, search.rows]);

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker={kicker} title="Add a song" onBack={onClose} />
      <View style={styles.field}>
        <Icon name="search" size={18} color={colors.textDim} />
        <TextInput style={styles.input} placeholder="Search songs or artists" placeholderTextColor={colors.textFaint} value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} maxLength={80} accessibilityLabel="Search songs or artists" accessibilityState={{ busy: search.status === "loading" }} />
      </View>
      {search.status === "loading" && (
        <View style={styles.status} accessibilityLiveRegion="polite" accessibilityLabel={`Searching for ${query}`}>
          <ActivityIndicator size="small" color={colors.amber} />
          <Text style={styles.statusText}>Searching...</Text>
        </View>
      )}
      {search.status === "error" && (
        <View style={styles.error} accessibilityLiveRegion="assertive">
          <Text style={styles.errorText} selectable>{search.error}</Text>
          <Pressable style={styles.retry} onPress={() => setRevision((value) => value + 1)} accessibilityRole="button" accessibilityLabel={`Retry song search for ${query}`}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={results}
        keyExtractor={(s, i) => `${s.id || s.title}|${s.artist}|${i}`}
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          search.status === "error" || search.status === "loading" ? null : (
            <Text style={styles.empty} accessibilityLiveRegion="polite">
              {query.length < 2 ? "Type at least two letters." : `No songs found for “${query}”.`}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onSelect?.(item)} accessibilityRole="button" accessibilityLabel={`Choose ${item.title} by ${item.artist}`}>
            {item.art
              ? <Image source={{ uri: item.art }} style={styles.art} />
              : <View style={styles.note}><Icon name="music" size={16} color={colors.amber} /></View>}
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.artist} numberOfLines={1}>{item.artist}</Text>
            </View>
            <Icon name="plus" size={18} color={colors.textDim} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, marginHorizontal: 16, marginTop: 8 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  status: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16 },
  statusText: { color: colors.textDim, fontSize: 12.5 },
  error: { marginHorizontal: 16, marginTop: 10, padding: 12, gap: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface },
  errorText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber },
  retryText: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginTop: 8 },
  art: { width: 38, height: 38, borderRadius: 8, backgroundColor: colors.bgElev },
  empty: { color: colors.textDim, fontSize: 13, textAlign: "center", paddingVertical: 24 },
  note: { width: 38, height: 38, borderRadius: 8, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  artist: { color: colors.textDim, fontSize: 13, marginTop: 1 },
});
