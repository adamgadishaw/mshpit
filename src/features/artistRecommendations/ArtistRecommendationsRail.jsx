import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Avatar from "../../components/Avatar";
import Icon from "../../components/Icon";
import SmartImage from "../../components/SmartImage";
import { formatDate } from "../../domain/dates.mjs";
import { colors, displayFont, focusRing, mono, radius, shadow } from "../../theme";

function ArtistPhoto({ artist, priority = "normal" }) {
  return (
    <View style={styles.photoFrame}>
      {artist.photo ? (
        <SmartImage
          uri={artist.photo}
          style={styles.photo}
          contain={false}
          previewWidth={192}
          priority={priority}
          loading={priority === "high" ? "eager" : "lazy"}
          accessible={false}
        />
      ) : (
        <View style={styles.photoFallback}>
          <Icon name="music" size={32} color={colors.amber} />
        </View>
      )}
    </View>
  );
}

function SocialProof({ proof, onOpenProfile }) {
  if (!proof?.count || !proof.label) return null;
  return (
    <View style={styles.social} accessibilityLabel={`${proof.label}. Based on public concert reviews.`}>
      <View style={styles.people}>
        {proof.people.map((person, index) => (
          <View key={person.id} style={[styles.person, index > 0 && styles.personOverlap]}>
            <Avatar user={person} size={26} onPress={() => onOpenProfile?.(person.id)} />
          </View>
        ))}
      </View>
      <Text style={styles.socialLabel} numberOfLines={2}>{proof.label}</Text>
    </View>
  );
}

