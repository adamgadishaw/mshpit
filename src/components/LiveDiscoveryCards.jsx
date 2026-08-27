import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius } from "../theme";
import { LIVE_EVENT_SCOPE } from "../domain/liveDiscovery.mjs";
import Icon from "./Icon";

export function EventScopeToggle({ scope, onChange, localLabel = "Near you", compact = false }) {
  const options = [
    { value: LIVE_EVENT_SCOPE.LOCAL, label: localLabel },
    { value: LIVE_EVENT_SCOPE.WORLDWIDE, label: "Worldwide" },
  ];
  return (
    <View style={[styles.scopeToggle, compact && styles.scopeToggleCompact]} accessibilityRole="tablist" accessibilityLabel="Upcoming concert area">
      {options.map((option) => {
        const selected = scope === option.value;
        return (
          <Pressable
            key={option.value}
            style={({ pressed, focused }) => [
              styles.scopeOption,
              compact && styles.scopeOptionCompact,
              selected && styles.scopeOptionSelected,
              pressed && styles.pressed,
              focused && focusRing,
            ]}
            onPress={() => onChange?.(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={"Show upcoming concerts " + option.label.toLocaleLowerCase()}
          >
            <Icon name={option.value === LIVE_EVENT_SCOPE.WORLDWIDE ? "globe" : "pin"} size={13} color={selected ? "#1A1206" : colors.textDim} />
            <Text style={[styles.scopeText, selected && styles.scopeTextSelected]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PopularLoungeCard({ lounge, onPress, compact = false }) {
  const messages = Math.max(0, Number(lounge?.messageCount) || 0);
  const attendees = Math.max(0, Number(lounge?.attendeeCount) || 0);
  const place = String(lounge?.city || lounge?.place || "").split(",")[0].trim();
  return (
    <Pressable
      style={({ pressed, hovered, focused }) => [
        styles.loungeCard,
        compact && styles.loungeCardCompact,
        hovered && styles.hovered,
        pressed && styles.pressed,
        focused && focusRing,
      ]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !onPress }}
      accessibilityLabel={"Open " + (lounge?.artist || "concert") + " lounge at " + (lounge?.venue || "the venue") + ", " + messages + " messages, " + attendees + " going"}
      accessibilityHint="Opens the concert room. Joining requires an account and adds the show to Going."
    >
      <View style={[styles.loungeMark, compact && styles.loungeMarkCompact]}>
        <Icon name="comment" size={compact ? 15 : 18} color={colors.magenta} />
      </View>
      <View style={styles.copy}>
        <View style={styles.liveLine}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>ACTIVE LOUNGE</Text>
        </View>
        <Text style={[styles.artist, compact && styles.artistCompact]} numberOfLines={1}>{lounge?.artist || "Concert lounge"}</Text>
        <Text style={styles.place} numberOfLines={1}>{[lounge?.venue, place].filter(Boolean).join(" · ")}</Text>
      </View>
      <View style={styles.signals}>
        <Text style={styles.signalStrong}>{messages}</Text>
        <Text style={styles.signalLabel}>MESSAGES</Text>
        {!compact ? <Text style={styles.attendeeText}>{attendees} going</Text> : null}
      </View>
      <Icon name="chevron-right" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scopeToggle: { flexDirection: "row", alignItems: "center", gap: 4, padding: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  scopeToggleCompact: { width: "100%" },
  scopeOption: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, borderRadius: radius.pill, flexShrink: 1, ...Platform.select({ web: { cursor: "pointer" } }) },
  scopeOptionCompact: { flex: 1, paddingHorizontal: 8 },
  scopeOptionSelected: { backgroundColor: colors.amberStrong },
  scopeText: { color: colors.textDim, fontSize: 11.5, fontWeight: "800", flexShrink: 1 },
  scopeTextSelected: { color: "#1A1206", fontWeight: "900" },
  loungeCard: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, ...Platform.select({ web: { cursor: "pointer", transitionDuration: "120ms", transitionProperty: "background-color, border-color, transform" } }) },
  loungeCardCompact: { minHeight: 68, padding: 9, gap: 8, backgroundColor: colors.bgElev },
  loungeMark: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.magenta + "66", backgroundColor: colors.magenta + "12" },
  loungeMarkCompact: { width: 34, height: 34, borderRadius: 11 },
  copy: { flex: 1, minWidth: 0 },
  liveLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  liveDot: { width: 5, height: 5, borderRadius: 5, backgroundColor: colors.good },
  liveText: { color: colors.good, fontFamily: mono, fontSize: 7.5, fontWeight: "900", letterSpacing: 0.8 },
  artist: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900", marginTop: 2 },
  artistCompact: { fontSize: 13.5 },
  place: { color: colors.textDim, fontSize: 11, lineHeight: 15, marginTop: 2 },
  signals: { minWidth: 50, alignItems: "flex-end" },
  signalStrong: { color: colors.magenta, fontFamily: mono, fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  signalLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 6.5, letterSpacing: 0.6, fontWeight: "900" },
  attendeeText: { color: colors.textDim, fontSize: 9.5, fontWeight: "700", marginTop: 4 },
  hovered: { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
  pressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
});
