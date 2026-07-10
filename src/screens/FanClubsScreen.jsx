import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";

// Fan clubs, front and center: a browsable directory of every club (most members
// first) plus type-to-find across ALL artists, so any club is one search away
// instead of buried behind its artist page.
export default function FanClubsScreen({ onClose, onOpenFanClub }) {
  const { fanClubsDirectory, artistsAlphabetical, fanClubCount } = useStore();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const active = useMemo(() => fanClubsDirectory(), []);

  // Searching matches every artist in the catalog, so you can open (and be the
  // first member of) any club, not just the already-active ones.
  const results = useMemo(() => {
    if (!query) return [];
    const seen = new Set();
    const out = [];
    active.forEach((c) => {
      if (c.artist.toLowerCase().includes(query)) { seen.add(c.artist.toLowerCase()); out.push(c); }
    });
    artistsAlphabetical(1000).forEach((a) => {
      const k = a.name.toLowerCase();
      if (k.includes(query) && !seen.has(k)) out.push({ artist: a.name, members: 0, messages: 0 });
    });
    return out.slice(0, 40);
  }, [query, active]);

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
            placeholder="Find any artist's fan club"
            placeholderTextColor={colors.textFaint}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            maxLength={80}
          />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Icon name="x" size={16} color={colors.textFaint} /></Pressable>}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {query ? (
          <>
            <Text style={styles.sectionLabel}>CLUBS · {results.length}</Text>
            {results.length === 0 && <Text style={styles.empty}>No artists match "{q}".</Text>}
            {results.map((c) => <Row key={c.artist} c={c} />)}
          </>
        ) : (
          <>
            <Text style={styles.hint}>Permanent chats for every artist, swap shows, plan trips, no ticket needed.</Text>
            <Text style={styles.sectionLabel}>ACTIVE CLUBS · {active.length}</Text>
            {active.length === 0 && <Text style={styles.empty}>No clubs yet, search an artist to start one.</Text>}
            {active.map((c) => <Row key={c.artist} c={c} />)}
          </>
        )}
      </ScrollView>
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
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 14, marginBottom: 10 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  dot: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
});
