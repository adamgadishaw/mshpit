import { Pressable, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { colors, displayFont, focusRing, mono, radius, space } from "../../theme";
import Icon from "../Icon";

export function ControlChip({ label, selected = false, disabled = false, onPress, icon, accessibilityLabel }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed, focused }) => [
        styles.chip,
        selected && styles.chipSelected,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        focused && focusRing,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={selected ? "#1A1206" : colors.textDim} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function LabeledSlider({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  onValueChange,
  onSlidingComplete,
  formatValue = (item) => `${Math.round(item * 100)}`,
  disabled = false,
  hint,
}) {
  return (
    <View style={[styles.sliderBlock, disabled && styles.disabled]}>
      <View style={styles.sliderHead}>
        <View style={styles.sliderLabelWrap}>
          <Text style={styles.sliderLabel}>{label}</Text>
          {hint ? <Text style={styles.sliderHint}>{hint}</Text> : null}
        </View>
        <Text style={styles.sliderValue} accessibilityLabel={`${label} ${formatValue(value)}`}>{formatValue(value)}</Text>
      </View>
      <Slider
        style={styles.slider}
        value={value}
        minimumValue={minimumValue}
        maximumValue={maximumValue}
        step={step}
        onValueChange={onValueChange}
        onSlidingComplete={onSlidingComplete}
        disabled={disabled}
        minimumTrackTintColor={colors.amberStrong}
        maximumTrackTintColor={colors.line}
        thumbTintColor={colors.amber}
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min: minimumValue,
          max: maximumValue,
          now: value,
          text: formatValue(value),
        }}
      />
    </View>
  );
}

export function InspectorSection({ title, detail, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function CapabilityNotice({ title, body, compact = false }) {
  return (
    <View style={[styles.notice, compact && styles.noticeCompact]} accessibilityRole="summary">
      <Icon name="lock" size={18} color={colors.amber} />
      <View style={styles.noticeCopy}>
        <Text style={styles.noticeTitle}>{title}</Text>
        <Text style={styles.noticeBody}>{body}</Text>
      </View>
    </View>
  );
}

export function HistoryButton({ label, icon, onPress, disabled }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed, focused }) => [styles.historyButton, disabled && styles.disabled, pressed && !disabled && styles.pressed, focused && focusRing]}
    >
      <Icon name={icon} size={17} color={disabled ? colors.textFaint : colors.text} />
      <Text style={[styles.historyText, disabled && styles.historyTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceAlt,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  chipSelected: { backgroundColor: colors.amberStrong, borderColor: colors.amber },
  chipText: { color: colors.textDim, fontFamily: displayFont, fontSize: 13, fontWeight: "800" },
  chipTextSelected: { color: "#1A1206" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.42 },
  sliderBlock: { gap: space(1), paddingVertical: space(1.5) },
  sliderHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space(3) },
  sliderLabelWrap: { flex: 1 },
  sliderLabel: { color: colors.text, fontFamily: displayFont, fontSize: 14, fontWeight: "800" },
  sliderHint: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 2 },
  sliderValue: { minWidth: 46, textAlign: "right", color: colors.amber, fontFamily: mono, fontSize: 12, fontWeight: "700" },
  slider: { width: "100%", height: 44 },
  section: { gap: space(3), paddingBottom: space(4) },
  sectionHead: { gap: 3 },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "900" },
  sectionDetail: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  notice: { flexDirection: "row", gap: 10, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceAlt },
  noticeCompact: { paddingVertical: 10 },
  noticeCopy: { flex: 1, gap: 3 },
  noticeTitle: { color: colors.text, fontFamily: displayFont, fontSize: 13, fontWeight: "900" },
  noticeBody: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  historyButton: { minHeight: 44, minWidth: 76, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceAlt, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  historyText: { color: colors.text, fontFamily: displayFont, fontSize: 12, fontWeight: "800" },
  historyTextDisabled: { color: colors.textFaint },
});
