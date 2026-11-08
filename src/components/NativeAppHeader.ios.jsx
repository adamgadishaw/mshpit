import { Pressable, StyleSheet, Text, View } from "react-native";
import BrandMark from "./BrandMark";
import Icon from "./Icon";
import NativeTabRail from "./NativeTabRail";
import { colors, font } from "../theme";

// The navigation layer stays compact so each page can own its large title.
export default function NativeAppHeader({ onHome, onAccount, loggedIn, onMenu, menuRef, onPost, active, onChange }) {
  return <NativeTabRail active={active} onChange={onChange}>
    <View style={styles.header}>
      <Pressable ref={menuRef} onPress={onMenu} style={styles.control} accessibilityRole="button" accessibilityLabel="Open side menu" accessibilityHint="Shows your account, music community and settings">
        <Icon name="menu" size={23} color={colors.text} strokeWidth={1.8} />
      </Pressable>
      <Pressable onPress={onHome} style={styles.brand} accessibilityRole="button" accessibilityLabel="Mshpit Discover">
        <BrandMark size={22} color={colors.amber} /><Text style={styles.wordmark}>MSHPIT</Text>
      </Pressable>
      <Pressable onPress={loggedIn ? onPost : onAccount} style={styles.control} accessibilityRole="button" accessibilityLabel={loggedIn ? "Make a post" : "Sign in"}>
        <Icon name={loggedIn ? "plus" : "you"} size={24} color={colors.amber} strokeWidth={1.9} />
      </Pressable>
    </View>
  </NativeTabRail>;
}
const styles = StyleSheet.create({
  header: { minHeight: 48, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.bg },
  control: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  brand: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7 },
  wordmark: { fontFamily: font, fontSize: 16, fontWeight: "800", letterSpacing: 1.8, color: colors.text },
});
