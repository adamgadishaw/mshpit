import { View, Text, StyleSheet, ScrollView, Pressable, Image } from "react-native";
import { colors, mono, radius, shadow, space } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import { artistMeta } from "../seed/ingested";

// First-run "get the full experience" nudge, shown once after signup (and on login
// for people who still have no friends / haven't connected Spotify). Two jobs:
// 1) prompt Spotify Connect so music actually plays, and 2) give a friendless new
// user somewhere to GO on day one — fan clubs for the artists they love and the
// pre-show / afterparty of a gig near them — so the empty-social-network problem
// (log in, know nobody, leave) has an answer.
export default function WelcomeScreen({ onClose, onOpenFanClub, onOpenShow, onOpenFanClubs, onOpenNearby }) {
  const { session, followingCount, isFanClubMember, joinFanClub, recommendedShows, chartTop } = useStore();
  const name = (session?.name || "").split(" ")[0] || "there";
  const noFriends = session ? followingCount(session.id) === 0 : true;

  // Fan clubs to suggest: the artists they picked, else the biggest names.
  const picks = (session?.favoriteArtists || []).slice(0, 6);
  const suggested = (picks.length ? picks.map((n) => ({ name: n })) : chartTop(6).map((a) => ({ name: a.name })));
  const photoFor = (n) => artistMeta(n)?.photo || null;

  // A couple of gigs near them, where the pre-show + afterparty are the icebreaker.
  const shows = (recommendedShows?.(200) || []).slice(0, 3);

  // joinFanClub updates store state, which re-renders this (a useStore consumer).
  const join = (artist) => joinFanClub(artist);

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>WELCOME TO MSHPIT</Text>
          <Text style={styles.title}>You're in, {name}.</Text>
          <Text style={styles.sub}>
            MSHpit is the social network for live music: remember the shows you attend,
            share what the night felt like, and find your next one through other fans.
          </Text>
        </View>

        <View style={[styles.card, styles.journeyCard]}>
          <View style={styles.cardHead}>
            <View style={[styles.badge, { borderColor: colors.magenta }]}><Icon name="ticket" size={18} color={colors.magenta} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>How MSHpit works</Text>
              <Text style={styles.cardSub}>Start anywhere. You do not need to fill out everything before exploring.</Text>
            </View>
          </View>
          <JourneyStep number="1" title="Find a show" detail="Browse upcoming concerts, festivals, artists, and venues." />
          <JourneyStep number="2" title="Attend and log it" detail="A quick log can be just a rating, a photo, and whether you'd go again." />
          <JourneyStep number="3" title="Share the night" detail="Your review and media join that exact show's fan archive." />
          <JourneyStep number="4" title="Find your people" detail="Follow fans with similar taste and discover what to see next." />
        </View>

        {/* Find your people */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.badge, { borderColor: colors.amber }]}><Icon name="you" size={18} color={colors.amber} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{noFriends ? "Find your people" : "Meet more fans"}</Text>
              <Text style={styles.cardSub}>New here and don't know anyone yet? Jump into a fan club, or the pre-show and afterparty of a gig near you. That's where the friends are.</Text>
            </View>
          </View>

          <Text style={styles.groupLabel}>FAN CLUBS FOR YOUR ARTISTS</Text>
          {suggested.map((a) => {
            const member = isFanClubMember(a.name);
            const photo = photoFor(a.name);
            return (
              <View key={a.name} style={styles.row}>
                {photo ? <Image source={{ uri: photo }} style={styles.rowImg} /> : <View style={[styles.rowImg, styles.rowImgEmpty]}><Text style={styles.rowInitials}>{a.name.slice(0, 2).toUpperCase()}</Text></View>}
                <Pressable style={{ flex: 1 }} onPress={() => onOpenFanClub?.(a.name)}>
                  <Text style={styles.rowName} numberOfLines={1}>{a.name}</Text>
                  <Text style={styles.rowSub}>Fan club</Text>
                </Pressable>
                <Pressable style={[styles.joinBtn, member && styles.joinedBtn]} onPress={() => (member ? onOpenFanClub?.(a.name) : join(a.name))}>
                  <Text style={[styles.joinTxt, member && styles.joinedTxt]}>{member ? "Open" : "Join"}</Text>
                </Pressable>
              </View>
            );
          })}

          {shows.length > 0 && <Text style={[styles.groupLabel, { marginTop: 16 }]}>SHOWS NEAR YOU</Text>}
          {shows.map((s, i) => (
            <Pressable key={s.id || i} style={styles.row} onPress={() => onOpenShow?.(s)}>
              <View style={[styles.rowImg, styles.rowImgEmpty]}><Icon name="ticket" size={18} color={colors.magenta} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{s.artist}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{s.venue}{s.city ? " · " + s.city : ""}</Text>
              </View>
              <View style={styles.joinBtn}><Text style={styles.joinTxt}>Pre-show</Text></View>
            </Pressable>
          ))}

          <Pressable style={styles.linkRow} onPress={onOpenFanClubs}>
            <Text style={styles.linkTxt}>Browse all fan clubs</Text>
            <Icon name="chevron-right" size={15} color={colors.amber} />
          </Pressable>
        </View>

        <Pressable style={styles.skip} onPress={onClose}>
          <Text style={styles.skipTxt}>Explore on my own</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function JourneyStep({ number, title, detail }) {
  return (
    <View style={styles.journeyStep}>
      <View style={styles.journeyNumber}><Text style={styles.journeyNumberText}>{number}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.journeyTitle}>{title}</Text>
        <Text style={styles.journeyDetail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  hero: { paddingVertical: 18 },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 11, letterSpacing: 3, fontWeight: "800" },
  title: { color: colors.text, fontSize: 26, fontWeight: "900", marginTop: 8, letterSpacing: -0.5 },
  sub: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginTop: 6 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 14, ...shadow.card },
  journeyCard: { borderColor: colors.magenta },
  cardSpotify: { borderColor: colors.good, backgroundColor: "rgba(111,207,151,0.06)" },
  cardHead: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  badge: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  cardSub: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 3 },
  journeyStep: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginTop: 14 },
  journeyNumber: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, alignItems: "center", justifyContent: "center" },
  journeyNumberText: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "900" },
  journeyTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  journeyDetail: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, paddingVertical: 13, marginTop: 14 },
  primaryTxt: { color: "#08120D", fontSize: 15, fontWeight: "800" },
  groupLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 10, letterSpacing: 1.4, fontWeight: "800", marginTop: 14, marginBottom: space(2) },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7 },
  rowImg: { width: 42, height: 42, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  rowImgEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  rowInitials: { color: colors.amber, fontFamily: mono, fontSize: 14, fontWeight: "800" },
  rowName: { color: colors.text, fontSize: 14.5, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  joinBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  joinTxt: { color: "#1A1206", fontSize: 13, fontWeight: "800" },
  joinedBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  joinedTxt: { color: colors.text },
  linkRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 14, paddingVertical: 6 },
  linkTxt: { color: colors.amber, fontSize: 14, fontWeight: "700" },
  skip: { alignItems: "center", paddingVertical: 14 },
  skipTxt: { color: colors.textDim, fontSize: 14, fontWeight: "600" },
});
