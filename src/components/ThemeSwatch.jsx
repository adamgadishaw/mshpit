import { View, Text, Pressable, StyleSheet } from "react-native";

import { colors, radius, space } from "../theme";
import Icon from "./Icon";

// One theme chip, rendered the same way everywhere.
//
// This existed three times over (the menu, edit profile, and onboarding), each
// with its own width, padding, dot size and gap: chips were 96pt, 104pt or
// flexed; dots were 12pt or 14pt with 4pt or 5pt between them; corners were
// `sm` in one place and `md` in the others. Nothing chose those numbers, they
// just drifted, and the result was the uneven look the owner called out. The
// values here come off the shared `space()` scale so the chip is consistent by
// construction rather than by three people remembering the same numbers.
//
// The palette is four accents, not two: presets that differ mainly in their
// cool and gold tones used to look nearly identical on a two-dot chip.
export default function ThemeSwatch({ theme, active, onPress, showMode = false }) {
  const accents = theme.swatch.accents || [theme.swatch.accent, theme.swatch.accent2];
  return (
    <Pressable
      style={[
        styles.chip,
        { backgroundColor: theme.swatch.bg, borderColor: active ? theme.swatch.accent : colors.line },
        active && styles.chipActive,
      ]}
      onPress={onPress}
      disabled={active}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!active, disabled: !!active }}
      accessibilityLabel={`${theme.name} theme, ${theme.dark ? "dark" : "light"}${active ? ", selected" : ""}`}
    >
      <View style={styles.dots}>
        {accents.map((color, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: color }]} />
        ))}
      </View>
      <Text style={[styles.name, { color: theme.swatch.text }]} numberOfLines={1}>{theme.name}</Text>
      {showMode && (
        <Text style={[styles.mode, { color: theme.swatch.text }]} numberOfLines={1}>{theme.dark ? "Dark" : "Light"}</Text>
      )}
      {active && (
        <View style={[styles.check, { backgroundColor: theme.swatch.accent }]}>
          <Icon name="check" size={10} color={theme.swatch.bg} strokeWidth={3} />
        </View>
      )}
    </Pressable>
  );
}

// A fixed width (not `flex: 1`) is what keeps a wrapped row from stretching its
// last few chips to different sizes, which is the same defect as the ragged
// tools grid on the You screen.
export const THEME_SWATCH_WIDTH = 104;

const styles = StyleSheet.create({
  chip: {
    width: THEME_SWATCH_WIDTH,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingVertical: space(3),
    paddingHorizontal: space(3),
    gap: space(2),
  },
  // Border width stays constant between states so selecting a chip cannot
  // change its size and nudge the whole row.
  chipActive: { borderWidth: 1.5 },
  dots: { flexDirection: "row", alignItems: "center", gap: space(1.25) },
  dot: { width: 13, height: 13, borderRadius: 6.5 },
  name: { fontSize: 13, fontWeight: "800" },
  mode: { fontSize: 10, fontWeight: "700", opacity: 0.6, letterSpacing: 0.5 },
  check: {
    position: "absolute", top: space(2), right: space(2),
    width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center",
  },
});

// The row/grid that holds them, so wrapping behaves the same in every picker.
export const themeGridStyle = { flexDirection: "row", flexWrap: "wrap", gap: space(2.5) };
