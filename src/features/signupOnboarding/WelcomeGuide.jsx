import { Pressable, StyleSheet, Text, View } from "react-native";
import Icon from "../../components/Icon";
import { colors, displayFont, focusRing, mono, radius, space } from "../../theme";

const MOVES = [
  { destination: "shows", icon: "ticket", title: "Find a show", detail: "See what’s coming up. Keep a date with Going or Interested." },
  { destination: "artists", icon: "music", title: "Pick your artists", detail: "Follow the music you love and make your feed feel like yours." },
  { destination: "review", icon: "camera", title: "Remember the night", detail: "Rate a concert, share your photos, and tag who came with you." },
];

export default function WelcomeGuide({ selected, onChoose, busy = false }) {
  return <View style={styles.moves} accessibilityRole={selected === undefined ? undefined : "radiogroup"} accessibilityLabel={selected === undefined ? undefined : "Choose where to start"}>
    {MOVES.map(({ destination, icon, title, detail }, index) => <Pressable
      key={destination} onPress={() => onChoose(destination)} disabled={busy}
      accessibilityRole={selected === undefined ? "button" : "radio"}
      accessibilityLabel={title} accessibilityState={{ ...(selected === undefined ? {} : { checked: selected === destination }), disabled: busy }}
      aria-checked={selected === undefined ? undefined : selected === destination} aria-disabled={busy}
      style={({ pressed, focused }) => [styles.move, selected === destination && styles.selected, pressed && styles.pressed, focused && focusRing]}
    >
      <View style={styles.stub}><Text style={styles.number}>0{index + 1}</Text><Icon name={icon} size={22} color={colors.amber} /></View>
      <View style={styles.copy}><Text style={styles.title}>{title}</Text><Text style={styles.detail}>{detail}</Text></View>
      <Icon name={selected === destination ? "check" : "chevron-right"} size={19} color={selected === destination ? colors.amber : colors.textFaint} />
    </Pressable>)}
    <Text style={styles.note}>Your pace. Your people. You can change your profile and privacy settings anytime.</Text>
  </View>;
}

const styles = StyleSheet.create({
  moves: { gap: space(3) },
  move: { minHeight: 104, flexDirection: "row", alignItems: "center", gap: space(3), padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  selected: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  stub: { width: 38, alignItems: "center", gap: space(2) },
  number: { fontFamily: mono, fontSize: 10, letterSpacing: 2, color: colors.textFaint },
  copy: { flex: 1, minWidth: 0, borderLeftWidth: 1, borderLeftColor: colors.line, paddingLeft: space(3) },
  title: { fontFamily: displayFont, color: colors.text, fontSize: 17, fontWeight: "900" },
  detail: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 4 },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginTop: space(1) },
  pressed: { opacity: 0.8 },
});
