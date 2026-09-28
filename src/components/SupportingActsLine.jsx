import { useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import Icon from "./Icon";
import { lineupSections } from "../domain/lineup.mjs";
import { PostNavigationContext } from "./PostNavigationContext";

const CARD_LIMIT = 4;

// The lineup under a concert review, compact: "Openers: Muna 4.5 · Phoebe
// Bridgers (review)", "Co-headliner: Usher 5.0", or a festival's first few
// sets with "+8 more". A name opens the artist; "review" opens the author's
// own full review of that act from the same night.
export default function SupportingActsLine({ post, onOpenArtist, style, limit = CARD_LIMIT }) {
  const openPostById = useContext(PostNavigationContext);
  const sections = lineupSections(post);
  if (!sections.length) return null;
  return <View style={style}>
    {sections.map((section) => {
      const shown = section.acts.slice(0, limit);
      const more = section.acts.length - shown.length;
      return <View key={section.key} style={styles.row} accessibilityLabel={`${section.title}: ${section.acts.map((act) => act.name).join(", ")}`}>
        <Text style={styles.heading}>{section.title}: </Text>
        {shown.map((act, index) => <View key={act.name} style={styles.act}>
          {index ? <Text style={styles.dot}> · </Text> : null}
          {onOpenArtist ? <Pressable onPress={() => onOpenArtist(act.name)} accessibilityRole="link" accessibilityLabel={`Open ${act.name}`} hitSlop={4}>
            <Text style={styles.name}>{act.name}</Text>
          </Pressable> : <Text style={styles.name}>{act.name}</Text>}
          {act.rating ? <View style={styles.rating} accessibilityLabel={`${act.rating} out of 5`}>
            <Icon name="star" size={10} color={colors.amber} />
            <Text style={styles.ratingText}>{act.rating.toFixed(1)}</Text>
          </View> : null}
          {act.reviewPostId && openPostById ? <Pressable onPress={() => openPostById(act.reviewPostId)} accessibilityRole="link"
            accessibilityLabel={`Open the review of ${act.name} from this night`} hitSlop={4}>
            <Text style={styles.review}> (review)</Text>
          </Pressable> : null}
        </View>)}
        {more > 0 ? <Text style={styles.more}> +{more} more</Text> : null}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 4 },
  heading: { color: colors.textFaint, fontSize: 12, fontWeight: "700" },
  act: { flexDirection: "row", alignItems: "center" },
  dot: { color: colors.textFaint, fontSize: 12 },
  name: { color: colors.textDim, fontSize: 12.5, fontWeight: "700" },
  rating: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 4 },
  ratingText: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  review: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  more: { color: colors.textFaint, fontSize: 12, fontWeight: "700" },
});
