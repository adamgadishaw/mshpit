import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, radius, THEMES, themeKey } from "../theme";
import { useStore, isStaff, isMod, isArtist } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";

function Row({ icon, label, sub, onPress, danger }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowIcon}><Icon name={icon} size={18} color={danger ? colors.danger : colors.amber} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      {!danger && <Icon name="chevron-right" size={18} color={colors.textDim} />}
    </Pressable>
  );
}

// One place to reach everything - so features aren't scattered.
export default function MenuScreen({ onClose, onNear, onVenues, onFanClubs, onTopRated, onInbox, onProfile, onEditProfile, onAdmin, onTourDates, onRequestArtist, onLogin, onLogout, onBackToLanding }) {
  const { session, inboxUnread, chooseTheme } = useStore();
  const unread = session ? inboxUnread() : 0;

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="MENU" title="Everything" onBack={onClose} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {session ? (
          <Pressable style={styles.me} onPress={onProfile}>
            <Avatar user={session} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={styles.meName}>{session.name}</Text>
              <Text style={styles.meHandle}>@{session.handle} · view profile</Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.textDim} />
          </Pressable>
        ) : (
          <>
            <Pressable style={styles.loginBtn} onPress={onLogin}>
              <Text style={styles.loginTxt}>LOG IN / SIGN UP</Text>
            </Pressable>
            {!!onBackToLanding && (
              <Row icon="chevron-left" label="Back to welcome screen" sub="The opening page you saw first" onPress={onBackToLanding} />
            )}
          </>
        )}

        <Text style={styles.section}>DISCOVER</Text>
        <Row icon="pin" label="Near you" sub="Local venues & upcoming shows" onPress={onNear} />
        <Row icon="search" label="Find venues" sub="Browse rooms by city" onPress={onVenues} />
        <Row icon="comment" label="Fan clubs" sub="Every artist's permanent chat" onPress={onFanClubs} />
        <Row icon="trophy" label="Best rated near you" sub="Top shows by rating & distance" onPress={onTopRated} />
        <Row icon="mail" label="Inbox" sub={unread ? `${unread} unread` : "Your messages"} onPress={onInbox} />

        {session && (
          <>
            <Text style={styles.section}>ACCOUNT</Text>
            <Row icon="edit" label="Edit profile" sub="Photo, music, banner, theme" onPress={onEditProfile} />
            {isMod(session.role) && <Row icon="shield" label="Moderation" sub="Reports, members, content" onPress={onAdmin} />}
            {isArtist(session.role) && <Row icon="calendar" label="Post tour dates" sub="Bulk + scheduled" onPress={onTourDates} />}
            {session.role === "fan" && <Row icon="shield" label="Claim an artist profile" sub="Verify with your label / KYC" onPress={onRequestArtist} />}
          </>
        )}

        <Text style={styles.section}>APPEARANCE</Text>
        {session && <Text style={styles.themeHint}>Saved to your account — follows you to any device.</Text>}
        <View style={styles.themeRow}>
          {THEMES.map((t) => {
            const on = t.key === themeKey;
            return (
              <Pressable key={t.key} style={[styles.themeChip, { backgroundColor: t.swatch.bg, borderColor: on ? t.swatch.accent : colors.line }]} onPress={() => !on && chooseTheme(t.key)}>
                <View style={styles.themeDots}>
                  <View style={[styles.themeDot, { backgroundColor: t.swatch.accent }]} />
                  <View style={[styles.themeDot, { backgroundColor: t.swatch.accent2 }]} />
                </View>
                <Text style={[styles.themeName, { color: t.swatch.text }]} numberOfLines={1}>{t.name}</Text>
                {on && <View style={[styles.themeCheck, { backgroundColor: t.swatch.accent }]}><Icon name="check" size={10} color={t.swatch.bg} strokeWidth={3} /></View>}
              </Pressable>
            );
          })}
        </View>

        {session && <Row icon="logout" label="Log out" onPress={onLogout} danger />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  me: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12 },
  meName: { color: colors.text, fontSize: 16, fontWeight: "800" },
  meHandle: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  loginBtn: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  loginTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  section: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 22, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  rowIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  themeHint: { color: colors.textDim, fontSize: 12, marginTop: -4, marginBottom: 10 },
  themeRow: { flexDirection: "row", gap: 8 },
  themeChip: { flex: 1, borderRadius: radius.sm, borderWidth: 1.5, paddingVertical: 12, paddingHorizontal: 8, gap: 8 },
  themeDots: { flexDirection: "row", gap: 4 },
  themeDot: { width: 12, height: 12, borderRadius: 6 },
  themeName: { fontSize: 12.5, fontWeight: "800" },
  themeCheck: { position: "absolute", top: 6, right: 6, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
