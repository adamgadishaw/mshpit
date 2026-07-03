import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";

export default function RequestArtistScreen({ onClose }) {
  const { requestArtist } = useStore();
  const [artistName, setArtistName] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);

  const submit = () => {
    if (!artistName.trim()) return;
    requestArtist(artistName, note);
    setDone(true);
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Artist account" onBack={onClose} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.h1Row}>
          <Icon name="shield" size={22} color={colors.amber} />
          <Text style={styles.h1}>Request artist account</Text>
        </View>

        {done ? (
          <View style={styles.doneBox}>
            <Icon name="check" size={28} color={colors.good} />
            <Text style={styles.doneTxt}>Request submitted. An admin will review it before your account is verified.</Text>
            <Pressable style={styles.primary} onPress={onClose}>
              <Text style={styles.primaryTxt}>DONE</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.intro}>
              Verified artists can post official tour dates with ticket links. Every request is
              reviewed by an admin before approval.
            </Text>
            <Text style={styles.label}>ARTIST / BAND NAME</Text>
            <TextInput style={styles.input} value={artistName} onChangeText={setArtistName} placeholder="e.g. Turnstile" placeholderTextColor={colors.textFaint} maxLength={60} />
            <Text style={styles.label}>VERIFICATION NOTE</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={note}
              onChangeText={setNote}
              placeholder="How can we verify you represent this artist? (socials, label, etc.)"
              placeholderTextColor={colors.textFaint}
              maxLength={500}
              multiline
            />
            <Pressable style={[styles.primary, !artistName.trim() && { opacity: 0.4 }]} onPress={submit}>
              <Text style={styles.primaryTxt}>SUBMIT REQUEST</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { flexDirection: "row", alignItems: "center", width: 56 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48 },
  h1Row: { flexDirection: "row", alignItems: "center", gap: 10 },
  h1: { color: colors.text, fontSize: 24, fontWeight: "800", flex: 1 },
  intro: { color: colors.textDim, fontSize: 14, lineHeight: 21, marginTop: 14 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8, marginTop: 20 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 24 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  doneBox: { alignItems: "center", marginTop: 40, gap: 16 },
  doneTxt: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center" },
});
