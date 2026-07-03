import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import { cities, rankShows } from "../data";
import Stars from "../components/Stars";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";

export default function TopRatedScreen({ onClose, onOpen }) {
  const cityNames = Object.keys(cities);
  const [loc, setLoc] = useState("San Francisco");

  // Resolve the typed location to a known city (best prefix match).
  const resolved = useMemo(() => {
    const q = loc.trim().toLowerCase();
    return cityNames.find((c) => c.toLowerCase().startsWith(q)) || cityNames.find((c) => c.toLowerCase().includes(q)) || "San Francisco";
  }, [loc]);

  const ranked = useMemo(() => rankShows(cities[resolved]), [resolved]);

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Best rated" onBack={onClose} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Best rated near you</Text>

        <View style={styles.locField}>
          <Icon name="pin" size={16} color={colors.amber} />
          <TextInput
            style={styles.locInput}
            value={loc}
            onChangeText={setLoc}
            placeholder="Enter a city"
            placeholderTextColor={colors.textFaint}
          />
        </View>
        <View style={styles.chips}>
          {cityNames.map((c) => (
            <Pressable key={c} style={[styles.chip, resolved === c && styles.chipOn]} onPress={() => setLoc(c)}>
              <Text style={[styles.chipTxt, resolved === c && styles.chipTxtOn]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        {ranked.map((s, i) => (
          <Pressable
            key={s.id}
            style={styles.row}
            onPress={() =>
              onOpen?.({
                id: s.id,
                user: { name: "Community", handle: "pit", initials: "PT" },
                timeAgo: "aggregate",
                artist: s.artist,
                venue: s.venue,
                city: s.city,
                date: "2026 · tour",
                media: 0,
                overall: s.rating,
                band: s.band,
                room: s.room,
                review: `Aggregate of ${s.reviews} logs - one of the best-rated ${s.artist} nights near you.`,
                setlist: s.setlist,
                likes: s.reviews,
                comments: Math.round(s.reviews / 6),
                inTourWindow: false,
              })
            }
          >
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.artist}>{s.artist}</Text>
              <Text style={styles.venue}>{s.venue} · {s.city}</Text>
              <View style={styles.metaRow}>
                <Stars value={s.rating} size={12} />
                <Text style={styles.meta}>{s.rating.toFixed(1)} · {s.reviews} logs · {s.distance.toFixed(0)} mi</Text>
              </View>
            </View>
          </Pressable>
        ))}

        <Text style={styles.note}>
          Ranked by rating quality (weighted by how many people logged it, so a 5.0 from a handful
          doesn&apos;t beat a 4.7 from hundreds) combined with distance from {resolved}.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { flexDirection: "row", alignItems: "center", width: 72 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "800" },

  locField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    marginTop: 16,
  },
  locInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  chipTxt: { color: colors.textDim, fontSize: 12 },
  chipTxtOn: { color: colors.amber, fontWeight: "700" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    padding: 14,
    marginTop: 10,
  },
  rank: { color: colors.gold, fontFamily: mono, fontSize: 22, fontWeight: "800", width: 26, textAlign: "center" },
  artist: { color: colors.text, fontSize: 17, fontWeight: "700" },
  venue: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  meta: { color: colors.textFaint, fontFamily: mono, fontSize: 11 },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginTop: 18, fontStyle: "italic" },
});
