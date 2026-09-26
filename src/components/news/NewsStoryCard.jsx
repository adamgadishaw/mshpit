import { memo, useMemo } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, displayFont, focusRing, font, mono, radius } from "../../theme";
import Icon from "../Icon";
import { SocialShareButton } from "../SocialShareStudio";
import { relativeTime } from "../../domain/dates.mjs";
import { newsCategoryLabel, newsSourceLine, newsStoryParagraphs, newsStoryPhoto } from "../../domain/newsDesk.mjs";
import { buildNewsShareModel } from "../../domain/socialShareCard.mjs";

const openSource = (url) => {
  if (!/^https:\/\//u.test(String(url || ""))) return;
  void Linking.openURL(url).catch(() => undefined);
};

// A story from the Mshpit News desk. Cards sit in the feed and the News tab;
// `full` is the story's own page (the whole write-up); compact cards fill the
// phone strip, the desktop news panel and artist pages.
function NewsStoryCard({ story, compact = false, full = false, accountId = null, onOpen, onOpenArtist }) {
  const shareModel = useMemo(() => (compact ? null : buildNewsShareModel(story)), [compact, story]);
  if (!story?.headline) return null;
  const photo = newsStoryPhoto(story);
  const sourceLine = newsSourceLine(story);
  const meta = `${newsCategoryLabel(story.category).toUpperCase()} · ${relativeTime(story.publishedAt)}`;
  const paragraphs = full ? newsStoryParagraphs(story.body) : [];

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

  const copy = (
    <>
      <View style={styles.bodyCopy}>
        <Text style={full ? styles.headlineFull : styles.headline} accessibilityRole={full ? "header" : undefined}>{story.headline}</Text>
        {story.summary ? <Text style={full ? styles.lede : styles.summary}>{story.summary}</Text> : null}
        {!full && story.body && onOpen ? <Text style={styles.readMore}>Read the full story</Text> : null}
      </View>
      {photo ? <Image source={{ uri: photo }} style={full ? styles.photoFull : styles.photo} contentFit="cover" contentPosition="top center" cachePolicy="memory-disk" accessible={false} /> : null}
    </>
  );

  return (
    <View style={styles.card} accessibilityRole="article">
      <View style={styles.head}>
        <View style={styles.badge}><Icon name="music" size={13} color="#1A1206" /></View>
        <Text style={styles.brand}>MSHPIT NEWS</Text>
        <Text style={styles.kicker} numberOfLines={1}>{meta}</Text>
        <View style={styles.headSpacer} />
        {shareModel ? <SocialShareButton accountId={accountId} model={shareModel} label="Share" showLabel={full} /> : null}
      </View>
      {full ? <View style={styles.body}>{copy}</View> : (
        <Pressable style={({ pressed, focused }) => [styles.body, pressed && styles.pressed, focused && focusRing]}
          onPress={() => onOpen?.(story)} disabled={!onOpen} accessibilityRole="button"
          accessibilityLabel={`${story.headline}. Read the full story and comments.`}>
          {copy}
        </Pressable>
      )}
      {paragraphs.length ? (
        <View style={styles.article}>
          {paragraphs.map((paragraph, index) => <Text key={index} style={styles.paragraph}>{paragraph}</Text>)}
        </View>
      ) : null}
      {story.artists?.length ? (
        <View style={styles.artists}>
          {story.artists.slice(0, 4).map((artist) => (
            <Pressable key={artist.key} style={({ pressed, hovered, focused }) => [styles.artistChip, !artist.photo && styles.artistChipPlain, hovered && styles.hover, pressed && styles.pressed, focused && focusRing]}
              onPress={() => onOpenArtist?.(artist.name)} disabled={!onOpenArtist} accessibilityRole="link" accessibilityLabel={`Open ${artist.name}'s profile`}>
              {artist.photo ? <Image source={{ uri: artist.photo }} style={styles.artistPhoto} contentFit="cover" contentPosition="top center" cachePolicy="memory-disk" accessible={false} /> : null}
              <Text style={styles.artistName} numberOfLines={1}>{artist.name}</Text>
              {onOpenArtist ? <Icon name="chevron-right" size={13} color={colors.textFaint} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {sourceLine ? (
        <View style={styles.sources}>
          <Icon name="check" size={13} color={colors.good} />
          <Text style={styles.sourceText}>
            {"Confirmed by "}
            {story.sources.slice(0, full ? 10 : 4).map((source, index, list) => (
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
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  headSpacer: { flex: 1 },
  badge: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  brand: { color: colors.text, fontFamily: mono, fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  kicker: { flexShrink: 1, color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "800", letterSpacing: 1 },
  body: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  bodyCopy: { flex: 1, minWidth: 0, gap: 6 },
  headline: { color: colors.text, fontFamily: displayFont, fontSize: 19, lineHeight: 24, fontWeight: "900", letterSpacing: -0.3 },
  headlineFull: { color: colors.text, fontFamily: displayFont, fontSize: 24, lineHeight: 30, fontWeight: "900", letterSpacing: -0.4 },
  summary: { color: colors.textDim, fontFamily: font, fontSize: 14, lineHeight: 21 },
  lede: { color: colors.text, fontFamily: font, fontSize: 15.5, lineHeight: 23, fontWeight: "700" },
  readMore: { color: colors.amber, fontFamily: font, fontSize: 13, fontWeight: "800", marginTop: 2 },
  photo: { width: 88, height: 88, borderRadius: radius.md, backgroundColor: colors.bgElev },
  photoFull: { width: 104, height: 104, borderRadius: radius.md, backgroundColor: colors.bgElev },
  article: { gap: 12 },
  paragraph: { color: colors.text, fontFamily: font, fontSize: 15, lineHeight: 24 },
  artists: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  artistChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 5, paddingRight: 9, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, maxWidth: 240 },
  artistChipPlain: { paddingLeft: 9, paddingVertical: 6 },
  artistPhoto: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceAlt },
  artistName: { flexShrink: 1, color: colors.text, fontFamily: font, fontSize: 12.5, fontWeight: "800", paddingLeft: 2 },
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
