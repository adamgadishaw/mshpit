import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, displayFont, focusRing, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";

export default function LegacyArtistArchiveGate({
  artistName,
  state,
  onBack,
  onRetry,
}) {
  const name = String(artistName || "This artist").trim();
  const checking = state === "checking";
  const unavailable = state === "unavailable";
  return (
    <View style={styles.center} accessibilityLiveRegion={unavailable ? "assertive" : "polite"}>
      <View style={styles.card}>
        <View style={styles.mark}>
          {checking
            ? <ActivityIndicator color={colors.gold} />
            : <Icon name={unavailable ? "shield" : "archive"} size={26} color={colors.gold} />}
        </View>
        <Text style={styles.kicker}>{checking ? "CHECKING PROFILE" : unavailable ? "PROFILE STATUS" : "LEGACY PROFILE"}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {checking
            ? `Checking ${name}`
            : unavailable
              ? "The archive is temporarily unavailable"
              : "This archive is preserved differently"}
        </Text>
        <Text style={styles.copy}>
          {checking
            ? "Mshpit is confirming which parts of this artist page are available."
            : unavailable
              ? "We could not safely verify this artist's status. Tour and date pages stay closed until the check succeeds."
              : `${name} has an educational, read-only legacy profile. Individual tour and concert-date archives are intentionally not offered; biography and existing community memories remain on the main artist page.`}
        </Text>
        <View style={styles.actions}>
          {unavailable && typeof onRetry === "function" ? (
            <Pressable
              style={({ pressed, focused }) => [styles.secondary, pressed && styles.pressed, focused && focusRing]}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel={`Retry checking ${name}'s profile status`}
            >
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          ) : null}
          {!checking && typeof onBack === "function" ? (
            <Pressable
              style={({ pressed, focused }) => [styles.primary, pressed && styles.pressed, focused && focusRing]}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={`Return to ${name}'s artist page`}
            >
              <Text style={styles.primaryText}>Back to artist</Text>
              <Icon name="chevron-right" size={14} color="#1A1206" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 22, backgroundColor: colors.bg },
  card: { width: "100%", maxWidth: 620, alignItems: "center", paddingHorizontal: 24, paddingVertical: 30, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: `${colors.gold}66`, backgroundColor: colors.surface, ...shadow.card },
  mark: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: `${colors.gold}66`, backgroundColor: `${colors.gold}0D` },
  kicker: { color: colors.gold, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 1.6, marginTop: 16 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 25, lineHeight: 31, fontWeight: "900", textAlign: "center", marginTop: 5 },
  copy: { color: colors.textDim, fontSize: 13.5, lineHeight: 20, textAlign: "center", maxWidth: 500, marginTop: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 9, marginTop: 20 },
  primary: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  primaryText: { color: "#1A1206", fontSize: 13, fontWeight: "900" },
  secondary: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.gold },
  secondaryText: { color: colors.gold, fontSize: 13, fontWeight: "900" },
  pressed: { opacity: 0.76 },
});
