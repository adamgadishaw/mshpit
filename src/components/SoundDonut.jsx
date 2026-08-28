import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors, font, mono } from "../theme";

export const DONUT_PALETTE = [colors.amber, colors.cool, colors.magenta, colors.gold, colors.good, "#8F7EE0", "#5BC8C8", "#E8794B"];

const arcPath = (cx, cy, radius, start, end) => {
  const large = end - start > Math.PI ? 1 : 0;
  const x0 = cx + radius * Math.cos(start);
  const y0 = cy + radius * Math.sin(start);
  const x1 = cx + radius * Math.cos(end);
  const y1 = cy + radius * Math.sin(end);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

// A visual summary only. The adjacent labelled controls own interaction and
// accessibility, so every user gets the exact values without having to target
// a narrow SVG arc.
export default memo(function SoundDonut({
  data = [],
  size = 180,
  selected = null,
  centerTop = "Loading",
  centerSub = "genre map",
}) {
  const safeData = data
    .map((item, index) => ({
      label: String(item?.label || "").trim(),
      count: Math.max(0, Number(item?.count) || 0),
      color: item?.color || DONUT_PALETTE[index % DONUT_PALETTE.length],
    }))
    .filter((item) => item.label && item.count > 0);
  const total = safeData.reduce((sum, item) => sum + item.count, 0);
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(18, Math.round(size * 0.13));
  const activeStroke = stroke + 4;
  const radius = size / 2 - activeStroke / 2 - 4;
  const gap = safeData.length > 1 ? 0.055 : 0.012;

  const segments = useMemo(() => {
    if (!total) return [];
    let start = -Math.PI / 2;
    return safeData.map((item) => {
      const fraction = Math.min(0.9995, Math.max(0.003, item.count / total));
      const end = start + fraction * Math.PI * 2;
      const segment = {
        ...item,
        path: arcPath(cx, cy, radius, start + gap / 2, Math.max(start + gap / 2 + 0.02, end - gap / 2)),
      };
      start = end;
      return segment;
    });
  }, [cx, cy, gap, radius, safeData, total]);

  const active = segments.find((item) => item.label === selected) || null;
  return (
    <View
      style={{ width: size, height: size }}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} accessible={false}>
        <Circle cx={cx} cy={cy} r={radius} stroke={colors.lineSoft} strokeWidth={stroke} fill="none" opacity={0.8} />
        {segments.map((segment) => {
          const isActive = segment.label === selected;
          return (
            <Path
              key={segment.label}
              d={segment.path}
              stroke={segment.color}
              strokeWidth={isActive ? activeStroke : stroke}
              strokeLinecap="round"
              fill="none"
              opacity={selected && !isActive ? 0.38 : 1}
            />
          );
        })}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.top, active && { color: active.color }]} numberOfLines={2}>
          {active?.label || centerTop}
        </Text>
        <Text style={styles.sub} numberOfLines={2}>
          {active ? `${active.count.toLocaleString()} ${active.count === 1 ? "artist" : "artists"}` : centerSub}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, paddingHorizontal: 30, alignItems: "center", justifyContent: "center" },
  top: { color: colors.text, fontFamily: font, fontSize: 15, lineHeight: 18, fontWeight: "900", textAlign: "center" },
  sub: { color: colors.textFaint, fontFamily: mono, fontSize: 8.5, lineHeight: 12, letterSpacing: 0.8, marginTop: 3, textAlign: "center", textTransform: "uppercase" },
});
