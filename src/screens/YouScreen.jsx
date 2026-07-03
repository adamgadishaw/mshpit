import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import { useStore, isStaff, isArtist } from "../store";

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({ icon, label, sub, onPress, danger }) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <View style={styles.actionIcon}>
        <Icon name={icon} size={18} color={danger ? colors.danger : colors.amber} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!sub && <Text style={styles.actionSub}>{sub}</Text>}
      </View>
      {!danger && <Icon name="chevron-right" size={18} color={colors.textDim} />}
    </Pressable>
  );
}

export default function YouScreen({ feed, onLogin, onLogout, onAdmin, onAddTourDate, onRequestArtist, onEditProfile, onOpenProfile, onOpen }) {
  const { session, logsByUser } = useStore();
  const mine = session ? logsByUser(session.id) : [];

  // Logged out - show a login prompt instead of a fake profile.
  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.loggedOut}>
          <View style={styles.avatar}>
            <Icon name="you" size={28} color={colors.textDim} />
          </View>
          <Text style={styles.name}>You&apos;re logged out</Text>
          <Text style={styles.handle}>Log in to keep a diary and post reviews.</Text>
          <Pressable style={styles.primary} onPress={onLogin}>
            <Text style={styles.primaryTxt}>LOG IN / SIGN UP</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const roleLabel = session.role === "admin" ? "ADMIN" : session.role === "artist" ? "VERIFIED ARTIST" : "FAN";

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.profile}>
        <Avatar user={session} size={64} onPress={() => onOpenProfile?.(session.id)} />
        <Text style={styles.name}>{session.name}</Text>
        <Text style={styles.handle}>@{session.handle}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleTxt}>{roleLabel}</Text>
        </View>
        <Pressable style={styles.viewProfile} onPress={() => onOpenProfile?.(session.id)}>
          <Text style={styles.viewProfileTxt}>View my profile</Text>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <Stat value={mine.length} label="SHOWS" />
        <Stat value="7" label="ARTISTS" />
        <Stat value="5" label="VENUES" />
      </View>

      <View style={styles.recap}>
        <View style={styles.recapKickerRow}>
          <Icon name="star" size={12} color={colors.amber} />
          <Text style={styles.recapKicker}>WRAPPED</Text>
        </View>
        <Text style={styles.recapTitle}>2026 in Concerts</Text>
        <Text style={styles.recapBody}>
          {mine.length} shows so far · most-seen genre: punk · best night rated{" "}
          <Text style={{ color: colors.gold }}>5.0</Text>
        </Text>
        <Text style={styles.recapCta}>tap to see your full year</Text>
      </View>

      {/* role-based tools */}
      <Text style={styles.sectionLabel}>ACCOUNT</Text>
      <ActionRow icon="edit" label="Edit profile" sub="Photo, name, bio, genres" onPress={onEditProfile} />
      {isStaff(session.role) && (
        <ActionRow icon="shield" label="Admin · moderation" sub="Report triage, verification, upkeep" onPress={onAdmin} />
      )}
      {isArtist(session.role) && (
        <ActionRow icon="calendar" label="Post tour dates (bulk)" sub="Schedule a batch + ticket links" onPress={onAddTourDate} />
      )}
      {session.role === "fan" && (
        <ActionRow icon="shield" label="Request artist account" sub="Admin-reviewed verification" onPress={onRequestArtist} />
      )}
      <ActionRow icon="logout" label="Log out" onPress={onLogout} danger />

      <Text style={styles.sectionLabel}>YOUR DIARY · {mine.length}</Text>
      <Text style={styles.diaryHint}>Every show you've logged. Tap one to see the full review.</Text>
      {mine.length === 0 && <Text style={styles.diaryEmpty}>No shows yet. Tap the + to log your first one.</Text>}
      {mine.map((l) => {
        const parts = l.date.split(" · ");
        return (
          <Pressable key={l.id} style={styles.diaryRow} onPress={() => onOpen?.(l)}>
            <View style={styles.diaryStub}>
              <Text style={styles.diaryStubMon}>{parts[1] || ""}</Text>
              <Text style={styles.diaryStubDay}>{parts[2] || ""}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.diaryArtist} numberOfLines={1}>{l.artist}</Text>
              <Text style={styles.diaryVenue} numberOfLines={1}>{l.venue} · {l.city}</Text>
            </View>
            <View style={styles.diaryScorePill}>
              <Icon name="star" size={11} color={colors.gold} />
              <Text style={styles.diaryScore}>{l.overall.toFixed(1)}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  loggedOut: { alignItems: "center", marginTop: 60, gap: 6 },
  profile: { alignItems: "center", marginTop: 8 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  avatarTxt: { color: colors.amber, fontWeight: "800", fontFamily: mono, fontSize: 16 },
  name: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 10 },
  handle: { color: colors.textDim, fontSize: 13, marginTop: 2, textAlign: "center" },
  roleBadge: { marginTop: 10, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  roleTxt: { color: colors.amber, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  viewProfile: { marginTop: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 8 },
  viewProfileTxt: { color: colors.amber, fontSize: 13, fontWeight: "600" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center", marginTop: 22 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },

  statsRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    marginTop: 20,
    paddingVertical: 16,
  },
  stat: { flex: 1, alignItems: "center" },
  statVal: { color: colors.text, fontFamily: mono, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1, marginTop: 4, fontWeight: "700" },

  recap: { marginTop: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.bgElev, padding: 18 },
  recapKickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  recapKicker: { color: colors.amber, fontSize: 11, letterSpacing: 2, fontWeight: "800" },
  recapTitle: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 6 },
  recapBody: { color: colors.textDim, fontSize: 14, lineHeight: 21, marginTop: 8 },
  recapCta: { color: colors.amber, fontSize: 13, marginTop: 12 },

  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 24, marginBottom: 10 },
  action: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 10 },
  actionIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  actionLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  actionSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },

  diaryHint: { color: colors.textDim, fontSize: 12, marginTop: -6, marginBottom: 12 },
  diaryEmpty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },
  diaryRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 8 },
  diaryStub: { width: 46, height: 46, borderRadius: 8, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  diaryStubMon: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "800" },
  diaryStubDay: { color: colors.textFaint, fontFamily: mono, fontSize: 11 },
  diaryArtist: { color: colors.text, fontSize: 15, fontWeight: "700" },
  diaryVenue: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  diaryScorePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  diaryScore: { color: colors.gold, fontFamily: mono, fontSize: 14, fontWeight: "700" },
});