function RecommendationCard({ recommendation, index, width, onOpenArtist, onOpenProfile }) {
  const { artist, nextDate, reason } = recommendation;
  const rating = recommendation.reviewCount > 0 && recommendation.liveRating
    ? `${recommendation.liveRating.toFixed(1)} ★ · ${recommendation.reviewCount} fan review${recommendation.reviewCount === 1 ? "" : "s"}`
    : null;
  const nextDateLine = nextDate
    ? [formatDate(nextDate.date, nextDate.date), nextDate.venue, nextDate.city].filter(Boolean).join(" · ")
    : null;
  return (
    <View style={[styles.card, { width }]}>
      <Pressable
        style={({ pressed, focused }) => [styles.artistButton, pressed && styles.pressed, focused && focusRing]}
        onPress={() => onOpenArtist?.(artist)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${artist.name}. ${reason.label}${nextDateLine ? `. Upcoming ${nextDateLine}` : ""}`}
      >
        <ArtistPhoto artist={artist} priority={index === 0 ? "high" : "normal"} />
        <Text style={styles.artistName} numberOfLines={1}>{artist.name}</Text>
        <Text style={styles.artistMeta} numberOfLines={1}>{[artist.genre, rating].filter(Boolean).join(" · ") || "Live artist"}</Text>
      </Pressable>

      <View style={styles.reasonBubble}>
        <View style={styles.reasonTitleRow}>
          <Icon name="star" size={12} color={colors.amber} />
          <Text style={styles.reasonTitle}>WHY THIS ARTIST</Text>
        </View>
        <Text style={styles.reasonText} numberOfLines={3}>{reason.label}</Text>
      </View>

      {nextDateLine ? (
        <View style={styles.upcoming}>
          <Icon name="calendar" size={15} color={colors.cool} />
          <View style={styles.upcomingCopy}>
            <Text style={styles.upcomingLabel}>NEXT SHOW</Text>
            <Text style={styles.upcomingText} numberOfLines={2}>{nextDateLine}</Text>
          </View>
        </View>
      ) : null}

      <SocialProof proof={recommendation.socialProof} onOpenProfile={onOpenProfile} />
    </View>
  );
}

export default function ArtistRecommendationsRail({
  resource,
  onOpenArtist,
  onOpenProfile,
  onManageTaste,
  onRetry,
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const cardWidth = Math.min(244, Math.max(206, Math.round(viewportWidth * 0.66)));
  const rows = Array.isArray(resource?.data?.recommendations) ? resource.data.recommendations : [];
  const initialLoading = ["idle", "loading"].includes(resource?.status) && resource?.updatedAt == null;
  const initialError = resource?.status === "error" && resource?.updatedAt == null;

  return (
    <View style={styles.section} testID="artist-recommendations" accessibilityLabel="Artists we think you will like">
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>FOR YOUR NEXT SHOW</Text>
          <Text style={styles.title}>Artists we think you’ll like</Text>
          <Text style={styles.subtitle}>Based on the artists, shows, posts, and genres you’ve chosen on Mshpit.</Text>
        </View>
        <View style={styles.algorithmBadge} accessibilityLabel="Personalized from your music activity">
          <Icon name="star" size={13} color={colors.amber} />
        </View>
      </View>

      {initialLoading ? (
        <View style={styles.loading} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.amberStrong} />
          <Text style={styles.loadingText}>Finding artists that match your taste…</Text>
        </View>
      ) : initialError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>We couldn’t load your artist picks.</Text>
          <Pressable style={({ focused }) => [styles.smallAction, focused && focusRing]} onPress={onRetry} accessibilityRole="button">
            <Text style={styles.smallActionText}>Try again</Text>
          </Pressable>
        </View>
      ) : rows.length ? (
        <ScrollView
          horizontal
          directionalLockEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          snapToInterval={cardWidth + 12}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          contentContainerStyle={styles.cards}
          accessibilityLabel="Recommended artists"
        >
          {rows.map((recommendation, index) => (
            <RecommendationCard
              key={recommendation.artist.key}
              recommendation={recommendation}
              index={index}
              width={cardWidth}
              onOpenArtist={onOpenArtist}
              onOpenProfile={onOpenProfile}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Give us a little more of your taste.</Text>
          <Text style={styles.emptyText}>Choose favourite artists or genres, or log a show. We won’t make up recommendations without real signals from you.</Text>
          <Pressable style={({ focused }) => [styles.smallAction, focused && focusRing]} onPress={onManageTaste} accessibilityRole="button">
            <Text style={styles.smallActionText}>Tune your music picks</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 14, paddingVertical: 15, backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, overflow: "hidden", ...shadow.card },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 15, paddingBottom: 13 },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.amber, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 20, lineHeight: 25, fontWeight: "900", marginTop: 3 },
  subtitle: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  algorithmBadge: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.lineSoft },
  cards: { gap: 12, paddingLeft: 14, paddingRight: 26, paddingBottom: 2 },
  card: { minHeight: 346, padding: 13, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  artistButton: { alignItems: "center", borderRadius: radius.sm, padding: 2 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
  photoFrame: { width: 86, height: 86, borderRadius: 43, overflow: "hidden", borderWidth: 2, borderColor: colors.amber, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  photo: { width: 82, height: 82, borderRadius: 41 },
  photoFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  artistName: { color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "900", textAlign: "center", marginTop: 9 },
  artistMeta: { color: colors.textDim, fontSize: 10.5, lineHeight: 15, textAlign: "center", marginTop: 3 },
  reasonBubble: { marginTop: 12, padding: 10, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.lineSoft },
  reasonTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  reasonTitle: { color: colors.amber, fontFamily: mono, fontSize: 7.5, fontWeight: "900", letterSpacing: 1.2 },
  reasonText: { color: colors.text, fontSize: 11, lineHeight: 16, fontWeight: "700", marginTop: 5 },
  upcoming: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  upcomingCopy: { flex: 1, minWidth: 0 },
  upcomingLabel: { color: colors.cool, fontFamily: mono, fontSize: 7.5, fontWeight: "900", letterSpacing: 1.1 },
  upcomingText: { color: colors.text, fontSize: 10.5, lineHeight: 15, fontWeight: "700", marginTop: 2 },
  social: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  people: { flexDirection: "row", alignItems: "center", paddingLeft: 1 },
  person: { borderRadius: 15, borderWidth: 2, borderColor: colors.bgElev },
  personOverlap: { marginLeft: -8 },
  socialLabel: { flex: 1, minWidth: 0, color: colors.textDim, fontSize: 9.5, lineHeight: 13 },
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 18 },
  loadingText: { color: colors.textDim, fontSize: 12, textAlign: "center" },
  empty: { marginHorizontal: 14, padding: 14, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev, alignItems: "flex-start" },
  emptyTitle: { color: colors.text, fontFamily: displayFont, fontSize: 14, fontWeight: "900" },
  emptyText: { color: colors.textDim, fontSize: 11.5, lineHeight: 17, marginTop: 5 },
  smallAction: { minHeight: 42, justifyContent: "center", marginTop: 11, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  smallActionText: { color: "#1A1206", fontSize: 11, fontWeight: "900" },
});
