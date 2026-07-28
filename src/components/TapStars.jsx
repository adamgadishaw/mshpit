import { View, Pressable } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { colors } from "../theme";

const STAR = "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2";

function OneStar({ size, fill, color }) {
  // fill is 0, 0.5 or 1
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24"><Polygon points={STAR} fill={colors.line} /></Svg>
      {fill > 0 && (
        <View style={{ position: "absolute", top: 0, left: 0, width: size * fill, height: size, overflow: "hidden" }}>
          <Svg width={size} height={size} viewBox="0 0 24 24"><Polygon points={STAR} fill={color} /></Svg>
        </View>
      )}
    </View>
  );
}

// Tap a star to rate. Tap the left half for a half-star, right half for a full
// one. No plus/minus buttons. value is 0-5 in 0.5 steps.
export default function TapStars({ value = 0, onChange, size = 40, gap = 8, color = colors.gold }) {
  const width = size * 5 + gap * 4;
  const choose = (event) => {
    const native = event?.nativeEvent || {};
    let rawX = Number(native.locationX ?? native.offsetX);
    if (!Number.isFinite(rawX)) {
      const rect = event?.currentTarget?.getBoundingClientRect?.();
      const clientX = Number(native.clientX);
      const pageX = Number(native.pageX);
      if (rect && Number.isFinite(clientX)) rawX = clientX - rect.left;
      else if (rect && Number.isFinite(pageX)) rawX = pageX - (rect.left + (globalThis.scrollX || 0));
    }
    // Keyboard/synthetic activation has no pointer coordinate. Keep its current
    // position; screen readers use the explicit increment/decrement actions.
    if (!Number.isFinite(rawX)) rawX = (Math.max(0.5, value || 0.5) / 5) * width;
    const x = Math.max(0, Math.min(width - 1, rawX));
    const index = Math.min(4, Math.floor(x / (size + gap)));
    const within = x - index * (size + gap);
    onChange?.(index + (within < size / 2 ? 0.5 : 1));
  };
  const adjust = (direction) => onChange?.(Math.max(0, Math.min(5, value + (direction === "increment" ? 0.5 : -0.5))));
  return (
    <Pressable
      style={{ width, minHeight: 44, justifyContent: "center" }}
      onPress={choose}
      accessibilityRole="adjustable"
      accessibilityLabel="Rating"
      accessibilityValue={{ min: 0, max: 5, now: value, text: `${value} out of 5 stars` }}
      accessibilityActions={[{ name: "increment", label: "Increase rating" }, { name: "decrement", label: "Decrease rating" }]}
      onAccessibilityAction={(event) => adjust(event.nativeEvent.actionName)}
    >
      <View pointerEvents="none" style={{ flexDirection: "row", gap }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = value >= i + 1 ? 1 : value >= i + 0.5 ? 0.5 : 0;
          return <OneStar key={i} size={size} fill={fill} color={color} />;
        })}
      </View>
    </Pressable>
  );
}
