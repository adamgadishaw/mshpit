import { useLayoutEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, font, mono, radius } from "../../theme";
import { latestWinners, liveHeaderText, sinceText, winnersProgressText } from "../../domain/newsLive.mjs";
import { useNewsInteractions } from "./NewsInteractionContext";
import useLiveCoverage from "./useLiveCoverage";
import useNativeTabPreview from "../../hooks/useNativeTabPreview";
import useFeedPresentation from "../../hooks/useFeedPresentation";

function LiveItem({ item, now, current }) {
  const body = <>
    <Text style={styles.itemMeta}>{sinceText(item.at, now)} · {item.source}</Text>
    <Text style={[styles.itemText, item.kind === "note" && styles.noteText]}>{item.text}</Text>
  </>;
  if (!item.url) return <View style={styles.item}>{body}</View>;
  return <Pressable onPress={() => { if (current()) void Linking.openURL(item.url); }} accessibilityRole="link"
    accessibilityLabel={`${item.text}, ${item.source}`} style={({ focused }) => [styles.item, focused && focusRing]}>{body}</Pressable>;
}

function LiveEvent({ event, compact, preview, current }) {
  const { openLiveCoverage } = useNewsInteractions();
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useLayoutEffect(() => {
    if (preview) return undefined;
    setNow(Date.now());
    let cancelled = false;
    const timer = setInterval(() => { if (!cancelled && current()) setNow(Date.now()); }, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [preview, current]);
  const shown = expanded ? event.items : event.items.slice(0, compact ? 3 : 5);
  return <View style={styles.card} accessibilityLabel={`${event.live ? "Live coverage" : "Coverage recap"}: ${event.title}`}>
    <View style={styles.head}>
      <View style={[styles.badge, !event.live && styles.badgeEnded]}>
        {event.live ? <View style={styles.dot} /> : null}
        <Text style={styles.badgeText}>{event.live ? "LIVE" : "RECAP"}</Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
    </View>
    <Text style={styles.meta}>{liveHeaderText(event, now)}</Text>
    {event.winners.total ? <View style={styles.winners}>
      <Text style={styles.winnersHead}>WINNERS · {winnersProgressText(event).toUpperCase()}</Text>
      {latestWinners(event, compact ? 2 : 3).map((category) => <Text key={category.id} style={styles.winnerLine}>
        <Text style={styles.winnerCategory}>{category.name}: </Text>{category.winner}</Text>)}
    </View> : null}
    {shown.length ? <View style={styles.list}>{shown.map((item) => <LiveItem key={item.id} item={item} now={now} current={current} />)}</View> : null}
    {event.slug && openLiveCoverage ? (
      <Pressable onPress={() => { if (current()) openLiveCoverage(event.slug); }} accessibilityRole="button" hitSlop={6}
        style={({ focused }) => [focused && focusRing]} accessibilityLabel={`Open full coverage of ${event.title}`}>
        <Text style={styles.more}>{event.winners.total ? "Full winners list" : "Full coverage"}</Text>
      </Pressable>
    ) : null}
    {event.items.length > shown.length ? (
      <Pressable onPress={() => { if (current()) setExpanded(true); }} accessibilityRole="button" hitSlop={6}
        style={({ focused }) => [focused && focusRing]} accessibilityLabel={`Show all updates for ${event.title}`}>
        <Text style={styles.more}>Show all {event.items.length} updates</Text>
      </Pressable>
    ) : null}
  </View>;
}

// Running coverage of a big night (an award show) at the top of the news:
// outlet headlines link out to the story; Mshpit updates read in place.
export default function LiveCoverageCard({ compact = false, enabled = true, presentation = null }) {
  const preview = useNativeTabPreview();
  const { current } = useFeedPresentation({ active: !preview, presentation, scope: "live-coverage" });
  const events = useLiveCoverage({ enabled, isCurrent: presentation?.current });
  if (!events.length) return null;
  return <View style={styles.stack}>{events.map((event) => <LiveEvent key={event.id} event={event} compact={compact} preview={preview} current={current} />)}</View>;
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  card: { borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.magenta, backgroundColor: colors.surface, padding: 14, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.magenta, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeEnded: { backgroundColor: colors.textFaint },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.bg },
  badgeText: { color: colors.bg, fontFamily: mono, fontSize: 10.5, fontWeight: "900", letterSpacing: 1.2 },
  title: { flex: 1, color: colors.text, fontFamily: font, fontSize: 16, fontWeight: "800" },
  meta: { color: colors.textDim, fontFamily: font, fontSize: 12 },
  list: { gap: 2 },
  item: { paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.lineSoft, gap: 2 },
  itemMeta: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, letterSpacing: 0.4 },
  itemText: { color: colors.text, fontFamily: font, fontSize: 13.5, lineHeight: 19 },
  noteText: { fontWeight: "700" },
  winners: { gap: 3, paddingTop: 2 },
  winnersHead: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, letterSpacing: 1 },
  winnerLine: { color: colors.gold, fontFamily: font, fontSize: 13.5, fontWeight: "700" },
  winnerCategory: { color: colors.textDim, fontWeight: "400" },
  more: { color: colors.amber, fontFamily: font, fontSize: 12.5, fontWeight: "800", paddingTop: 4 },
});
