import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, font, mono, radius } from "../../theme";
import NewsStoryCard from "./NewsStoryCard";
import useNewsDeskStories from "./useNewsDeskStories";

// The desktop news panel: the latest confirmed stories, always one glance away
// beside the feed, like a desktop news widget.
export default function NewsRailPanel({ onOpenStory, onOpenAll }) {
  const news = useNewsDeskStories({ limit: 5 });
  if (news.status !== "loading" && !news.stories.length) return null;
  return (
    <View style={styles.panel} accessibilityLabel="Music news">
      <View style={styles.head}>
        <View>
          <Text style={styles.title}>MUSIC NEWS</Text>
          <Text style={styles.sub}>Confirmed by at least two outlets</Text>
        </View>
        {onOpenAll ? (
          <Pressable onPress={onOpenAll} hitSlop={8} style={({ focused }) => [focused && focusRing]} accessibilityRole="button" accessibilityLabel="See all music news">
            <Text style={styles.all}>See all</Text>
          </Pressable>
        ) : null}
      </View>
      {news.stories.length ? (
        <View style={styles.list}>
          {news.stories.map((story) => <NewsStoryCard key={story.id} compact story={story} onOpen={onOpenStory} />)}
        </View>
      ) : (
        <Text style={styles.sub}>Loading the latest stories...</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  title: { color: colors.text, fontFamily: mono, fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  sub: { color: colors.textDim, fontFamily: font, fontSize: 11.5, marginTop: 2 },
  all: { color: colors.amber, fontFamily: font, fontSize: 12.5, fontWeight: "800" },
  list: { gap: 8 },
});
