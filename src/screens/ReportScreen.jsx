import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";

const REASONS = ["Copyright infringement", "Illegal content", "Inappropriate / NSFW", "Harassment", "Spam or misleading"];

export default function ReportScreen({ log, onClose }) {
  const { reportContent } = useStore();
  // null = choosing · "sending" · "sent" · any other string = the failure to show.
  // Deliberately not a boolean: this screen used to claim the report reached the
  // moderators the instant you tapped, even when the request failed and nobody
  // ever saw it. Telling someone their harassment report was filed when it was
  // not is the worst lie this app could tell, so the state has to distinguish.
  const [status, setStatus] = useState(null);
  const sending = status === "sending";
  const sent = status === "sent";
  const failure = status && !sending && !sent ? status : null;

  const submit = async (reason) => {
    if (sending) return;
    setStatus("sending");
    const result = await reportContent(log.id, reason);
    setStatus(result?.ok ? "sent" : (result?.error || "That report didn't send. Try again."));
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Report post" onClose={onClose} />

      <View style={styles.content}>
        {sent ? (
          <View style={styles.doneBox}>
            <Icon name="check" size={30} color={colors.good} />
            <Text style={styles.doneTxt}>Thanks - this post was sent to the admin report queue. We act on reports as they come in.</Text>
            <Pressable style={styles.primary} onPress={onClose}>
              <Text style={styles.primaryTxt}>DONE</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.target}>{log.artist} · by {log.user?.name}</Text>
            <Text style={styles.prompt}>Why are you reporting this?</Text>
            {!!failure && (
              <View style={styles.failBox}>
                <Icon name="flag" size={15} color={colors.danger} />
                <Text style={styles.failTxt}>{failure}</Text>
              </View>
            )}
            {REASONS.map((r) => (
              <Pressable
                key={r}
                style={[styles.row, sending && styles.rowBusy]}
                onPress={() => submit(r)}
                disabled={sending}
                accessibilityRole="button"
                accessibilityState={{ disabled: sending }}
                accessibilityLabel={`Report for ${r}`}
              >
                <Icon name="flag" size={16} color={colors.danger} />
                <Text style={styles.rowTxt}>{r}</Text>
              </Pressable>
            ))}
            {sending && <Text style={styles.sendingTxt}>Sending your report…</Text>}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  cancel: { color: colors.textDim, fontSize: 15, width: 40 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16 },
  target: { color: colors.textDim, fontSize: 13, marginBottom: 4 },
  prompt: { color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 16, marginBottom: 10 },
  rowBusy: { opacity: 0.5 },
  failBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, padding: 14, marginBottom: 14 },
  failTxt: { flex: 1, color: colors.danger, fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  sendingTxt: { color: colors.textDim, fontSize: 13, textAlign: "center", marginTop: 4 },
  rowTxt: { color: colors.text, fontSize: 15 },
  doneBox: { alignItems: "center", marginTop: 40, gap: 16 },
  doneTxt: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 40, alignItems: "center" },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
});
