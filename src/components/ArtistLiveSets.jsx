import { useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, mono, radius } from "../theme";
import Icon from "./Icon";
import Stars from "./Stars";
import { formatDate } from "../domain/dates.mjs";
import { formatFestivalDay, setRoleLabel } from "../domain/lineup.mjs";
import { PostNavigationContext } from "./PostNavigationContext";

const ROLE_ORDER = ["opener", "co_headliner", "festival_set"];
const ROLE_TITLES = { opener: "Opening sets", co_headliner: "Co-headline sets", festival_set: "Festival sets" };
const LIST_LIMIT = 5;

// An artist's sets on other people's bills, from fans' concert reviews: how
// their opening, co-headline and festival sets were rated, who they opened
// for, and the latest notes. `data` is GET /api/artists/sets.
export default function ArtistLiveSets({ data, artistName, onOpenArtist, onOpenProfile }) {
  const openPostById = useContext(PostNavigationContext);
  const summary = data?.summary && typeof data.summary === "object" ? data.summary : {};
  const roles = ROLE_ORDER.filter((role) => Number(summary[role]?.sets) > 0);
  if (!roles.length) return null;
  const total = roles.reduce((sum, role) => sum + Number(summary[role].sets), 0);
  const sets = (Array.isArray(data.sets) ? data.sets : []).slice(0, LIST_LIMIT);
  const openedFor = Array.isArray(data.openedFor) ? data.openedFor : [];
  const festivals = Array.isArray(data.festivals) ? data.festivals : [];
  return <View style={styles.wrap}>
    <Text style={styles.label}>{`LIVE SETS · ${total}`}</Text>
    <Text style={styles.intro}>{`How fans rated ${artistName}'s sets when they opened, shared the bill or played a festival.`}</Text>
    <View style={styles.summaryRow}>
      {roles.map((role) => <View key={role} style={styles.summaryCard} accessibilityLabel={`${ROLE_TITLES[role]}: ${summary[role].average ? `${summary[role].average} out of 5 from ${summary[role].rated} ratings` : `${summary[role].sets} logged`}`}>
        <Text style={styles.summaryTitle}>{ROLE_TITLES[role]}</Text>
        {summary[role].average ? <View style={styles.summaryScore}>
          <Text style={styles.summaryNumber}>{summary[role].average.toFixed(1)}</Text>
          <Stars value={summary[role].average} size={11} />
        </View> : null}
        <Text style={styles.summaryMeta}>{summary[role].rated ? `${summary[role].rated} ${summary[role].rated === 1 ? "rating" : "ratings"}` : `${summary[role].sets} logged`}</Text>
      </View>)}
    </View>
    {openedFor.length ? <View style={styles.inline}>
      <Text style={styles.inlineLabel}>Opened for </Text>
      {openedFor.map((headliner, index) => <View key={`${headliner.artistKey || headliner.name}`} style={styles.inlineItem}>
        {index ? <Text style={styles.dot}> · </Text> : null}
        <Pressable onPress={() => onOpenArtist?.(headliner.name)} accessibilityRole="link" accessibilityLabel={`Open ${headliner.name}`} hitSlop={4}>
          <Text style={styles.inlineName}>{headliner.name}</Text>
        </Pressable>
        {headliner.shows > 1 ? <Text style={styles.count}> ({headliner.shows})</Text> : null}
      </View>)}
    </View> : null}
    {festivals.length ? <Text style={styles.inlineText}><Text style={styles.inlineLabel}>Festivals </Text>{festivals.map((festival) => festival.name).join(" · ")}</Text> : null}
    <View style={styles.list}>
      {sets.map((set) => <Pressable key={`${set.postId}:${set.role}`} style={({ pressed }) => [styles.set, pressed && styles.pressed]} onPress={() => openPostById?.(set.postId)}
        accessibilityRole="button" accessibilityLabel={`Open the review: ${setRoleLabel(set.role)} ${set.role === "festival_set" ? "at" : "for"} ${set.headliner?.name || "a show"}`}>
        <View style={styles.setHead}>
          {set.rating ? <View style={styles.setRating}><Icon name="star" size={11} color={colors.amber} /><Text style={styles.setRatingText}>{Number(set.rating).toFixed(1)}</Text></View> : null}
          <Text style={styles.setTitle} numberOfLines={2}>
            {set.role === "festival_set" ? `${set.headliner?.name || "Festival"}` : `${setRoleLabel(set.role)} ${set.role === "opener" ? "for" : "with"} ${set.headliner?.name || ""}`}
          </Text>
        </View>
        <Text style={styles.setMeta} numberOfLines={1}>
          {[set.venue, set.day ? formatFestivalDay(set.day) : set.date ? formatDate(set.date, set.date) : "", set.stage].filter(Boolean).join(" · ")}
        </Text>
        {set.review ? <Text style={styles.setNote} numberOfLines={4}>{set.review}</Text> : null}
        {set.user ? <Pressable onPress={() => onOpenProfile?.(set.user.id)} accessibilityRole="link" accessibilityLabel={`Open ${set.user.name}'s profile`} hitSlop={4}>
          <Text style={styles.by}>{`${set.user.name}${set.user.handle ? ` @${set.user.handle}` : ""}`}</Text>
        </Pressable> : null}
      </Pressable>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginTop: 8, marginBottom: 12 },
  label: { color: colors.textDim, fontFamily: mono, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  intro: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryCard: { flexGrow: 1, flexBasis: 140, gap: 3, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12 },
  summaryTitle: { color: colors.textDim, fontSize: 11.5, fontWeight: "800" },
  summaryScore: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryNumber: { color: colors.text, fontSize: 22, fontWeight: "900" },
  summaryMeta: { color: colors.textFaint, fontSize: 11.5 },
  inline: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  inlineItem: { flexDirection: "row", alignItems: "center" },
  inlineLabel: { color: colors.textFaint, fontSize: 12.5, fontWeight: "700" },
  inlineText: { color: colors.textDim, fontSize: 12.5, fontWeight: "700" },
  inlineName: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
  count: { color: colors.textFaint, fontSize: 12 },
  dot: { color: colors.textFaint, fontSize: 12 },
  list: { gap: 8 },
  set: { gap: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 10 },
  pressed: { opacity: 0.8 },
  setHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  setRating: { flexDirection: "row", alignItems: "center", gap: 3 },
  setRatingText: { color: colors.amber, fontFamily: mono, fontSize: 12.5, fontWeight: "900" },
  setTitle: { color: colors.text, fontSize: 14, fontWeight: "800", flex: 1 },
  setMeta: { color: colors.textFaint, fontSize: 12 },
  setNote: { color: colors.textDim, fontSize: 13.5, lineHeight: 19 },
  by: { color: colors.textFaint, fontSize: 12, fontWeight: "700" },
});
