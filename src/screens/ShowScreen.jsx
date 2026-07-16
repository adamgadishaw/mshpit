import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { colors, displayFont, mono, radius, shadow } from "../theme";
import Stars from "../components/Stars";
import RatingSplit from "../components/RatingSplit";
import RatingBreakdown from "../components/RatingBreakdown";
import AfterpartySection from "../components/AfterpartySection";
import Icon from "../components/Icon";
import VenuePhotoWidget from "../components/VenuePhotoWidget";
import ScreenHeader from "../components/ScreenHeader";
import { useStore } from "../store";
import { showDateMs, fmtCountdown } from "../lib/showTime";

// The "performance page" - ONE artist, ONE venue, ONE date. This is the night
// itself, not the room (that's the venue page): a ticket-style hero owns the
// top, and the page runs in one of two modes. An UPCOMING night gets a live
// countdown, tickets, Going and the lounge; a night that happened gets the
// community score and the setlist. It must render for ANY event shape - a
// logged review, a bare tour date from the calendar, a lounge link - so every
// field is guarded; a tour date has no score and that's a mode, not a crash.
export default function ShowScreen({ log, onClose, onPreview, onReview, onOpenProfile, onOpenArtist, onOpenVenue, onOpenLounge, onRequireAuth }) {
  const { venueCoord, venuePhotos, session, concertKey, isGoing, toggleGoing, attendeesFor, loungeFor } = useStore();
  // Normalize the shapes this page can be handed: calendar/tour rows carry
  // `place` instead of `venue`, and often no city, score, or setlist.
  const venue = log.venue || log.place || "Venue TBA";
  const city = log.city || (log.place && log.venue ? log.place : "") || "";
  const artist = log.artist || "Unknown artist";
  const overall = typeof log.overall === "number" ? log.overall : null;
  const setlist = Array.isArray(log.setlist) ? log.setlist : [];
  const norm = { ...log, artist, venue, city };
  const coord = venueCoord(venue);
  const photos = venuePhotos(venue);
  const key = concertKey(norm);
  const going = isGoing(key);
  const attendees = attendeesFor(key);
  const loungeCount = loungeFor(key).length;

  // Upcoming vs happened decides the whole page. A show with no parseable date
  // but a score is treated as happened; no date and no score reads as upcoming.
  const targetMs = showDateMs(log.date);
  const upcoming = targetMs != null ? targetMs - Date.now() > -86400000 : overall == null;
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!upcoming || targetMs == null) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [upcoming, targetMs]);
  const msLeft = targetMs != null ? targetMs - nowTick : null;

  // Setlists are spoiler-gated while a show sits inside the artist's active tour
  // window: nobody wants the surprise ruined before their own night. Hidden by
  // default, one tap reveals.
  const [revealed, setRevealed] = useState(!log.inTourWindow);
  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker={upcoming ? "UPCOMING PERFORMANCE" : "PERFORMANCE"} title={artist} onBack={onClose} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Ticket-style hero: this is what makes a NIGHT read differently from
            a venue. Artist headline, then a perforated stub strip carrying the
            room + the date, like the ticket you'd have kept. */}
        <View style={styles.ticket}>
          <Text style={styles.ticketKicker}>{upcoming ? "ONE NIGHT · NOT YET PLAYED" : "ONE NIGHT ONLY"}</Text>
          <Pressable onPress={() => onOpenArtist?.(artist)}>
            <Text style={styles.artist}>{artist}</Text>
            <Text style={styles.artistLink}>View all {artist} nights ›</Text>
          </Pressable>
          <View style={styles.perfWrap}>
            <View style={[styles.notch, { left: -27 }]} />
            <View style={styles.dashed} />
            <View style={[styles.notch, { right: -27 }]} />
          </View>
          <View style={styles.stubRow}>
            <Pressable style={{ flex: 1 }} onPress={() => onOpenVenue?.(venue)}>
              <Text style={styles.stubLabel}>THE ROOM</Text>
              <Text style={styles.venueLink} numberOfLines={1}>{venue}</Text>
              {!!city && <Text style={styles.stubCity} numberOfLines={1}>{city}</Text>}
            </Pressable>
            <View style={styles.stubDivider} />
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.stubLabel}>THE DATE</Text>
              <Text style={styles.date}>{log.date || "TBA"}</Text>
              {log.soldOut ? <Text style={styles.soldOut}>SOLD OUT</Text> : null}
            </View>
          </View>
          {upcoming && msLeft != null && (
            <View style={styles.countdownStrip}>
              <Icon name="clock" size={14} color={colors.amber} />
              <Text style={styles.countdownTxt}>{msLeft <= 0 ? "TONIGHT" : fmtCountdown(msLeft)}</Text>
              {msLeft > 0 && <Text style={styles.countdownSub}>until doors</Text>}
            </View>
          )}
        </View>

        <Pressable style={{ marginTop: 16 }} onPress={() => onOpenVenue?.(venue)}>
          <VenuePhotoWidget photos={photos} venueName={venue} city={city} coord={coord} />
        </Pressable>

        {/* A night that happened gets its community score. An upcoming night
            gets tickets instead: never a fabricated 0.0. */}
        {!upcoming && overall != null && (
          <View style={styles.scoreCard}>
            <View style={{ alignItems: "center", marginBottom: 14 }}>
              <Text style={styles.bigScore}>{overall.toFixed(1)}</Text>
              <Stars value={overall} size={20} />
              <Text style={styles.scoreSub}>community score · {(log.likes || 0) + (log.comments || 0)} logged</Text>
            </View>
            {log.dims && Object.values(log.dims).some((v) => v > 0) ? <RatingBreakdown dims={log.dims} /> : <RatingSplit band={log.band || 0} room={log.room || 0} />}
            <Text style={styles.note}>
              Weighted across six factors - the band, the room, and the night. Room scores
              aggregate to {venue}, not the artist.
            </Text>
          </View>
        )}
        {!upcoming && overall == null && (
          <View style={styles.scoreCard}>
            <Text style={styles.noScoreTitle}>No score yet</Text>
            <Text style={styles.note}>Nobody has logged this night. Were you there? Yours would be the first review.</Text>
          </View>
        )}
        {upcoming && log.ticketUrl ? (
          <Pressable style={styles.ticketsBtn} onPress={() => Linking.openURL(log.ticketUrl)} accessibilityRole="button" accessibilityLabel="Get tickets">
            <Icon name="star" size={15} color="#1A1206" />
            <Text style={styles.ticketsTxt}>Get tickets</Text>
          </Pressable>
        ) : null}

        {/* going + the concert lounge */}
        <View style={styles.socialRow}>
          <Pressable style={[styles.goingBtn, going && styles.goingOn]} onPress={() => (session ? toggleGoing(norm) : onRequireAuth?.())}>
            <Icon name={going ? "check" : "calendar"} size={16} color={going ? "#1A1206" : colors.amber} />
            <Text style={[styles.goingTxt, going && { color: "#1A1206" }]}>{going ? "Going" : "I'm going"}</Text>
          </Pressable>
          <Pressable style={styles.loungeBtn} onPress={() => onOpenLounge?.(norm)}>
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

        {/* review-in-post: log/review this exact show. Only a night that has
            actually happened can be reviewed. */}
        {!upcoming && (
          <Pressable style={styles.reviewCta} onPress={() => onReview?.(norm)}>
            <Icon name="star" size={16} color="#1A1206" />
            <Text style={styles.reviewCtaTxt}>Log / review this show</Text>
          </Pressable>
        )}

        {!!log.review && (
          <>
            <Text style={styles.sectionLabel}>TOP REVIEW</Text>
            <View style={styles.reviewCard}>
              <Text style={styles.review}>{log.review}</Text>
              <Pressable onPress={log.userId ? () => onOpenProfile?.(log.userId) : undefined}>
                <Text style={styles.byline}>- {log.user?.name || "a fan"}</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* jump to the artist or the venue from the concert */}
        <View style={styles.seeRow}>
          <Pressable style={styles.seeBtn} onPress={() => onOpenArtist?.(artist)}>
            <Icon name="music" size={16} color={colors.amber} />
            <Text style={styles.seeTxt}>See this artist</Text>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
          <Pressable style={styles.seeBtn} onPress={() => onOpenVenue?.(venue)}>
            <Icon name="pin" size={16} color={colors.amber} />
            <Text style={styles.seeTxt}>See this venue</Text>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        </View>

        {/* the Afterparty: like, what's still open nearby, and the discussion */}
        <View style={styles.afterCard}>
          <AfterpartySection log={norm} coord={coord} onOpenProfile={onOpenProfile} onRequireAuth={onRequireAuth} />
        </View>

        {setlist.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>SETLIST · {setlist.length} SONGS</Text>
            {revealed ? (
              <View style={styles.reviewCard}>
                {setlist.map((s, i) => (
                  <View key={i} style={styles.songRow}>
                    <Text style={styles.songNum}>{String(i + 1).padStart(2, "0")}</Text>
                    <Text style={styles.song}>{s}</Text>
                    <Pressable style={styles.previewBtn} hitSlop={8} onPress={() => onPreview?.(s, artist)}>
                      <Icon name="play" size={12} color={colors.amber} />
                    </Pressable>
                  </View>
                ))}
                <Text style={styles.previewHint}>Tap a song for a licensed 30s preview.</Text>
              </View>
            ) : (
              <Pressable style={styles.spoiler} onPress={() => setRevealed(true)}>
                <Icon name="lock" size={18} color={colors.amber} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.spoilerTitle}>Setlist hidden</Text>
                  <Text style={styles.spoilerSub}>This tour is still running, tap to reveal (spoiler).</Text>
                </View>
                <Text style={styles.spoilerCta}>Reveal</Text>
              </Pressable>
            )}
          </>
        )}
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
  spoiler: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, borderStyle: "dashed", paddingHorizontal: 16, paddingVertical: 16, marginTop: 8 },
  spoilerTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  spoilerSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  spoilerCta: { color: colors.amber, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  // Ticket hero: the performance page's own identity. Amber left edge like a
  // torn stub, perforation between the headline and the room/date strip.
  ticket: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, borderLeftWidth: 4, borderLeftColor: colors.amber, paddingHorizontal: 18, paddingVertical: 16, ...shadow.card },
  ticketKicker: { color: colors.amber, fontFamily: mono, fontSize: 10, letterSpacing: 2, fontWeight: "800", marginBottom: 6 },
  perfWrap: { flexDirection: "row", alignItems: "center", height: 16, marginVertical: 12 },
  dashed: { flex: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.line },
  notch: { position: "absolute", width: 16, height: 16, borderRadius: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.lineSoft },
  stubRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  stubLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9, letterSpacing: 1.5, fontWeight: "800", marginBottom: 3 },
  stubCity: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  stubDivider: { width: 1, height: 34, backgroundColor: colors.line },
  soldOut: { color: colors.danger, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginTop: 3 },
  countdownStrip: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, backgroundColor: colors.bgElev, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 12, paddingVertical: 9 },
  countdownTxt: { color: colors.amber, fontFamily: mono, fontSize: 16, fontWeight: "900", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  countdownSub: { color: colors.textFaint, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  ticketsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, marginTop: 16 },
  ticketsTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  noScoreTitle: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "800" },

  artist: { color: colors.text, fontFamily: displayFont, fontSize: 30, fontWeight: "900", letterSpacing: -0.5 },
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
