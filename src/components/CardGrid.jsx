import { useState } from "react";
import { View } from "react-native";

// Responsive grid that measures its OWN width (not the window) and flows children
// into as many columns as fit at `minColWidth`. Falls back to a single column on
// narrow widths, so it reads as a clean list on mobile and organized columns on
// desktop. Keeps the site legible as the artist/venue/event lists grow large.
export default function CardGrid({ children, minColWidth = 240, gap = 12, style }) {
  const [w, setW] = useState(0);
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  const cols = w ? Math.max(1, Math.floor((w + gap) / (minColWidth + gap))) : 1;
  const cellW = cols > 1 ? (w - gap * (cols - 1)) / cols : "100%";
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ flexDirection: "row", flexWrap: "wrap", gap }, style]}
    >
      {items.map((child, i) => (
        <View key={child?.key ?? i} style={{ width: cellW }}>{child}</View>
      ))}
    </View>
  );
}
