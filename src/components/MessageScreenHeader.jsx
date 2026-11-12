import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, focusRing, font } from "../theme";
import Icon from "./Icon";
import { PageTitle } from "./PageReturnContext";

// Messaging has its own compact hierarchy; other detail headers are unchanged.
export default function MessageScreenHeader({ title, kicker, onBack, right, backLabel = "Go back" }) {
  const largeText = useWindowDimensions().fontScale >= 1.5;
  const back = <Pressable onPress={onBack} style={({ pressed, focused }) => [styles.back, pressed && styles.pressed, focused && focusRing]}
    accessibilityRole="button" accessibilityLabel={backLabel}>
    <Icon name="chevron-left" size={25} color={colors.amber} />
  </Pressable>;
  const identity = <PageTitle label={title} style={[styles.identity, largeText && styles.identityLarge]}>
    <View>
      <Text style={styles.title} numberOfLines={2} accessibilityRole="header">{title}</Text>
      {!!kicker && <Text style={styles.subtitle} numberOfLines={1}>{kicker}</Text>}
    </View>
  </PageTitle>;
  const action = !!right && <View style={styles.action}>{right}</View>;
  return <View style={[styles.wrap, largeText && styles.wrapLarge]}>
    {largeText ? <><View style={styles.navigation}>{back}{action}</View>{identity}</> : <>{back}{identity}{action}</>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 4, paddingRight: 16, paddingVertical: 6, backgroundColor: colors.bg },
  wrapLarge: { flexDirection: "column", alignItems: "stretch", gap: 4 },
  navigation: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  identityLarge: { flex: 0, paddingLeft: 12, paddingRight: 0 },
  back: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.65 },
  identity: { flex: 1, minWidth: 0, paddingRight: 8 },
  title: { color: colors.text, fontFamily: font, fontSize: 22, fontWeight: "700", letterSpacing: -0.45 },
  subtitle: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  action: { flexShrink: 0, alignItems: "flex-end" },
});
