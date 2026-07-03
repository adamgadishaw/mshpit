import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, radius, themeMode, setThemeMode } from "../theme";
import { useStore, isStaff, isArtist } from "../store";
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
  const { session, inboxUnread } = useStore();
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
            {isStaff(session.role) && <Row icon="shield" label="Admin" sub="Reports, bans, verification" onPress={onAdmin} />}
            {isArtist(session.role) && <Row icon="calendar" label="Post tour dates" sub="Bulk + scheduled" onPress={onTourDates} />}
            {session.role === "fan" && <Row icon="shield" label="Claim an artist profile" sub="Verify with your label / KYC" onPress={onRequestArtist} />}
          </>
        )}

        <Text style={styles.section}>APPEARANCE</Text>
        <View style={styles.themeRow}>
          <Pressable style={[styles.themeBtn, themeMode === "dark" && styles.themeOn]} onPress={() => themeMode !== "dark" && setThemeMode("dark")}>
            <Text style={[styles.themeTxt, themeMode === "dark" && styles.themeTxtOn]}>Dark</Text>
          </Pressable>
          <Pressable style={[styles.themeBtn, themeMode === "light" && styles.themeOn]} onPress={() => themeMode !== "light" && setThemeMode("light")}>
            <Text style={[styles.themeTxt, themeMode === "light" && styles.themeTxtOn]}>Light</Text>
          </Pressable>
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
  themeRow: { flexDirection: "row", gap: 10 },
  themeBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  themeOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  themeTxt: { color: colors.textDim, fontSize: 14, fontWeight: "600" },
  themeTxtOn: { color: colors.amber, fontWeight: "800" },
});
