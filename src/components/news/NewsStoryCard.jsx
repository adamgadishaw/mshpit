import { memo } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, displayFont, focusRing, font, mono, radius } from "../../theme";
import Icon from "../Icon";
import { relativeTime } from "../../domain/dates.mjs";
import { newsCategoryLabel, newsSourceLine, newsStoryPhoto } from "../../domain/newsDesk.mjs";

const openSource = (url) => {
  if (!/^https:\/\//u.test(String(url || ""))) return;
  void Linking.openURL(url).catch(() => undefined);
};

// A story from the Mshpit News desk. Full cards sit in the feed and the News
// tab; compact cards fill the phone strip and the desktop news panel.
function NewsStoryCard({ story, compact = false, onOpen, onOpenArtist }) {
  if (!story?.headline) return null;
  const photo = newsStoryPhoto(story);
  const sourceLine = newsSourceLine(story);
  const meta = `${newsCategoryLabel(story.category).toUpperCase()} · ${relativeTime(story.publishedAt)}`;

  if (compact) {
    return (
      <Pressable style={({ pressed, hovered, focused }) => [styles.compact, hovered && styles.hover, pressed && styles.pressed, focused && focusRing]}
        onPress={() => onOpen?.(story)} disabled={!onOpen} accessibilityRole="button"
        accessibilityLabel={`${story.headline}. ${sourceLine}`}>
        {photo ? <Image source={{ uri: photo }} style={styles.compactPhoto} contentFit="cover" contentPosition="top center" cachePolicy="memory-disk" accessible={false} /> : null}
        <View style={styles.compactCopy}>
          <Text style={styles.kicker} numberOfLines={1}>{meta}</Text>
          <Text style={styles.compactHeadline} numberOfLines={3}>{story.headline}</Text>
          {story.confirmedBy > 1 ? <Text style={styles.compactSources} numberOfLines={1}>{`${story.confirmedBy} outlets`}</Text> : null}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.card} accessibilityRole="article">
      <View style={styles.head}>
        <View style={styles.badge}><Icon name="music" size={13} color="#1A1206" /></View>
        <Text style={styles.brand}>MSHPIT NEWS</Text>
        <Text style={styles.kicker} numberOfLines={1}>{meta}</Text>
      </View>
      <Pressable style={({ pressed, focused }) => [styles.body, pressed && styles.pressed, focused && focusRing]}
        onPress={() => onOpen?.(story)} disabled={!onOpen} accessibilityRole="button"
        accessibilityLabel={`${story.headline}. Open the story and comments.`}>
        <View style={styles.bodyCopy}>
          <Text style={styles.headline}>{story.headline}</Text>
          {story.summary ? <Text style={styles.summary}>{story.summary}</Text> : null}
        </View>
        {photo ? <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" contentPosition="top center" cachePolicy="memory-disk" accessible={false} /> : null}
      </Pressable>
      {story.artists?.length ? (
        <View style={styles.artists}>
          {story.artists.slice(0, 4).map((artist) => (
            <Pressable key={artist.key} style={({ pressed, focused }) => [styles.artistChip, pressed && styles.pressed, focused && focusRing]}
              onPress={() => onOpenArtist?.(artist.name)} disabled={!onOpenArtist} accessibilityRole="link" accessibilityLabel={`Open ${artist.name}`}>
              <Text style={styles.artistName} numberOfLines={1}>{artist.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {sourceLine ? (
        <View style={styles.sources}>
          <Icon name="check" size={13} color={colors.good} />
          <Text style={styles.sourceText}>
            {"Confirmed by "}
            {story.sources.slice(0, 4).map((source, index, list) => (
              <Text key={source.url}>
                <Text style={styles.sourceLink} onPress={() => openSource(source.url)} accessibilityRole="link"
                  {...(Platform.OS === "web" ? { href: source.url, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } : {})}>{source.name}</Text>
                {index < list.length - 2 ? ", " : index === list.length - 2 ? " and " : ""}
              </Text>
            ))}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default memo(NewsStoryCard);

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, padding: 16, gap: 12, marginBottom: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  brand: { color: colors.text, fontFamily: mono, fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  kicker: { flexShrink: 1, color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "800", letterSpacing: 1 },
  body: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  bodyCopy: { flex: 1, minWidth: 0, gap: 6 },
  headline: { color: colors.text, fontFamily: displayFont, fontSize: 19, lineHeight: 24, fontWeight: "900", letterSpacing: -0.3 },
  summary: { color: colors.textDim, fontFamily: font, fontSize: 14, lineHeight: 21 },
  photo: { width: 88, height: 88, borderRadius: radius.md, backgroundColor: colors.bgElev },
  artists: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  artistChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, maxWidth: 220 },
  artistName: { color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "800" },
  sources: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  sourceText: { flex: 1, color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 17 },
  sourceLink: { color: colors.text, fontWeight: "800", textDecorationLine: "underline" },
  compact: { flexDirection: "row", gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  compactPhoto: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  compactCopy: { flex: 1, minWidth: 0, gap: 3 },
  compactHeadline: { color: colors.text, fontFamily: font, fontSize: 13.5, lineHeight: 18, fontWeight: "800" },
  compactSources: { color: colors.textFaint, fontFamily: font, fontSize: 11 },
  hover: { borderColor: colors.line },
  pressed: { opacity: 0.85 },
});
