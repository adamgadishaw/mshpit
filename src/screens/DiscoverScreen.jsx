import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import { tasteMatches } from "../data";
import { useStore } from "../store";
import Stars from "../components/Stars";
import Icon from "../components/Icon";
import CardGrid from "../components/CardGrid";

export default function DiscoverScreen({ onOpenTopRated, onOpen, onOpenArtist, onOpenNearby }) {
  const { session, recommendedShows } = useStore();
  const recs = session ? recommendedShows() : [];

  const openMatch = (m) => {
    const venue = (m.near.split(" · ")[1] || "Upcoming show").trim();
    onOpen?.({
      id: "disc_" + m.artist, user: { name: "Community", handle: "pit", initials: "PT" }, timeAgo: "aggregate",
      artist: m.artist, venue, city: m.near.split(" · ")[0] || "", date: "2026 · upcoming", media: 0,
      overall: m.band, band: m.band, room: 4.0, review: "", setlist: [], likes: 0, comments: 0, inTourWindow: false,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Discover</Text>
      <Text style={styles.sub}>find shows worth seeing</Text>

      {/* quick entry points */}
      <CardGrid minColWidth={240} style={{ marginTop: 16 }}>
        <Pressable style={styles.entry} onPress={onOpenTopRated}>
          <View style={styles.entryIcon}><Icon name="trophy" size={18} color={colors.gold} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.entryTitle}>Best rated</Text>
            <Text style={styles.entrySub}>Top shows near you</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textDim} />
        </Pressable>
        <Pressable style={styles.entry} onPress={onOpenNearby}>
          <View style={styles.entryIcon}><Icon name="pin" size={18} color={colors.amber} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.entryTitle}>Near you</Text>
            <Text style={styles.entrySub}>Local venues & shows</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textDim} />
        </Pressable>
      </CardGrid>

      {/* personalized push: genre affinity + proximity + who you follow */}
      {recs.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>FOR YOU · {recs.length}</Text>
          <CardGrid minColWidth={260}>
            {recs.map((r) => (
              <Pressable key={r.id} style={styles.card} onPress={() => onOpenArtist?.(r.artist)}>
                <Text style={styles.artist} numberOfLines={1}>{r.artist}</Text>
                <View style={styles.reasonChip}>
                  <Icon name="discover" size={11} color={colors.amber} />
                  <Text style={styles.reasonChipTxt} numberOfLines={1}>{r.reason}</Text>
                </View>
                <Text style={styles.near} numberOfLines={1}>
                  {r.venue} · {r.date}{r.distanceKm != null ? `  · ${r.distanceKm.toFixed(0)} km` : ""}
                </Text>
                {r.soldOut && <View style={styles.soldOut}><Text style={styles.soldOutTxt}>SOLD OUT</Text></View>}
              </Pressable>
            ))}
          </CardGrid>
        </>
      )}

      <Text style={styles.sectionLabel}>FROM PEOPLE YOU FOLLOW · {tasteMatches.length}</Text>
      <CardGrid minColWidth={260}>
        {tasteMatches.map((m) => (
          <Pressable key={m.artist} style={styles.card} onPress={() => openMatch(m)}>
            <View style={styles.cardHead}>
              <Text style={styles.artist} numberOfLines={1}>{m.artist}</Text>
              <View style={styles.bandPill}>
                <Icon name="star" size={10} color={colors.gold} />
                <Text style={styles.bandVal}>{m.band.toFixed(1)}</Text>
              </View>
            </View>
            <Text style={styles.reason} numberOfLines={2}>{m.reason}</Text>
            <Text style={styles.near} numberOfLines={1}>{m.near}</Text>
          </Pressable>
        ))}
      </CardGrid>

      <View style={styles.loop}>
        <Text style={styles.loopText}>
          The discovery loop: when several people whose taste matches yours rate a touring act highly,
          and it&apos;s playing near you — that&apos;s the ticket you&apos;d never have bought otherwise.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  title: { color: colors.text, fontSize: 26, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 3 },

  entry: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, padding: 14 },
  entryIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  entryTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  entrySub: { color: colors.textDim, fontSize: 12, marginTop: 2 },

  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 24, marginBottom: 10 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, gap: 2 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  artist: { color: colors.text, fontSize: 16, fontWeight: "700", flexShrink: 1 },
  reasonChip: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: 8, backgroundColor: colors.bgElev, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, maxWidth: "100%" },
  reasonChipTxt: { color: colors.amber, fontSize: 11, fontWeight: "600", flexShrink: 1 },
  reason: { color: colors.amber, fontSize: 12, marginTop: 6 },
  near: { color: colors.textDim, fontFamily: mono, fontSize: 12, marginTop: 8 },
  bandPill: { flexDirection: "row", alignItems: "center", gap: 4 },
  bandVal: { color: colors.gold, fontFamily: mono, fontSize: 13, fontWeight: "700" },
  soldOut: { alignSelf: "flex-start", marginTop: 8, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  soldOutTxt: { color: colors.danger, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  loop: { marginTop: 22, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 16 },
  loopText: { color: colors.textDim, fontSize: 13, lineHeight: 20, fontStyle: "italic" },
});
