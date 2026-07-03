import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";

const REASONS = ["Copyright infringement", "Illegal content", "Inappropriate / NSFW", "Harassment", "Spam or misleading"];

export default function ReportScreen({ log, onClose }) {
  const { reportContent } = useStore();
  const [done, setDone] = useState(false);

  const submit = (reason) => {
    reportContent(log.id, reason);
    setDone(true);
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Report post" onClose={onClose} />

      <View style={styles.content}>
        {done ? (
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
            {REASONS.map((r) => (
              <Pressable key={r} style={styles.row} onPress={() => submit(r)}>
                <Icon name="flag" size={16} color={colors.danger} />
                <Text style={styles.rowTxt}>{r}</Text>
              </Pressable>
            ))}
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
  rowTxt: { color: colors.text, fontSize: 15 },
  doneBox: { alignItems: "center", marginTop: 40, gap: 16 },
  doneTxt: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 40, alignItems: "center" },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
});
