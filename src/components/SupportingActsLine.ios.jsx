import { useContext, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors } from "../theme";
import Icon from "./Icon";
import { lineupSections } from "../domain/lineup.mjs";
import { formatDate } from "../domain/dates.mjs";
import { PostNavigationContext } from "./PostNavigationContext";

// Compact cards keep the main review first. Every saved act, score, note and
// linked review remains available behind one disclosure; detail posts start open.
export default function SupportingActsLine({ post, onOpenArtist, style, compact = false }) {
  const openPostById = useContext(PostNavigationContext);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.25;
  const scope = `${post?.id || ""}:${compact}`;
  const [disclosure, setDisclosure] = useState({ scope, expanded: false });
  const expanded = !compact || disclosure.scope === scope && disclosure.expanded;
  const sections = lineupSections(post);
  if (!sections.length) return null;
  const acts = sections.flatMap((section) => section.acts);
  const rated = acts.filter((act) => act.rating != null).length;
  const title = post?.showFormat === "festival" ? "Sets seen" : "Lineup";
  const summary = `${acts.length} ${acts.length === 1 ? "act" : "acts"}${rated ? ` · ${rated} rated` : ""}`;

  return <View style={[styles.container, style]}>
    {compact ? <Pressable
      onPress={() => setDisclosure({ scope, expanded: !expanded })}
      accessibilityRole="button" accessibilityState={{ expanded }}
      accessibilityLabel={`${expanded ? "Hide" : "Show"} ${title.toLowerCase()} details. ${summary}`}
      style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}>
      <View style={styles.summary}><Text style={styles.title}>{title}</Text><Text style={styles.detail}>{summary}</Text></View>
      <Icon name={expanded ? "chevron-down" : "chevron-right"} size={16} color={colors.textDim} />
    </Pressable> : <Text style={styles.title} accessibilityRole="header">{title}</Text>}
    {expanded ? <View style={styles.sections}>
      {sections.map((section) => <View key={section.key} style={styles.section}>
        <Text style={styles.heading} accessibilityRole="header">{section.title}</Text>
        {section.acts.map((act) => <View key={act.name} style={styles.act}>
          <View style={[styles.actHeader, largeText && styles.actHeaderLarge]}>
            {onOpenArtist ? <Pressable onPress={() => onOpenArtist(act.name)}
              accessibilityRole="link" accessibilityLabel={`Open ${act.name}`}
              style={({ pressed }) => [styles.artistLink, largeText && styles.artistLinkLarge, pressed && styles.pressed]}>
              <Text style={styles.name}>{act.name}</Text>
              <Icon name="chevron-right" size={13} color={colors.textFaint} />
            </Pressable> : <Text style={styles.name}>{act.name}</Text>}
            {act.rating != null ? <View style={styles.rating} accessible accessibilityRole="text"
              accessibilityLabel={`${act.name}: ${act.rating.toFixed(1)} out of 5`}>
              <Icon name="star" size={13} color={colors.gold} />
              <Text style={styles.ratingText}>{act.rating.toFixed(1)}<Text style={styles.detail}> / 5</Text></Text>
            </View> : null}
          </View>
          {act.day || act.stage ? <Text style={styles.detail}>{[act.day ? formatDate(act.day, act.day) : null, act.stage].filter(Boolean).join(" · ")}</Text> : null}
          {act.review ? <Text style={styles.note}>{act.review}</Text> : null}
          {act.reviewPostId && openPostById ? <Pressable onPress={() => openPostById(act.reviewPostId)}
            accessibilityRole="link" accessibilityLabel={`Open the review of ${act.name} from this night`}
            style={({ pressed }) => [styles.reviewLink, pressed && styles.pressed]}>
            <Text style={styles.reviewText}>Read full review</Text>
          </Pressable> : null}
        </View>)}
      </View>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.lineSoft, paddingTop: 8 },
  disclosure: { minHeight: 44, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  summary: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 8, rowGap: 4 },
  title: { color: colors.text, fontSize: 14, fontWeight: "600" },
  detail: { color: colors.textDim, fontSize: 13, lineHeight: 19, flexShrink: 1 },
  sections: { gap: 16, paddingTop: 8 },
  section: { gap: 4 },
  heading: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  act: { gap: 4, paddingBottom: 8 },
  actHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12 },
  actHeaderLarge: { flexDirection: "column", alignItems: "stretch" },
  artistLink: { minHeight: 44, minWidth: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  artistLinkLarge: { flex: 0, alignSelf: "stretch" },
  name: { flexShrink: 1, color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: "500" },
  rating: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5 },
  ratingText: { color: colors.gold, fontSize: 14, fontWeight: "600" },
  note: { color: colors.textDim, fontSize: 14, lineHeight: 21 },
  reviewLink: { minHeight: 44, minWidth: 44, paddingVertical: 10, justifyContent: "center", alignSelf: "flex-start", maxWidth: "100%" },
  reviewText: { color: colors.amber, fontSize: 14, lineHeight: 21, fontWeight: "500" },
  pressed: { opacity: 0.7 },
});
