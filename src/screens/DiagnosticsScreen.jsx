import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, mono, radius } from "../theme";
import { clearDiagnostics, getDiagnostics, subscribeDiagnostics } from "../lib/diagnostics";
import SheetHeader from "../components/SheetHeader";
import Icon from "../components/Icon";

const severityColor = (severity) => {
  if (severity === "fatal" || severity === "error") return colors.danger;
  if (severity === "warning") return colors.gold;
  return colors.cool;
};

const timeLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  try { return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
  catch { return date.toISOString().replace("T", " ").slice(0, 16); }
};

function Detail({ label, value, selectable = false }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} selectable={selectable}>{String(value)}</Text>
    </View>
  );
}

function DiagnosticCard({ item }) {
  const accent = severityColor(item.severity);
  const meta = item.meta || {};
  return (
    <View style={[styles.card, { borderLeftColor: accent }]}>
      <View style={styles.cardHead}>
        <View style={[styles.statusIcon, { borderColor: accent }]}>
          <Icon name="music" size={16} color={accent} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.when}>{timeLabel(item.occurredAt)}</Text>
        </View>
        <Text style={[styles.code, { color: accent }]} selectable>{item.code}</Text>
      </View>

      <Text style={styles.message}>{item.message}</Text>

      <View style={styles.callout}>
        <Text style={styles.calloutLabel}>FAILURE POINT</Text>
        <Text style={styles.calloutText}>{item.context || item.failurePoint}</Text>
        <Text style={[styles.calloutLabel, { marginTop: 9 }]}>NEXT MOVE</Text>
        <Text style={styles.calloutText}>{item.guidance}</Text>
      </View>

      <View style={styles.details}>
        <Detail label="Source" value={item.source} />
        <Detail label="Route" value={meta.route} selectable />
        <Detail label="Method" value={meta.method} />
        <Detail label="HTTP status" value={meta.status || undefined} />
        <Detail label="Server code" value={meta.serverCode} selectable />
        <Detail label="Request ID" value={meta.requestId} selectable />
        <Detail label="Safe to retry" value={item.retryable ? "Yes" : "Not until the issue above is resolved"} />
      </View>
    </View>
  );
}

export default function DiagnosticsScreen({ onClose }) {
  const [items, setItems] = useState(getDiagnostics);
  useEffect(() => subscribeDiagnostics(setItems), []);

  return (
    <View style={styles.wrap}>
      <SheetHeader
        title="Diagnostics"
        onClose={onClose}
        action={items.length ? { label: "Clear", onPress: clearDiagnostics } : undefined}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <View style={styles.introIcon}><Icon name="discover" size={22} color={colors.amber} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>{items.length ? `${items.length} recent signal${items.length === 1 ? "" : "s"}` : "Soundcheck is clear"}</Text>
            <Text style={styles.introText}>
              {items.length
                ? "These safe references show where Pit stumbled. Share the PIT code and request ID when asking for help."
                : "Pit has not recorded a recent app or service failure on this device."}
            </Text>
          </View>
        </View>

        <Text style={styles.privacy}>PASSWORDS, MESSAGE TEXT, PHOTOS, REQUEST BODIES, QUERY VALUES, AND RAW STACKS ARE NEVER SAVED HERE.</Text>

        {items.map((item) => <DiagnosticCard key={item.id} item={item} />)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 56, width: "100%", maxWidth: 760, alignSelf: "center" },
  intro: { flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 15 },
  introIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center" },
  introTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  introText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  privacy: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, lineHeight: 15, letterSpacing: 0.55, marginVertical: 14 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, borderLeftWidth: 4, padding: 15, marginBottom: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bgElev, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 15, fontWeight: "900" },
  when: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
  code: { fontFamily: mono, fontSize: 11, fontWeight: "900" },
  message: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 12 },
  callout: { backgroundColor: colors.bgElev, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginTop: 12 },
  calloutLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, letterSpacing: 1.1, fontWeight: "800" },
  calloutText: { color: colors.text, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  details: { marginTop: 11, gap: 5 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  detailLabel: { width: 92, color: colors.textFaint, fontSize: 11 },
  detailValue: { flex: 1, color: colors.textDim, fontFamily: mono, fontSize: 10.5, lineHeight: 15 },
});
