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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valid = artistName.trim().length >= 2;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestArtist(artistName.trim(), note.trim());
      if (result?.ok) setDone(true);
      else setError(result?.error || "That request did not save. Please try again.");
    } catch {
      setError("That request did not save. Please try again.");
    } finally {
      setBusy(false);
    }
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
            <Text style={styles.doneTxt} accessibilityLiveRegion="polite" role="status">Request saved for admin review. Your account is not verified until an admin approves it.</Text>
            <Pressable style={styles.primary} onPress={onClose} accessibilityRole="button">
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
            <TextInput
              style={styles.input}
              value={artistName}
              onChangeText={(value) => { setArtistName(value); setError(""); }}
              placeholder="e.g. Turnstile"
              placeholderTextColor={colors.textFaint}
              maxLength={60}
              editable={!busy}
              returnKeyType="next"
              accessibilityLabel="Artist or band name"
              accessibilityState={{ disabled: busy }}
            />
            <Text style={styles.label}>VERIFICATION NOTE</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={note}
              onChangeText={(value) => { setNote(value); setError(""); }}
              placeholder="How can we verify you represent this artist? (socials, label, etc.)"
              placeholderTextColor={colors.textFaint}
              maxLength={500}
              multiline
              editable={!busy}
              accessibilityLabel="Verification note"
              accessibilityHint="Add official social, label, or management details that can verify your relationship to the artist"
              accessibilityState={{ disabled: busy }}
            />
            {!!error && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
            <Pressable
              style={[styles.primary, (!valid || busy) && styles.disabled]}
              onPress={submit}
              disabled={!valid || busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: !valid || busy, busy }}
            >
              <Text style={styles.primaryTxt}>{busy ? "SUBMITTING..." : "SUBMIT REQUEST"}</Text>
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
  disabled: { opacity: 0.4 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: 12 },
  doneBox: { alignItems: "center", marginTop: 40, gap: 16 },
  doneTxt: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center" },
});
