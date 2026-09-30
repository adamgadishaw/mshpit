import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, font, radius } from "../../theme";
import Icon from "../Icon";
import { fetchNewsRegion, saveNewsRegion } from "../../lib/newsRegionApi";

// The top of the News screen for members: where their news comes from, and a
// way to change it. Automatic follows the region of their home city.
export default function NewsRegionBar({ accountId, onChanged }) {
  const [region, setRegion] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setRegion(null);
    if (!accountId) return undefined;
    const controller = new AbortController();
    fetchNewsRegion({ signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setRegion(result?.newsRegion || null); })
      // architecture: allow-ambiguous-result -- the bar is optional; the stories still load without it
      .catch(() => null);
    return () => controller.abort();
  }, [accountId]);

  if (!accountId || !region) return null;
  const title = region.region ? `News for ${region.label}` : "News from everywhere";
  const why = region.choice === "auto"
    ? (region.home ? `Picked from your city, ${region.city}.` : "Add your city to your profile, or pick a region.")
    : region.choice === "everywhere" ? "You chose every region." : "You picked this region.";
  const options = [
    { id: "auto", label: region.homeLabel ? `Automatic: ${region.homeLabel}` : "Automatic" },
    ...(Array.isArray(region.options) ? region.options : []),
    { id: "everywhere", label: "Everywhere" },
  ];
  const choose = async (choice) => {
    if (saving) return;
    setSaving(choice);
    setError("");
    try {
      setRegion(await saveNewsRegion({ accountId, choice }));
      setOpen(false);
      onChanged?.();
    } catch {
      setError("That didn't save. Try again.");
    } finally {
      setSaving(null);
    }
  };

  return <View style={styles.bar}>
    <View style={styles.row}>
      <Icon name="pin" size={16} color={colors.amber} />
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.why}>{why}</Text>
      </View>
      <Pressable onPress={() => setOpen((value) => !value)} hitSlop={8} style={({ focused }) => [styles.change, focused && focusRing]}
        accessibilityRole="button" accessibilityState={{ expanded: open }} aria-expanded={open} accessibilityLabel="Change where your news comes from">
        <Text style={styles.changeText}>{open ? "Done" : "Change"}</Text>
      </Pressable>
    </View>
    {open ? <View style={styles.panel}>
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="Where your news comes from">
        {options.map((option) => {
          const on = region.choice === option.id;
          return <Pressable key={option.id} onPress={() => choose(option.id)} disabled={!!saving}
            style={({ focused }) => [styles.option, on && styles.optionOn, focused && focusRing]}
            accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !!saving }} aria-checked={on} accessibilityLabel={option.label}>
            <Text style={[styles.optionText, on && styles.optionTextOn]}>{saving === option.id ? "Saving..." : option.label}</Text>
          </Pressable>;
        })}
      </View>
      <Text style={styles.why}>Stories that only matter somewhere else are left out. Worldwide news always shows, and an artist's page shows all of their news.</Text>
    </View> : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  bar: { gap: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, padding: 14, marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  title: { color: colors.text, fontFamily: font, fontSize: 14.5, fontWeight: "900" },
  why: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 17 },
  change: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 6 },
  changeText: { color: colors.amber, fontFamily: font, fontSize: 12.5, fontWeight: "900" },
  panel: { gap: 10 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, paddingHorizontal: 12, paddingVertical: 7 },
  optionOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  optionText: { color: colors.text, fontFamily: font, fontSize: 13, fontWeight: "800" },
  optionTextOn: { color: colors.bg },
  error: { color: colors.danger, fontFamily: font, fontSize: 12.5 },
});
