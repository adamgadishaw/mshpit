import { useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, mono, radius } from "../theme";
import Stars from "./Stars";
import { formatFestivalDay, lineupSections } from "../domain/lineup.mjs";
import { PostNavigationContext } from "./PostNavigationContext";

// The whole lineup of one review on its show page: every opener, headliner or
// festival set with the author's rating and note, and the day and stage at a
// festival. Names open the artist; "Full review" opens the author's own review
// of that act from the same night.
export default function LineupDetails({ post, onOpenArtist, style }) {
  const openPostById = useContext(PostNavigationContext);
  const sections = lineupSections(post);
  if (!sections.length) return null;
  const festival = post?.showFormat === "festival";
  let lastDay = null;
  return <View style={[styles.wrap, style]}>
    {sections.map((section) => <View key={section.key} style={styles.section}>
      <Text style={styles.heading}>{section.title.toUpperCase()}</Text>
      {section.acts.map((act) => {
        const dayHeader = festival && act.day && act.day !== lastDay ? formatFestivalDay(act.day) : null;
        if (festival && act.day) lastDay = act.day;
        return <View key={act.name}>
          {dayHeader ? <Text style={styles.day}>{dayHeader}</Text> : null}
          <View style={styles.act}>
            <View style={styles.actHead}>
              {onOpenArtist ? <Pressable onPress={() => onOpenArtist(act.name)} accessibilityRole="link" accessibilityLabel={`Open ${act.name}`} hitSlop={4} style={styles.nameWrap}>
                <Text style={styles.name} numberOfLines={2}>{act.name}</Text>
              </Pressable> : <Text style={[styles.name, styles.nameWrap]} numberOfLines={2}>{act.name}</Text>}
              {act.rating ? <View style={styles.rating} accessibilityLabel={`${act.rating} out of 5 stars`}>
                <Stars value={act.rating} size={12} />
                <Text style={styles.ratingText}>{act.rating.toFixed(1)}</Text>
              </View> : null}
            </View>
            {festival && act.stage ? <Text style={styles.meta}>{act.stage}</Text> : null}
            {act.review ? <Text style={styles.note} selectable>{act.review}</Text> : null}
            {act.reviewPostId && openPostById ? <Pressable onPress={() => openPostById(act.reviewPostId)} accessibilityRole="link"
              accessibilityLabel={`Open the full review of ${act.name} from this night`} hitSlop={4}>
              <Text style={styles.link}>Full review</Text>
            </Pressable> : null}
          </View>
        </View>;
      })}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  section: { gap: 8 },
  heading: { color: colors.textDim, fontSize: 11, letterSpacing: 1.2, fontWeight: "800" },
  day: { color: colors.amber, fontSize: 12, fontWeight: "800", marginTop: 4, marginBottom: 4 },
  act: { gap: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 10 },
  actHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  nameWrap: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: "800" },
  rating: { flexDirection: "row", alignItems: "center", gap: 5 },
  ratingText: { color: colors.amber, fontFamily: mono, fontSize: 12, fontWeight: "800" },
  meta: { color: colors.textFaint, fontSize: 12 },
  note: { color: colors.textDim, fontSize: 13.5, lineHeight: 19 },
  link: { color: colors.amber, fontSize: 12.5, fontWeight: "800" },
});
