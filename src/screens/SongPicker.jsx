import { useState, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, FlatList, Image, ActivityIndicator } from "react-native";
import { colors, radius } from "../theme";
import { SONGS } from "../seed/songs";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";

// Pick a song to pin to your profile. This used to filter a hardcoded list of
// 50 songs, so anything else simply could not be chosen. It now searches the
// real index (the catalogue's ~2,500 songs first, then the provider), which is
// the same source the search screen uses. The bundled list is kept only as the
// idle suggestion before anyone types, so the screen is never blank.
export default function SongPicker({ kicker = "PICK A SONG", onSelect, onClose }) {
  const { searchSongsApi } = useStore();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const query = q.trim();

  useEffect(() => {
    if (query.length < 2) { setHits([]); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const id = setTimeout(() => {
      searchSongsApi(query).then((list) => {
        // A slow reply for an earlier query must not replace newer results.
        if (!live) return;
        setHits(list || []);
        setSearching(false);
      });
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    if (query.length < 2) return SONGS;
    return hits;
  }, [query, hits]);

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker={kicker} title="Add a song" onBack={onClose} />
      <View style={styles.field}>
        <Icon name="search" size={18} color={colors.textDim} />
        <TextInput style={styles.input} placeholder="Search songs or artists" placeholderTextColor={colors.textFaint} value={q} onChangeText={setQ} autoCapitalize="none" />
      </View>
      <FlatList
        data={results}
        keyExtractor={(s, i) => `${s.id || s.title}|${s.artist}|${i}`}
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searching ? "Searching…" : query.length < 2 ? "Type at least two letters." : `No songs found for “${query}”.`}
          </Text>
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
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginTop: 8 },
  art: { width: 38, height: 38, borderRadius: 8, backgroundColor: colors.bgElev },
  empty: { color: colors.textDim, fontSize: 13, textAlign: "center", paddingVertical: 24 },
  note: { width: 38, height: 38, borderRadius: 8, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  artist: { color: colors.textDim, fontSize: 13, marginTop: 1 },
});
