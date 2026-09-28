import { useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { supportingActsForDisplay, supportingActsHeading } from "../domain/supportingActs.mjs";
import { PostNavigationContext } from "./PostNavigationContext";

// "Openers: Muna · Phoebe Bridgers (review)" under a concert review. A name
// opens the artist; "review" opens the author's own review of that act.
export default function SupportingActsLine({ acts, festival = false, onOpenArtist, style }) {
  const openPostById = useContext(PostNavigationContext);
  const shown = supportingActsForDisplay(acts);
  if (!shown.length) return null;
  return <View style={[styles.row, style]} accessibilityLabel={`${supportingActsHeading({ festival })}: ${shown.map((act) => act.name).join(", ")}`}>
    <Text style={styles.heading}>{supportingActsHeading({ festival })}: </Text>
    {shown.map((act, index) => <View key={act.name} style={styles.act}>
      {index ? <Text style={styles.dot}> · </Text> : null}
      {onOpenArtist ? <Pressable onPress={() => onOpenArtist(act.name)} accessibilityRole="link" accessibilityLabel={`Open ${act.name}`} hitSlop={4}>
        <Text style={styles.name}>{act.name}</Text>
      </Pressable> : <Text style={styles.name}>{act.name}</Text>}
      {act.reviewPostId && openPostById ? <Pressable onPress={() => openPostById(act.reviewPostId)} accessibilityRole="link"
        accessibilityLabel={`Open the review of ${act.name} from this night`} hitSlop={4}>
        <Text style={styles.review}> (review)</Text>
      </Pressable> : null}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 4 },
  heading: { color: colors.textFaint, fontSize: 12, fontWeight: "700" },
  act: { flexDirection: "row", alignItems: "center" },
  dot: { color: colors.textFaint, fontSize: 12 },
  name: { color: colors.textDim, fontSize: 12.5, fontWeight: "700" },
  review: { color: colors.amber, fontSize: 12, fontWeight: "800" },
});
