import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius, shadow } from "../theme";
import { profilePath } from "../domain/urls.mjs";
import { suggestedPittersIntro, visibleSuggestedPitters } from "../domain/suggestedPitters.mjs";
import Avatar from "./Avatar";
import { PublicPressableLink } from "./PublicWebLinks";

export default function SuggestedPittersRail({
  accountId,
  enabled = true,
  homeCity,
  suggestions = [],
  loading = false,
  isFollowing,
  isBlocked,
  onFollow,
  onOpenProfile,
}) {
  const { width } = useWindowDimensions();
  const rows = visibleSuggestedPitters(suggestions, { isFollowing, isBlocked });
  const cardWidth = Math.min(176, Math.max(148, Math.round(width * 0.44)));

  if (!enabled || !accountId || (!loading && rows.length === 0)) return null;

  return (
    <View style={styles.section} accessibilityLabel="Suggested Pitters" testID="suggested-pitters">
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>WHO TO FOLLOW</Text>
          <Text style={styles.title}>Suggested Pitters</Text>
          <Text style={styles.subtitle}>{suggestedPittersIntro(homeCity)}</Text>
        </View>
      </View>

      {loading && rows.length === 0 ? (
        <View style={styles.loading} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.amberStrong} />
          <Text style={styles.loadingText}>Finding people for you...</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          directionalLockEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          snapToInterval={cardWidth + 10}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          contentContainerStyle={styles.cards}
          accessibilityLabel="People you may want to follow"
        >
          {rows.map((suggestion) => {
            const person = suggestion.user;
            const name = String(person.name || "").trim() || (person.handle ? "@" + person.handle : "Pitter");
            return (
              <View key={person.id} style={[styles.card, { width: cardWidth }]}>
                <PublicPressableLink
                  href={person.handle ? profilePath(person.handle) : null}
                  onNavigate={() => onOpenProfile?.(person.id)}
                  style={({ pressed, hovered, focused }) => [
                    styles.identity,
                    hovered && styles.identityHover,
                    pressed && styles.identityPressed,
                    focused && focusRing,
                  ]}
                  accessibilityLabel={"Open " + name + "'s profile"}
                >
                  <Avatar user={person} size={68} />
                  <Text style={styles.name} numberOfLines={1}>{name}</Text>
                  {person.handle ? <Text style={styles.handle} numberOfLines={1}>{"@" + person.handle}</Text> : null}
                  <Text style={styles.reason} numberOfLines={2}>{suggestion.reason || "A fan to follow"}</Text>
                </PublicPressableLink>
                <Pressable
                  style={({ pressed, focused }) => [
                    styles.follow,
                    pressed && styles.followPressed,
                    focused && focusRing,
                  ]}
                  onPress={() => onFollow?.(person.id)}
                  disabled={!onFollow}
                  accessibilityRole="button"
                  accessibilityLabel={"Follow " + name}
                  accessibilityHint="Adds this person to the people you follow"
                  accessibilityState={{ disabled: !onFollow }}
                >
                  <Text style={styles.followText}>Follow</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 14,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },
  heading: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 14, marginBottom: 12 },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.amber, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 18, lineHeight: 23, fontWeight: "900", marginTop: 3 },
  subtitle: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  loading: { minHeight: 112, alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 16 },
  loadingText: { color: colors.textDim, fontSize: 12 },
  cards: { gap: 10, paddingLeft: 12, paddingRight: 22, paddingBottom: 2 },
  card: {
    minHeight: 224,
    alignItems: "stretch",
    justifyContent: "space-between",
    padding: 12,
    backgroundColor: colors.bgElev,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    paddingHorizontal: 2,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  identityHover: { backgroundColor: colors.surfaceAlt },
  identityPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  name: { color: colors.text, fontFamily: displayFont, fontSize: 14, fontWeight: "900", marginTop: 9, textAlign: "center" },
  handle: { color: colors.textDim, fontSize: 11, marginTop: 2, textAlign: "center" },
  reason: { minHeight: 30, color: colors.textFaint, fontSize: 10.5, lineHeight: 15, marginTop: 7, textAlign: "center" },
  follow: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.amberStrong,
    borderWidth: 1,
    borderColor: colors.amber,
  },
  followPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  followText: { color: "#1A1206", fontFamily: displayFont, fontSize: 12, fontWeight: "900" },
});
