import { View } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { colors } from "../theme";

const STAR = "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2";

function StarShape({ size, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points={STAR} fill={color} />
    </Svg>
  );
}

// Clipped half-star rating row, drawn (no ★ glyph).
export default function Stars({ value = 0, size = 16, color = colors.gold, gap = 2 }) {
  return (
    <View style={{ flexDirection: "row" }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <View key={i} style={{ width: size, height: size, marginRight: gap }}>
            <StarShape size={size} color={colors.line} />
            {fill > 0 && (
              <View style={{ position: "absolute", top: 0, left: 0, width: size * fill, height: size, overflow: "hidden" }}>
                <StarShape size={size} color={color} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
