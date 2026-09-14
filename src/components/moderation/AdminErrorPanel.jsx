import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, mono, radius } from "../../theme";
import { formatErrorOccurrenceTime, formatErrorObservedHour } from "../../domain/errorDiagnostics.mjs";

const PAGE_SIZE = 8;
const MAX_RETAINED_PATTERNS = 50;

export default function AdminErrorPanel({ errorLog, loading = false, loadError = "", currentRelease, onRetry, onSendTestAlert }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const serious = errorLog?.serious24h;
  const seriousAvailable = Number.isSafeInteger(serious?.occurrences) && serious.occurrences >= 0
    && Number.isSafeInteger(serious?.kinds) && serious.kinds >= 0;
  const seriousColor = !seriousAvailable ? colors.textDim : serious.occurrences > 0 ? colors.danger : colors.good;
  const retained = Array.isArray(errorLog?.errors) ? errorLog.errors.slice(0, MAX_RETAINED_PATTERNS) : [];
  const patterns = Array.isArray(serious?.patterns) ? serious.patterns.slice(0, PAGE_SIZE) : [];
  return (
    <View style={[styles.healthCard, seriousAvailable && serious.occurrences > 0 && styles.healthCardBad]}>
      <Text style={styles.healthTitle}>APP + SERVER ERRORS</Text>
      {loading && !errorLog ? <View style={styles.loading}><ActivityIndicator color={colors.amber} /><Text style={styles.healthSub}>Loading site errors...</Text></View> : null}
      {loadError ? <Text selectable style={styles.healthSub}>{loadError}</Text> : null}
      {(!errorLog || loadError) && !loading ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry loading site errors" style={styles.button} onPress={onRetry}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      ) : null}
      {errorLog ? <>
        <Text selectable style={[styles.healthState, { color: seriousColor }]}>
          {!seriousAvailable ? "Serious-fault window unavailable. This is not an all-clear."
            : `${serious.occurrences} serious occurrence${serious.occurrences === 1 ? "" : "s"} across ${serious.kinds} pattern${serious.kinds === 1 ? "" : "s"} in the hourly-bucketed last 24h.`}
        </Text>
        {seriousAvailable ? <>
          <Text selectable style={styles.healthSub}>Same serious-fault window used by the daily readout; a later refresh can show a different window.</Text>
          <Text selectable style={styles.healthSub}>Window starts: {formatErrorOccurrenceTime(serious.startedAt) || "Unavailable"}; collected through: {formatErrorOccurrenceTime(serious.collectedThrough) || "Unavailable"}.</Text>
          {patterns.map((pattern, index) => (
            <View key={pattern.fingerprint || `serious-${index}`} testID="serious-error-pattern" style={styles.entry}>
              <Text selectable style={styles.row}>{pattern.occurrences} in this window / {pattern.level === "fatal" ? "FATAL" : pattern.status} {pattern.method} {pattern.route || "(no route)"} / {pattern.code}</Text>
              {pattern.fingerprint ? <Text selectable style={styles.row}>Pattern: {pattern.fingerprint}</Text> : null}
              <Text selectable style={styles.row}>Latest observed hour: {formatErrorObservedHour(pattern.lastObservedHour) || "Unavailable"}</Text>
            </View>
          ))}
          {serious.omittedKinds > 0 ? <Text selectable style={styles.healthSub}>{serious.omittedKinds} more serious pattern{serious.omittedKinds === 1 ? "" : "s"} in this window are not listed in the bounded summary.</Text> : null}
        </> : null}
        <Text selectable style={styles.healthSub}>
          {Number.isSafeInteger(errorLog.last24h?.occurrences) ? `${errorLog.last24h.occurrences} total occurrences (all fault levels) in 24h` : "All-fault 24h total unavailable"}; {Number.isSafeInteger(errorLog.last7Days?.occurrences) ? `${errorLog.last7Days.occurrences} in 7 days` : "7-day total unavailable"}.
        </Text>
        <Text selectable style={styles.healthSub}>{errorLog.alerts?.enabled
          ? `Alerts to ${errorLog.alerts.to || "(no ADMIN_EMAIL)"}, at most one digest every ${errorLog.alerts.cooldownMinutes}m.`
          : "Alerts are switched off (ERROR_ALERTS_ENABLED)."}</Text>
        {currentRelease ? <Text selectable style={styles.healthSub}>Current release: {currentRelease}</Text> : null}
        <Text style={styles.sectionTitle}>Retained pattern details</Text>
        <Text selectable style={styles.healthSub}>Retained totals below include older occurrences, not just the last 24 hours. A saved diagnostic capture can predate the last occurrence.</Text>
        {retained.slice(0, visibleCount).map((error, index) => (
          <View key={error.fingerprint || `retained-${index}`} testID="retained-error-pattern" style={styles.entry}>
            <Text selectable style={styles.row}>
              {error.count} retained total / {error.level === "fatal" ? "FATAL" : error.status} {error.method} {error.route || "(no route)"} / {error.code}
              {error.cause && error.cause !== "unclassified" ? ` (${error.cause})` : ""}
            </Text>
            <Text selectable style={styles.row}>Last occurred: {formatErrorOccurrenceTime(error.lastSeen) || "Unknown time"}</Text>
            {error.fingerprint ? <Text selectable style={styles.row}>Pattern: {error.fingerprint}</Text> : null}
            {error.lastRequestId ? <Text selectable style={styles.row}>Request ID: {error.lastRequestId}</Text> : null}
            {error.detail ? <>
              <Text selectable style={styles.row}>Captured release: {error.detail.release || "Unavailable"}</Text>
              <Text selectable style={styles.row}>Where (redacted): {error.detail.location || "Unavailable"}</Text>
              <Text selectable style={styles.row}>Why (redacted): {error.detail.reason || "Unavailable"}</Text>
              <Text selectable style={styles.row}>Details captured: {formatErrorOccurrenceTime(error.detail.capturedAt) || "Unknown time"}</Text>
            </> : <Text selectable style={styles.row}>Redacted diagnostic details unavailable for this pattern.</Text>}
          </View>
        ))}
        {!retained.length ? <Text style={styles.healthSub}>No retained patterns returned.</Text> : null}
        {retained.length ? <Text selectable style={styles.healthSub}>Showing {Math.min(visibleCount, retained.length)} of {retained.length} returned patterns (up to 50).</Text> : null}
        <View style={styles.actions}>
          {visibleCount < retained.length ? <Pressable accessibilityRole="button" accessibilityLabel="Show more error patterns" style={styles.button} onPress={() => setVisibleCount((count) => Math.min(MAX_RETAINED_PATTERNS, count + PAGE_SIZE))}>
            <Text style={styles.buttonText}>Show more patterns</Text>
          </Pressable> : null}
          {visibleCount > PAGE_SIZE ? <Pressable accessibilityRole="button" accessibilityLabel="Show fewer error patterns" style={styles.button} onPress={() => setVisibleCount(PAGE_SIZE)}>
            <Text style={styles.buttonText}>Show fewer</Text>
          </Pressable> : null}
          <Pressable accessibilityRole="button" style={styles.button} onPress={onSendTestAlert}>
            <Text style={styles.buttonText}>Send a test alert</Text>
          </Pressable>
        </View>
        {errorLog.testResult ? <Text selectable style={styles.healthSub}>{errorLog.testResult}</Text> : null}
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  healthCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, gap: 6, marginTop: 12, minWidth: 0 },
  healthCardBad: { borderColor: colors.danger },
  healthTitle: { color: colors.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 1, fontFamily: mono },
  healthState: { fontSize: 13.5, fontWeight: "700" },
  healthSub: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
  sectionTitle: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 12 },
  entry: { gap: 3, marginVertical: 6, minWidth: 0 },
  row: { color: colors.textDim, fontSize: 11, fontFamily: mono, flexShrink: 1 },
  loading: { flexDirection: "row", alignItems: "center", gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 10 },
  button: { alignSelf: "flex-start", justifyContent: "center", minHeight: 44, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  buttonText: { color: colors.text, fontSize: 11, fontWeight: "700" },
});
