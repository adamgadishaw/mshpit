import Svg, { Path, Polyline, Polygon, G, Defs, RadialGradient, Stop, Text as SvgText } from "react-native-svg";
import { View, Text, StyleSheet } from "react-native";
import { colors, mono, radius } from "../theme";

// Pit badge system — high-quality "clip art" seals, drawn (no emoji, no glyph
// stand-ins; same house style as Icon.jsx). A scalloped verification seal for
// official accounts, a gold star medallion for Top-100 artists. One component,
// many meanings — driven by `type`.
//
//   <Badge type="verified" size={18} />
//   <Badge type="top100" size={18} />
//   <BadgeRow badges={["verified","top100"]} />   // laid out inline after a name

// --- Build the scalloped seal outline once (a smooth closed spline through
// alternating outer/inner radii → the classic "verified" wavy disc). ---
function sealPath(bumps = 11, ro = 11.5, ri = 9.7, cx = 12, cy = 12) {
  const pts = [];
  const n = bumps * 2;
  for (let j = 0; j < n; j++) {
    const r = j % 2 === 0 ? ro : ri;
    const a = (j / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  // Catmull-Rom → cubic bezier, closed.
  const N = pts.length;
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + "Z";
}
const SEAL = sealPath();
const STAR = "12 6.2 13.7 10.2 18 10.5 14.7 13.3 15.7 17.5 12 15.2 8.3 17.5 9.3 13.3 6 10.5 10.3 10.2 12 6.2";

// type → seal color + inner glyph. Colors come from the theme so every preset
// keeps the badges on-brand.
function config(type) {
  switch (type) {
    case "top100": return { fill: colors.gold, edge: "#7A5A12", glyph: "star", tip: "Top 100 artist" };
    case "rank1": return { fill: colors.gold, edge: "#7A5A12", glyph: "num", num: "1", tip: "#1 this week" };
    case "rank2": return { fill: "#C7CDD6", edge: "#6E7784", glyph: "num", num: "2", tip: "#2 this week" };
    case "rank3": return { fill: "#D08A55", edge: "#7A4A22", glyph: "num", num: "3", tip: "#3 this week" };
    case "staff": return { fill: colors.magenta, edge: "#5E1633", glyph: "check", tip: "Pit team" };
    case "mod": return { fill: colors.good, edge: "#14512F", glyph: "check", tip: "Moderator" };
    case "founder": return { fill: colors.amberStrong, edge: "#6B3410", glyph: "check", tip: "Founder" };
    case "artist":
    case "verified":
    default: return { fill: colors.cool, edge: "#123A6B", glyph: "check", tip: "Verified" };
  }
}

function Glyph({ c }) {
  if (c.glyph === "check")
    return <Polyline points="7.6 12.4 10.6 15.3 16.4 8.9" fill="none" stroke="#ffffff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />;
  if (c.glyph === "num")
    return <SvgText x="12" y="16.3" fontSize="12" fontWeight="900" fill="#ffffff" textAnchor="middle">{c.num}</SvgText>;
  return <Polygon points={STAR} fill="#ffffff" />;
}

export default function Badge({ type = "verified", size = 18 }) {
  const c = config(type);
  const gid = `bg_${type}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        {/* soft top-lit sheen so the seal reads glossy, not flat */}
        <RadialGradient id={gid} cx="42%" cy="34%" r="72%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <Stop offset="0.45" stopColor="#ffffff" stopOpacity="0.06" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0.14" />
        </RadialGradient>
      </Defs>
      <Path d={SEAL} fill={c.fill} stroke={c.edge} strokeWidth="0.8" strokeLinejoin="round" />
      <Path d={SEAL} fill={`url(#${gid})`} />
      <Glyph c={c} />
    </Svg>
  );
}

// A row of badges to drop in after a name. Accepts badge type strings.
export function BadgeRow({ badges = [], size = 16, style }) {
  if (!badges.length) return null;
  return (
    <View style={[styles.row, style]}>
      {badges.map((b) => <Badge key={b} type={b} size={size} />)}
    </View>
  );
}

// An optional labelled chip (badge + word) for headers where there's room to
// spell it out — "VERIFIED", "TOP 100".
export function BadgeChip({ type, label, size = 16 }) {
  const c = config(type);
  return (
    <View style={[styles.chip, { borderColor: c.fill }]}>
      <Badge type={type} size={size} />
      <Text style={[styles.chipTxt, { color: c.fill }]}>{label || c.tip}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 3 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingLeft: 6, paddingRight: 11, paddingVertical: 5 },
  chipTxt: { fontSize: 9.5, letterSpacing: 1.1, fontWeight: "800", fontFamily: mono },
});
