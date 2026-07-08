import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors, radius, mono } from "../theme";
import SheetHeader from "../components/SheetHeader";

// Shared layout for static legal/policy pages so Privacy + Terms stay consistent
// and on-brand.
const DEFAULT_NOTE =
  "Pit is an early prototype. This document describes how the product is intended to work and will be finalized before public launch. Questions? Reach the team from your profile.";

export default function PolicyScreen({ title, updated, intro, sections = [], onClose, note = DEFAULT_NOTE }) {
  return (
    <View style={styles.wrap}>
      <SheetHeader title={title} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated {updated}</Text>
        {!!intro && <Text style={styles.intro}>{intro}</Text>}
        {sections.map((s, i) => (
          <View key={i} style={styles.block}>
            <Text style={styles.h}>{i + 1}. {s.h}</Text>
            <Text style={styles.p}>{s.p}</Text>
          </View>
        ))}
        {!!note && (
          <View style={styles.note}>
            <Text style={styles.noteTxt}>{note}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  updated: { color: colors.textFaint, fontFamily: mono, fontSize: 11, letterSpacing: 0.5, marginBottom: 14 },
  intro: { color: colors.textDim, fontSize: 15, lineHeight: 22, marginBottom: 8 },
  block: { marginTop: 18 },
  h: { color: colors.text, fontSize: 15, fontWeight: "800", marginBottom: 6 },
  p: { color: colors.textDim, fontSize: 14, lineHeight: 21 },
  note: { marginTop: 24, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14 },
  noteTxt: { color: colors.textFaint, fontSize: 12, lineHeight: 18, fontStyle: "italic" },
});
