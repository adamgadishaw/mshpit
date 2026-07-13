import { View, Text, StyleSheet, Pressable, Modal, Platform } from "react-native";
import { colors, radius } from "../theme";
import Avatar from "./Avatar";
import Icon from "./Icon";

// Dropdown anchored to the top-right account chip. Uses a transparent Modal so it
// floats above everything and closes on an outside tap. Items are passed in so the
// same menu works from the desktop top bar (and could be reused on mobile).
export default function AccountMenu({ visible, user, onClose, items = [] }) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.menu} onPress={() => {}}>
          {user && (
            <View style={styles.head}>
              <Avatar user={user} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{user.name}</Text>
                <Text style={styles.handle} numberOfLines={1}>@{user.handle}</Text>
              </View>
            </View>
          )}
          {items.map((it, i) =>
            it.divider ? (
              <View key={i} style={styles.divider} />
            ) : (
              <Pressable key={i} style={styles.item} onPress={it.onPress}>
                <Icon name={it.icon} size={17} color={it.danger ? colors.danger : colors.textDim} />
                <Text style={[styles.itemTxt, it.danger && { color: colors.danger }]}>{it.label}</Text>
              </Pressable>
            )
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "flex-end", paddingTop: 56, paddingRight: 16 },
  menu: {
    width: 232, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingVertical: 6,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 8px 16px rgba(0,0,0,0.4)" }
      : { shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 }),
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, marginBottom: 4 },
  name: { color: colors.text, fontSize: 14, fontWeight: "800" },
  handle: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  itemTxt: { color: colors.text, fontSize: 14, fontWeight: "600" },
  divider: { height: 1, backgroundColor: colors.lineSoft, marginVertical: 5, marginHorizontal: 10 },
});
