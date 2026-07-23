import { useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, Image } from "react-native";
import { colors, mono, radius, space } from "../theme";
import { useStore } from "../store";
import Stars from "../components/Stars";
import Icon from "../components/Icon";
import VenuePhotoWidget from "../components/VenuePhotoWidget";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import MentionText from "../components/MentionText";
import { formatDate } from "../domain/dates.mjs";

// Venue page - the room's reputation. Sound, views and crowd live with the
// building, so they aggregate here rather than dragging down the touring band.
export default function VenueScreen({ venueName, onClose, onOpenShow, onOpenArtist, onOpenVenue, onReviewVenue, onOpenProfile, onOpenPhotos }) {
  const { venueSummary, venueCoord, venueReviewsFor, loadVenueReviews, venueRating, venueTopPhotos, venuePhotos, userByHandle } = useStore();
  const v = venueSummary(venueName);
  const coord = venueCoord(v.name);
  const photos = venuePhotos(v.name);
  const reviews = venueReviewsFor(v.name);
  // Slice 7: pull this venue's reviews from the server on open.
  useEffect(() => { loadVenueReviews(v.name); }, [v.name]);
  const userRating = venueRating(v.name);
  const gridPhotos = venueTopPhotos(v.name, 20);
  const onMention = (h) => { const u = userByHandle(h); if (u) onOpenProfile?.(u.id); };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="VENUE" title={v.name} onBack={onClose} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.venue}>{v.name}</Text>
        <View style={styles.metaRow}>
          <Icon name="pin" size={14} color={colors.textDim} />
          <Text style={styles.place}>{v.place || "-"}</Text>
        </View>
        {v.capacity ? <Text style={styles.cap}>Capacity ~{v.capacity.toLocaleString()}</Text> : null}

        <View style={{ marginTop: 16 }}>
          <VenuePhotoWidget photos={photos} venueName={v.name} city={v.place} coord={coord} />
        </View>

        <View style={styles.repCard}>
          <Text style={styles.repLabel}>ROOM REPUTATION</Text>
          <View style={styles.repRow}>
            <Text style={styles.bigScore}>{v.avgRoom ? v.avgRoom.toFixed(1) : "-"}</Text>
            <View style={{ flex: 1 }}>
              <Stars value={v.avgRoom} size={18} color={colors.cool} />
              <Text style={styles.repSub}>{v.totalShows} show{v.totalShows === 1 ? "" : "s"} here · sound, views & crowd</Text>
            </View>
          </View>
          <Text style={styles.note}>The room's own score - independent of who's playing.</Text>
        </View>

        {/* fan venue reviews - rating + photos */}
        <View style={styles.fanRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fanLabel}>FAN REVIEWS · {reviews.length}</Text>
            {userRating > 0 && (
              <View style={styles.fanRating}>
                <Stars value={userRating} size={14} color={colors.gold} />
                <Text style={styles.fanRatingTxt}>{userRating.toFixed(1)}</Text>
              </View>
            )}
          </View>
          <Pressable style={styles.writeBtn} onPress={() => onReviewVenue?.(v.name)}>
            <Icon name="edit" size={14} color="#1A1206" />
            <Text style={styles.writeTxt}>Write a review</Text>
          </Pressable>
        </View>

        {gridPhotos.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>FAN PHOTOS · {gridPhotos.length}</Text>
            <View style={styles.grid}>
              {gridPhotos.map((p, i) => (
                <Pressable key={i} style={styles.gridTile} onPress={() => onOpenPhotos?.(gridPhotos, i)}>
                  <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                </Pressable>
              ))}
            </View>
          </>
        )}

        {reviews.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>REVIEWS</Text>
            {reviews.map((r) => (
              <View key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewHead}>
                  <Avatar user={{ initials: r.initials, name: r.name }} size={30} onPress={() => onOpenProfile?.(r.userId)} />
                  <Text style={styles.reviewName}>{r.name}</Text>
                  <View style={styles.scorePill}>
                    <Icon name="star" size={10} color={colors.gold} />
                    <Text style={styles.scoreTxt}>{r.rating.toFixed(1)}</Text>
                  </View>
                </View>
                {!!r.text && <MentionText text={r.text} style={styles.reviewText} onMention={onMention} />}
                {r.photos?.length > 0 && (
                  <View style={styles.reviewPhotos}>
                    {r.photos.map((uri, i) => (
                      <Image key={i} source={{ uri }} style={styles.reviewPhoto} resizeMode="cover" />
                    ))}
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        {v.upcoming.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>UPCOMING HERE · {v.upcoming.length}</Text>
            {v.upcoming.map((t) => (
              <View key={t.id} style={styles.upRow}>
                <Pressable style={{ flex: 1 }} onPress={() => onOpenArtist?.(t.artist)}>
                  <Text style={styles.upArtist}>{t.artist}</Text>
                  <Text style={styles.upDate}>{formatDate(t.date, t.date)}{t.scheduled ? "  · scheduled" : ""}</Text>
                </Pressable>
                {t.soldOut ? (
                  <View style={styles.soldOut}><Text style={styles.soldOutTxt}>SOLD OUT</Text></View>
                ) : (
                  <Pressable style={styles.ticketBtn} onPress={() => Linking.openURL(t.ticketUrl)}>
                    <Icon name="ticket" size={14} color="#1A1206" />
                    <Text style={styles.ticketTxt}>Tickets</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>SHOWS HERE · {v.nights.length}</Text>
        {v.nights.length === 0 && <Text style={styles.empty}>No shows logged here yet.</Text>}
        {v.nights.map((n) => (
          <Pressable key={n.id} style={styles.nightRow} onPress={() => onOpenShow?.(n)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.nightArtist}>{n.artist}</Text>
              <Text style={styles.nightMeta}>{n.date !== "aggregate" ? n.date : "community avg"}</Text>
            </View>
            <View style={styles.scorePill}>
              <Icon name="star" size={11} color={colors.gold} />
              <Text style={styles.scoreTxt}>{n.overall.toFixed(1)}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { flexDirection: "row", alignItems: "center", width: 56 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48 },
  fanRow: { flexDirection: "row", alignItems: "center", marginTop: 16, gap: 12 },
  fanLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700" },
  fanRating: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  fanRatingTxt: { color: colors.gold, fontFamily: mono, fontSize: 14, fontWeight: "700" },
  writeBtn: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 9 },
  writeTxt: { color: "#1A1206", fontSize: 13, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  gridTile: { width: "31.8%", aspectRatio: 1, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.lineSoft },
  reviewCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 10 },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  reviewName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700" },
  reviewText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  reviewPhotos: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  reviewPhoto: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderColor: colors.line },
  banner: { height: 130, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft },
  bannerImg: { width: "100%", height: "100%" },
  bannerFallback: { flex: 1, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", gap: 6 },
  bannerInitial: { color: colors.text, fontSize: 30, fontWeight: "900", fontFamily: mono, opacity: 0.5 },
  venue: { color: colors.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.5, marginTop: 16 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  place: { color: colors.textDim, fontSize: 14 },
  cap: { color: colors.textFaint, fontFamily: mono, fontSize: 12, marginTop: 6 },

  repCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 18, marginTop: 20 },
  repLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 12 },
  repRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  bigScore: { color: colors.cool, fontFamily: mono, fontSize: 44, fontWeight: "800", lineHeight: 46 },
  repSub: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 17, marginTop: 12, fontStyle: "italic" },

  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: space(6), marginBottom: space(2) },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },

  upRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8, gap: 12 },
  upArtist: { color: colors.text, fontSize: 15, fontWeight: "700" },
  upDate: { color: colors.amber, fontFamily: mono, fontSize: 12, marginTop: 6 },
  ticketBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9 },
  ticketTxt: { color: "#1A1206", fontSize: 13, fontWeight: "800" },
  soldOut: { borderWidth: 1, borderColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  soldOutTxt: { color: colors.danger, fontSize: 11, fontWeight: "800", letterSpacing: 1 },

  nightRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  nightArtist: { color: colors.text, fontSize: 15, fontWeight: "700" },
  nightMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  scorePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  scoreTxt: { color: colors.gold, fontFamily: mono, fontSize: 14, fontWeight: "700" },
});
