import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, font, mono, radius } from "../../theme";
import { fetchLiveEvent } from "../../lib/newsDeskApi";
import { liveEventFrom, liveHeaderText, sinceText, winnersProgressText } from "../../domain/newsLive.mjs";

const REFRESH_MS = 60_000;

// Category | Winner | Nominees. Three columns when there is room; each row
// stacks on a phone.
function WinnersTable({ event }) {
  const [wide, setWide] = useState(false);
  if (!event.winners.total) return null;
  return <View style={styles.section} onLayout={(layout) => setWide(layout.nativeEvent.layout.width >= 520)} accessibilityLabel="Winners">
    <Text accessibilityRole="header" style={styles.sectionTitle}>Winners</Text>
    <Text style={styles.meta}>{winnersProgressText(event)}</Text>
    {wide ? <View style={[styles.row, styles.headRow]}>
      <Text style={[styles.headCell, styles.categoryCell]}>CATEGORY</Text>
      <Text style={[styles.headCell, styles.winnerCell]}>WINNER</Text>
      <Text style={[styles.headCell, styles.nomineesCell]}>NOMINEES</Text>
    </View> : null}
    {event.winners.categories.map((category) => (
      <View key={category.id} style={[styles.row, !wide && styles.rowStacked]}
        accessibilityLabel={`${category.name}: ${category.winner ? `winner ${category.winner}` : "to be announced"}`}>
        <Text style={[styles.category, wide && styles.categoryCell]}>{category.name}</Text>
        <Text style={[styles.winner, wide && styles.winnerCell, !category.winner && styles.pending]}>{category.winner || "To be announced"}</Text>
        <View style={wide ? styles.nomineesCell : null}>
          {!wide ? <Text style={styles.headCell}>NOMINEES</Text> : null}
          {category.nominees.map((name) => <Text key={name} style={[styles.nominee, name === category.winner && styles.nomineeWon]}>{name}</Text>)}
        </View>
      </View>
    ))}
  </View>;
}

// The full page of one live event (/news/live/<slug>) inside the app.
export default function LiveEventPanel({ slug }) {
  const [state, setState] = useState({ event: null, status: "loading" });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let controller = null;
    let timer = null;
    let stopped = false;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      let event = null;
      try {
        event = liveEventFrom((await fetchLiveEvent(slug, { signal: controller.signal }))?.event);
      } catch {
        // architecture: allow-ambiguous-result -- the panel keeps its last good copy and says so below
        event = null;
      }
      if (stopped) return;
      setNow(Date.now());
      setState((current) => (event ? { event, status: "ready" } : { ...current, status: current.event ? "stale" : "missing" }));
      if (!event || event.live) timer = setTimeout(load, REFRESH_MS);
    };
    void load();
    return () => { stopped = true; controller?.abort(); if (timer) clearTimeout(timer); };
  }, [slug]);

  const event = state.event;
  if (!event) {
    return state.status === "missing"
      ? <View style={styles.panel}><Text style={styles.meta}>This live coverage is not available.</Text></View>
      : null;
  }
  return <View style={styles.panel} accessibilityLabel={`${event.live ? "Live coverage" : "Coverage"}: ${event.title}`}>
    <View style={styles.head}>
      <View style={[styles.badge, !event.live && styles.badgeEnded]}>
        {event.live ? <View style={styles.dot} /> : null}
        <Text style={styles.badgeText}>{event.live ? "LIVE" : "RECAP"}</Text>
      </View>
      <Text accessibilityRole="header" style={styles.title}>{event.title}</Text>
    </View>
    <Text style={styles.meta}>{liveHeaderText(event, now)}</Text>
    {state.status === "stale" ? <Text style={styles.meta}>Could not refresh; showing the last update.</Text> : null}
    <WinnersTable event={event} />
    {event.items.length ? <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Live updates</Text>
      {event.items.map((item) => {
        const body = <>
          <Text style={styles.itemMeta}>{sinceText(item.at, now)} · {item.source}</Text>
          <Text style={[styles.itemText, item.kind === "note" && styles.noteText]}>{item.text}</Text>
        </>;
        return item.url
          ? <Pressable key={item.id} onPress={() => { void Linking.openURL(item.url); }} accessibilityRole="link"
            accessibilityLabel={`${item.text}, ${item.source}`} style={({ focused }) => [styles.item, focused && focusRing]}>{body}</Pressable>
          : <View key={item.id} style={styles.item}>{body}</View>;
      })}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.magenta, backgroundColor: colors.surface, padding: 16, gap: 10, marginBottom: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.magenta, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeEnded: { backgroundColor: colors.textFaint },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.bg },
  badgeText: { color: colors.bg, fontFamily: mono, fontSize: 10.5, fontWeight: "900", letterSpacing: 1.2 },
  title: { flex: 1, color: colors.text, fontFamily: font, fontSize: 20, fontWeight: "800" },
  meta: { color: colors.textDim, fontFamily: font, fontSize: 12.5 },
  section: { gap: 6, marginTop: 8 },
  sectionTitle: { color: colors.text, fontFamily: font, fontSize: 15, fontWeight: "800" },
  row: { flexDirection: "row", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  rowStacked: { flexDirection: "column", gap: 4 },
  headRow: { borderTopWidth: 0, paddingVertical: 4 },
  headCell: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, letterSpacing: 1 },
  categoryCell: { flexBasis: "28%", flexShrink: 0 },
  winnerCell: { flexBasis: "30%", flexShrink: 0 },
  nomineesCell: { flex: 1 },
  category: { color: colors.text, fontFamily: font, fontSize: 14, fontWeight: "700" },
  winner: { color: colors.gold, fontFamily: font, fontSize: 14, fontWeight: "800" },
  pending: { color: colors.textDim, fontWeight: "400" },
  nominee: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 19 },
  nomineeWon: { color: colors.gold, fontWeight: "700" },
  item: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft, gap: 2 },
  itemMeta: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, letterSpacing: 0.4 },
  itemText: { color: colors.text, fontFamily: font, fontSize: 13.5, lineHeight: 19 },
  noteText: { fontWeight: "700" },
});
