import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";

const REASONS = [
  "Harassment or bullying",
  "Hate speech or discrimination",
  "Threats or violence",
  "Inappropriate or sexual content",
  "Spam or misleading content",
  "Illegal content",
  "Copyright infringement",
  "Other safety concern",
];

const TARGET_NAMES = {
  post: "post",
  comment: "comment",
  user: "profile",
  message: "direct message",
  fan_message: "fan-club message",
  lounge_message: "lounge message",
  venue_review: "venue review",
  artist_post: "artist update",
  artist_profile: "artist profile",
};

export default function ReportScreen({ target: suppliedTarget, log, onClose }) {
  const { reportContent } = useStore();
  // `log` preserves old deep-navigation state while every new surface sends a
  // typed target. The server remains authoritative for target visibility.
  const target = suppliedTarget || log || {};
  const targetType = target.targetType || "post";
  const targetId = target.targetId || target.id;
  const targetName = target.targetName || TARGET_NAMES[targetType] || "content";
  const targetTitle = target.title
    || (targetType === "post" ? [target.artist, target.user?.name ? `by ${target.user.name}` : ""].filter(Boolean).join(" - ") : "")
    || `Selected ${targetName}`;
  const targetSummary = target.summary || target.mediaLabel || "Only the selected item and your reason are sent to moderators.";
  // null = choosing; "sending"; "sent"; anything else = failure copy.
  const [status, setStatus] = useState(null);
  const [duplicate, setDuplicate] = useState(false);
  const sending = status === "sending";
  const sent = status === "sent";
  const failure = status && !sending && !sent ? status : null;

  const submit = async (reason) => {
    if (sending || !targetId) return;
    setStatus("sending");
    const result = await reportContent(targetId, reason, targetType, { mediaUri: target.mediaUri || null });
    if (result?.ok) {
      setDuplicate(!!result.duplicate);
      setStatus("sent");
    } else {
      setStatus(result?.error || "That report didn't send. Try again.");
    }
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title={`Report ${targetName}`} onClose={onClose} />

      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {sent ? (
          <View style={styles.doneBox} accessibilityLiveRegion="polite">
            <Icon name="check" size={30} color={colors.good} />
            <Text selectable style={styles.doneTxt}>
              {duplicate
                ? `This ${targetName} is already in your open reports. Moderators still have it in their queue.`
                : `Thanks. This ${targetName} was sent to the moderation queue.`}
            </Text>
            <Pressable style={styles.primary} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close report confirmation">
              <Text style={styles.primaryTxt}>DONE</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.targetBox}>
              <Text selectable style={styles.target}>{targetTitle}</Text>
              <Text selectable style={styles.targetSummary}>{targetSummary}</Text>
            </View>
            <Text accessibilityRole="header" style={styles.prompt}>Why are you reporting this?</Text>
            <Text style={styles.privacyNote}>Reports are private. The person who posted this will not see who reported it.</Text>
            {!!failure && (
              <View style={styles.failBox} accessibilityLiveRegion="assertive">
                <Icon name="flag" size={15} color={colors.danger} />
                <Text selectable style={styles.failTxt}>{failure}</Text>
              </View>
            )}
            {REASONS.map((reason) => (
              <Pressable
                key={reason}
                style={({ pressed }) => [styles.row, sending && styles.rowBusy, pressed && !sending && styles.rowPressed]}
                onPress={() => submit(reason)}
                disabled={sending || !targetId}
                accessibilityRole="button"
                accessibilityState={{ disabled: sending || !targetId, busy: sending }}
                accessibilityLabel={`Report for ${reason}`}
              >
                <Icon name="flag" size={16} color={colors.danger} />
                <Text style={styles.rowTxt}>{reason}</Text>
                <Icon name="chevron-right" size={15} color={colors.textFaint} />
              </Pressable>
            ))}
            {sending ? <Text style={styles.sendingTxt} accessibilityLiveRegion="polite">Sending your report...</Text> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  targetBox: { padding: 14, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, marginBottom: 18 },
  target: { color: colors.text, fontSize: 14, fontWeight: "800" },
  targetSummary: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  prompt: { color: colors.text, fontSize: 20, fontWeight: "800" },
  privacyNote: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 5, marginBottom: 16 },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 9 },
  rowBusy: { opacity: 0.5 },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  failBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.danger, padding: 14, marginBottom: 14 },
  failTxt: { flex: 1, color: colors.danger, fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  sendingTxt: { color: colors.textDim, fontSize: 13, textAlign: "center", marginTop: 4 },
  rowTxt: { flex: 1, color: colors.text, fontSize: 15 },
  doneBox: { alignItems: "center", marginTop: 40, gap: 16 },
  doneTxt: { maxWidth: 460, color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center" },
  primary: { minHeight: 48, backgroundColor: colors.amberStrong, borderRadius: radius.md, borderCurve: "continuous", paddingVertical: 14, paddingHorizontal: 40, alignItems: "center", justifyContent: "center" },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
});
