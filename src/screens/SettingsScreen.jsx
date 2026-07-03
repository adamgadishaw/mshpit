import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, radius, mono, THEMES, themeKey, setTheme } from "../theme";
import { useStore } from "../store";
import SheetHeader from "../components/SheetHeader";
import Icon from "../components/Icon";

function Row({ icon, label, sub, onPress, danger, right }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.rowIcon, danger && { borderColor: colors.danger }]}>
        <Icon name={icon} size={17} color={danger ? colors.danger : colors.amber} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      {right || (!danger && <Icon name="chevron-right" size={18} color={colors.textDim} />)}
    </Pressable>
  );
}

// Theme swatch: a mini preview of the preset's palette.
function Swatch({ theme, active, onPress }) {
  const s = theme.swatch;
  return (
    <Pressable style={[styles.swatch, { backgroundColor: s.bg, borderColor: active ? colors.amber : colors.line }]} onPress={onPress}>
      <View style={styles.swatchDots}>
        <View style={[styles.chip, { backgroundColor: s.accent }]} />
        <View style={[styles.chip, { backgroundColor: s.accent2 }]} />
        <View style={[styles.bar, { backgroundColor: s.surface, borderColor: s.accent }]} />
      </View>
      <Text style={[styles.swatchName, { color: s.text }]}>{theme.name}</Text>
      <Text style={[styles.swatchSub, { color: s.text, opacity: 0.6 }]} numberOfLines={1}>{theme.sub}</Text>
      {active && <View style={styles.swatchCheck}><Icon name="check" size={12} color="#1A1206" /></View>}
    </Pressable>
  );
}

export default function SettingsScreen({ onClose, onEditProfile, onOpenProfile, onOpenPrivacy, onOpenTerms, onLogout }) {
  const { session } = useStore();

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Settings" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>APPEARANCE</Text>
        <Text style={styles.hint}>Pick a theme. It applies across the whole app.</Text>
        <View style={styles.swatchGrid}>
          {THEMES.map((t) => (
            <Swatch key={t.key} theme={t} active={t.key === themeKey} onPress={() => t.key !== themeKey && setTheme(t.key)} />
          ))}
        </View>

        {session && (
          <>
            <Text style={styles.section}>ACCOUNT</Text>
            <Row icon="you" label="Go to profile" sub={`@${session.handle}`} onPress={onOpenProfile} />
            <Row icon="edit" label="Edit profile" sub="Photo, bio, music, banner" onPress={onEditProfile} />
          </>
        )}

        <Text style={styles.section}>ABOUT</Text>
        <Row icon="lock" label="Privacy policy" onPress={onOpenPrivacy} />
        <Row icon="shield" label="Terms & conditions" onPress={onOpenTerms} />
        <Row icon="globe" label="Version" sub="Pit · prototype build" onPress={undefined} right={<Text style={styles.ver}>0.1</Text>} />

        {session && (
          <>
            <View style={{ height: 12 }} />
            <Row icon="logout" label="Log out" danger onPress={onLogout} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  section: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 22, marginBottom: 8 },
  hint: { color: colors.textDim, fontSize: 13, marginBottom: 12 },
  swatchGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatch: { width: "47.5%", borderWidth: 2, borderRadius: radius.md, padding: 14, minHeight: 96 },
  swatchDots: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  chip: { width: 18, height: 18, borderRadius: 9 },
  bar: { flex: 1, height: 10, borderRadius: 5, borderWidth: 1 },
  swatchName: { fontSize: 15, fontWeight: "800" },
  swatchSub: { fontSize: 11, marginTop: 2 },
  swatchCheck: { position: "absolute", top: 10, right: 10, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 8 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  ver: { color: colors.textFaint, fontFamily: mono, fontSize: 13 },
});
