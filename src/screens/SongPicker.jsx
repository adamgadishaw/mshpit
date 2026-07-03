import { useState, useMemo } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, FlatList } from "react-native";
import { colors, radius } from "../theme";
import { SONGS } from "../seed/songs";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";

// Pick a song from the catalog, Spotify-style. No free typing.
export default function SongPicker({ kicker = "PICK A SONG", onSelect, onClose }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return SONGS;
    return SONGS.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(query));
  }, [q]);

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker={kicker} title="Add a song" onBack={onClose} />
      <View style={styles.field}>
        <Icon name="search" size={18} color={colors.textDim} />
        <TextInput style={styles.input} placeholder="Search songs or artists" placeholderTextColor={colors.textFaint} value={q} onChangeText={setQ} autoCapitalize="none" />
      </View>
      <FlatList
        data={results}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onSelect?.(item)}>
            <View style={styles.note}><Icon name="music" size={16} color={colors.amber} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.artist}>{item.artist}</Text>
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
  note: { width: 38, height: 38, borderRadius: 8, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  artist: { color: colors.textDim, fontSize: 13, marginTop: 1 },
});
