import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Icon from "../../components/Icon";
import { colors, focusRing, radius } from "../../theme";
import useIOSDetailPresentation from "../../hooks/useIOSDetailPresentation";

// Keep the trigger mounted so keyboard focus survives repeated toggles.
// The parent keys each section by show/account to avoid leaking disclosure state.
export default function ShowSection({ title, summary, initiallyOpen = false, keepMounted = false, children }) {
  const { guard } = useIOSDetailPresentation();
  const [open, setOpen] = useState(initiallyOpen);
  const [hasOpened, setHasOpened] = useState(initiallyOpen);
  return <View style={styles.section}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      accessibilityHint={open ? "Collapse section" : "Expand section"}
      onPress={guard(() => { setHasOpened(true); setOpen(value => !value); })}
      style={({ pressed, focused }) => [styles.trigger, pressed && styles.pressed, focused && focusRing]}
    >
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {!!summary && <Text style={styles.summary}>{summary}</Text>}
      </View>
      <View style={open && styles.expandedIcon}><Icon name="chevron-down" size={18} color={colors.textDim} /></View>
    </Pressable>
    {(open || (keepMounted && hasOpened)) && <View
      style={[styles.body, !open && styles.hiddenBody]}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
    >{children}</View>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 12, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.surface },
  trigger: { minHeight: 56, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radius.md },
  copy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  summary: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 3 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  hiddenBody: { display: "none" },
  pressed: { backgroundColor: colors.surfaceAlt },
  expandedIcon: { transform: [{ rotate: "180deg" }] },
});
