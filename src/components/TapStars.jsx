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
  return (
    <View style={{ flexDirection: "row", gap }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = value >= i + 1 ? 1 : value >= i + 0.5 ? 0.5 : 0;
        return (
          <View key={i} style={{ width: size, height: size }}>
            <OneStar size={size} fill={fill} color={color} />
            <Pressable style={{ position: "absolute", left: 0, top: 0, width: size / 2, height: size }} onPress={() => onChange?.(i + 0.5)} />
            <Pressable style={{ position: "absolute", right: 0, top: 0, width: size / 2, height: size }} onPress={() => onChange?.(i + 1)} />
          </View>
        );
      })}
    </View>
  );
}
