import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { colors, focusRing, radius } from "../theme";
import { GEO, formatPlace } from "../geo";
import Icon from "./Icon";

const LEVELS = ["Continent", "Country", "State / Province / Territory", "City"];

// Drill-down picker so there are no spelling mistakes or stray formats.
export default function LocationPicker({ onSelect, onClose }) {
  const [path, setPath] = useState([]); // [continent, country, state]

  // resolve options at the current depth
  let node = GEO;
  for (const step of path) node = node[step];
  const options = Array.isArray(node) ? node : Object.keys(node);
  const depth = path.length;

  const pick = (opt) => {
    const next = [...path, opt];
    if (depth === 3) {
      const [continent, country, state] = path;
      onSelect({ continent, country, state, city: opt, label: formatPlace({ continent, country, state, city: opt }) });
    } else {
      setPath(next);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.topbar}>
        <Pressable
          style={({ focused, pressed }) => [styles.backBtn, focused && focusRing, pressed && styles.controlPressed]}
          onPress={() => (depth ? setPath(path.slice(0, -1)) : onClose())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={depth ? `Back to ${LEVELS[depth - 1]}` : "Cancel location selection"}
        >
          <Icon name="chevron-left" size={20} color={colors.amber} />
          <Text style={styles.back}>{depth ? "back" : "cancel"}</Text>
        </Pressable>
        <Text style={styles.topTitle} accessibilityRole="header">PICK A LOCATION</Text>
        <View style={{ width: 64 }} />
      </View>

      {/* breadcrumb */}
      <View style={styles.crumbs} accessible accessibilityLabel={path.length ? `Location path: ${path.join(", ")}` : "No location selected"} accessibilityLiveRegion="polite">
        <Icon name="globe" size={14} color={colors.textDim} />
        <Text style={styles.crumbTxt}>{path.length ? path.join("  ›  ") : "Choose a continent"}</Text>
      </View>
      <Text style={styles.level} accessibilityRole="header">Choose a {LEVELS[depth].toLowerCase()}</Text>

      <FlatList
        style={styles.scroller}
        data={options}
        keyExtractor={(opt) => opt}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        renderItem={({ item: opt }) => (
          <Pressable
            style={({ focused, pressed }) => [styles.row, focused && focusRing, pressed && styles.controlPressed]}
            onPress={() => pick(opt)}
            accessibilityRole="button"
            accessibilityLabel={opt}
            accessibilityHint={depth === 3 ? `Select ${opt} as your city` : `Show ${LEVELS[depth + 1].toLowerCase()} options in ${opt}`}
          >
            <Text style={styles.opt}>{opt}</Text>
            <Icon name={depth === 3 ? "check" : "chevron-right"} size={18} color={colors.textDim} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8 },
  backBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", width: 80 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginTop: 6 },
  crumbTxt: { color: colors.textDim, fontSize: 13 },
  level: { color: colors.amber, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", paddingHorizontal: 16, marginTop: 12 },
  scroller: { flex: 1 },
  list: { padding: 16, paddingTop: 10 },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 8 },
  controlPressed: { opacity: 0.72 },
  opt: { color: colors.text, fontSize: 15 },
});
