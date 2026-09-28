import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, font, space } from "../../theme";
import Icon from "../../components/Icon";
import NewsDeskEditor, { canUseNewsroom } from "./NewsDeskEditor";

// The newsroom on its own: for admins and for editors, the news team, who
// have no other staff access.
export default function NewsroomScreen({ accountId, role, active = true, onClose }) {
  return <View style={styles.screen}>
    <View style={styles.header}>
      <Pressable onPress={onClose} style={styles.back} accessibilityRole="button" accessibilityLabel="Back"><Icon name="chevron-left" size={20} color={colors.text} /></Pressable>
      <Text style={styles.title} numberOfLines={1}>Newsroom</Text>
      <View style={styles.back} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {canUseNewsroom(role) ? <NewsDeskEditor accountId={accountId} role={role} active={active} />
        : <Text style={styles.denied}>The newsroom is for the news team. Ask an admin for editor access.</Text>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: colors.text, fontFamily: font, fontSize: 16, fontWeight: "900", textAlign: "center" },
  content: { padding: space(4), paddingBottom: space(10), maxWidth: 820, width: "100%", alignSelf: "center" },
  denied: { color: colors.textDim, fontFamily: font, fontSize: 14, textAlign: "center", marginTop: space(6) },
});
