import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import Stars from "../components/Stars";
import RatingSplit from "../components/RatingSplit";
import RatingBreakdown from "../components/RatingBreakdown";
import AfterpartySection from "../components/AfterpartySection";
import Icon from "../components/Icon";
import VenuePhotoWidget from "../components/VenuePhotoWidget";
import ScreenHeader from "../components/ScreenHeader";
import { useStore } from "../store";

// The "performance page" - one artist, one venue, one date. Aggregates the
// community score and the band/room breakdown for this specific night.
export default function ShowScreen({ log, onClose, onPreview, onReview, onOpenProfile, onOpenArtist, onOpenVenue, onOpenLounge, onRequireAuth }) {
  const { venueCoord, venuePhotos, session, concertKey, isGoing, toggleGoing, attendeesFor, loungeFor } = useStore();
  const coord = venueCoord(log.venue);
  const photos = venuePhotos(log.venue);
  const key = concertKey(log);
  const going = isGoing(key);
  const attendees = attendeesFor(key);
  const loungeCount = loungeFor(key).length;
  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="PERFORMANCE" title={log.artist} onBack={onClose} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => onOpenArtist?.(log.artist)}>
          <Text style={styles.artist}>{log.artist}</Text>
          <Text style={styles.artistLink}>View all {log.artist} nights ›</Text>
        </Pressable>
        <Pressable onPress={() => onOpenVenue?.(log.venue)}>
          <Text style={styles.venue}><Text style={styles.venueLink}>{log.venue}</Text> · {log.city}</Text>
        </Pressable>
        <Text style={styles.date}>{log.date}</Text>

        <Pressable style={{ marginTop: 16 }} onPress={() => onOpenVenue?.(log.venue)}>
          <VenuePhotoWidget photos={photos} venueName={log.venue} city={log.city} coord={coord} />
        </Pressable>

        <View style={styles.scoreCard}>
          <View style={{ alignItems: "center", marginBottom: 14 }}>
            <Text style={styles.bigScore}>{log.overall.toFixed(1)}</Text>
            <Stars value={log.overall} size={20} />
            <Text style={styles.scoreSub}>community score · {log.likes + log.comments} logged</Text>
          </View>
          {log.dims ? <RatingBreakdown dims={log.dims} /> : <RatingSplit band={log.band} room={log.room} />}
          <Text style={styles.note}>
            Weighted across six factors - the band, the room, and the night. Room scores
            aggregate to {log.venue}, not the artist.
          </Text>
        </View>

        {/* going + the concert lounge */}
        <View style={styles.socialRow}>
          <Pressable style={[styles.goingBtn, going && styles.goingOn]} onPress={() => (session ? toggleGoing(log) : onRequireAuth?.())}>
            <Icon name={going ? "check" : "calendar"} size={16} color={going ? "#1A1206" : colors.amber} />
            <Text style={[styles.goingTxt, going && { color: "#1A1206" }]}>{going ? "Going" : "I'm going"}</Text>
          </Pressable>
          <Pressable style={styles.loungeBtn} onPress={() => onOpenLounge?.(log)}>
            <Icon name="comment" size={16} color={colors.amber} />
            <Text style={styles.loungeTxt}>Lounge</Text>
            <View style={styles.loungeCount}><Text style={styles.loungeCountTxt}>{loungeCount}</Text></View>
          </Pressable>
        </View>
        {attendees.length > 0 && (
          <Text style={styles.attendees}>
            {attendees.length} going · {attendees.slice(0, 3).map((u) => u.name).join(", ")}{attendees.length > 3 ? " +more" : ""}
          </Text>
        )}

        {/* review-in-post: log/review this exact show */}
        <Pressable style={styles.reviewCta} onPress={() => onReview?.(log)}>
          <Icon name="star" size={16} color="#1A1206" />
          <Text style={styles.reviewCtaTxt}>Log / review this show</Text>
        </Pressable>

        {!!log.review && (
          <>
            <Text style={styles.sectionLabel}>TOP REVIEW</Text>
            <View style={styles.reviewCard}>
              <Text style={styles.review}>{log.review}</Text>
              <Pressable onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined}>
                <Text style={styles.byline}>— {log.user?.name || "a fan"}</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* jump to the artist or the venue from the concert */}
        <View style={styles.seeRow}>
          <Pressable style={styles.seeBtn} onPress={() => onOpenArtist?.(log.artist)}>
            <Icon name="music" size={16} color={colors.amber} />
            <Text style={styles.seeTxt}>See this artist</Text>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
          <Pressable style={styles.seeBtn} onPress={() => onOpenVenue?.(log.venue)}>
            <Icon name="pin" size={16} color={colors.amber} />
            <Text style={styles.seeTxt}>See this venue</Text>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        </View>

        {/* the Afterparty: like, what's still open nearby, and the discussion */}
        <View style={styles.afterCard}>
          <AfterpartySection log={log} coord={coord} onOpenProfile={onOpenProfile} onRequireAuth={onRequireAuth} />
        </View>

        <Text style={styles.sectionLabel}>SETLIST · {log.setlist.length} SONGS</Text>
        <View style={styles.reviewCard}>
          {log.setlist.map((s, i) => (
            <View key={i} style={styles.songRow}>
              <Text style={styles.songNum}>{String(i + 1).padStart(2, "0")}</Text>
              <Text style={styles.song}>{s}</Text>
              <Pressable style={styles.previewBtn} hitSlop={8} onPress={() => onPreview?.(s, log.artist)}>
                <Icon name="play" size={12} color={colors.amber} />
              </Pressable>
            </View>
          ))}
          <Text style={styles.previewHint}>Tap a song for a licensed 30s preview.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: { flexDirection: "row", alignItems: "center", width: 56 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48 },
  socialRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  goingBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev, paddingVertical: 14 },
  goingOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  goingTxt: { color: colors.amber, fontSize: 14, fontWeight: "800" },
  loungeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingVertical: 14 },
  loungeTxt: { color: colors.text, fontSize: 14, fontWeight: "700" },
  loungeCount: { backgroundColor: colors.amber, borderRadius: 999, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: "center" },
  loungeCountTxt: { color: "#1A1206", fontSize: 11, fontWeight: "800", fontFamily: mono },
  attendees: { color: colors.textDim, fontSize: 12, marginTop: 10, textAlign: "center" },
  reviewCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, marginTop: 16 },
  reviewCtaTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  artist: { color: colors.text, fontSize: 30, fontWeight: "900", letterSpacing: -0.5 },
  artistLink: { color: colors.amber, fontSize: 12, marginTop: 4, fontWeight: "600" },
  seeRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  seeBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 13 },
  seeTxt: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "700" },
  afterCard: { backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 16, marginTop: 24 },
  venueLink: { color: colors.text, fontWeight: "700" },
  venue: { color: colors.textDim, fontSize: 15, marginTop: 4 },
  date: { color: colors.amber, fontFamily: mono, fontSize: 13, marginTop: 6, letterSpacing: 1 },

  scoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    padding: 18,
    marginTop: 20,
  },
  bigScore: { color: colors.gold, fontFamily: mono, fontSize: 44, fontWeight: "800", lineHeight: 48 },
  scoreSub: { color: colors.textFaint, fontSize: 12, marginTop: 8 },
  note: { color: colors.textFaint, fontSize: 12, marginTop: 14, lineHeight: 17, fontStyle: "italic" },

  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 24, marginBottom: 8 },
  reviewCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    padding: 16,
  },
  review: { color: colors.text, fontSize: 15, lineHeight: 22 },
  byline: { color: colors.textDim, fontSize: 13, marginTop: 12 },
  songRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  song: { color: colors.text, fontSize: 14, flex: 1 },
  songNum: { color: colors.textFaint, fontFamily: mono, fontSize: 12, width: 28 },
  previewBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
  previewHint: { color: colors.textFaint, fontSize: 11, marginTop: 10, fontStyle: "italic" },
});
