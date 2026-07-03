import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors } from "../theme";
import Icon from "../components/Icon";

// Full-screen block for banned (red) or suspended (yellow) accounts. They can't
// post, DM, or browse - just see why and log out.
export default function AccountGate({ status, until, onLogout }) {
  const banned = status === "banned";
  const bg = banned ? "#2A0E12" : "#2A2208";
  const accent = banned ? "#E0457B" : "#E8B65A";
  const left = until ? Math.max(1, Math.ceil((until - Date.now()) / 86400000)) : 0;
  return (
    <View style={[styles.wrap, { backgroundColor: bg }]}>
      <View style={[styles.badge, { borderColor: accent }]}>
        <Icon name={banned ? "x" : "clock"} size={42} color={accent} />
      </View>
      <Text style={[styles.title, { color: accent }]}>{banned ? "Account banned" : "Account suspended"}</Text>
      <Text style={styles.body}>
        {banned
          ? "Your account broke the rules and has been permanently banned. You can't post, message, or browse."
          : `Your account is on a time-out for ${left} more day${left === 1 ? "" : "s"}. You can't post or message until it lifts.`}
      </Text>
      <Text style={styles.appeal}>Think this is a mistake? Email appeals@pit.app.</Text>
      <Pressable style={[styles.btn, { borderColor: accent }]} onPress={onLogout}>
        <Text style={[styles.btnTxt, { color: accent }]}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  badge: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontSize: 26, fontWeight: "900" },
  body: { color: "#fff", fontSize: 15, lineHeight: 23, textAlign: "center", opacity: 0.92 },
  appeal: { color: "rgba(255,255,255,0.6)", fontSize: 13, marginTop: 4 },
  btn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 28, paddingVertical: 12, marginTop: 12 },
  btnTxt: { fontSize: 15, fontWeight: "800" },
});
