import { View } from "react-native";
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop, Rect, Path, Line, Circle, Polygon, G, Text as SvgText,
} from "react-native-svg";
import { colors, mono } from "../theme";
import { haversineKm } from "../data";

// A detailed, modern dark map - generated to look like a real street network
// (road hierarchy + casing, water with a coastline, parks, named streets, a
// scale bar) but rendered in the stage-light theme. No map tiles; static. The
// venue pins are placed by real lat/lng, the streets are plausible decoration.
const W = 320;
const H = 206;
const PAD = 22;

// dark-map palette (kept on-theme: warm land, cool water, amber accents)
const M = {
  land: "#0F131C",
  park: "#16241C",
  parkLine: "#1E3326",
  water: "#0E1F31",
  waterLine: "#1C3A55",
  minor: "#262D43",
  arterialCase: "#161B29",
  arterial: "#3B445F",
  freewayCase: "#2A2114",
  freeway: "#7C5A30",
  label: "#7E869C",
};

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const STREETS = ["Market St", "Mission St", "Valencia St", "Folsom St", "Howard St", "Grand Ave", "Bay St", "Harbor Dr", "Union St", "Pine St", "Oak St", "Hill St", "Main St", "Broadway", "Cedar Ave", "Park Blvd", "Lincoln Ave", "5th Ave", "9th St", "King St"];

export default function CityMap({ points = [], highlight, label, pinLabel, showPins = true }) {
  const all = highlight ? [...points, highlight] : points;
  const coords = all.filter((p) => p && p.lat != null && p.lng != null);
  if (coords.length === 0) return null;

  let minLat = Math.min(...coords.map((p) => p.lat)), maxLat = Math.max(...coords.map((p) => p.lat));
  let minLng = Math.min(...coords.map((p) => p.lng)), maxLng = Math.max(...coords.map((p) => p.lng));
  const MIN = 0.05;
  if (maxLat - minLat < MIN) { const c = (minLat + maxLat) / 2; minLat = c - MIN / 2; maxLat = c + MIN / 2; }
  if (maxLng - minLng < MIN) { const c = (minLng + maxLng) / 2; minLng = c - MIN / 2; maxLng = c + MIN / 2; }
  const padLat = (maxLat - minLat) * 0.16, padLng = (maxLng - minLng) * 0.16;
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
  const X = (lng) => PAD + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * PAD);
  const Y = (lat) => PAD + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * PAD);
  const cLat = (minLat + maxLat) / 2;

  const rand = rng(hash(label || "city"));
  const angle = rand() * 26 - 13; // gentle rotation of the whole grid
  const SP = 17 + Math.floor(rand() * 4); // block size
  const coastX = W * (0.6 + rand() * 0.16);

  // grid lines (extended so they still cover after rotation)
  const verticals = [];
  for (let x = -120, i = 0; x <= W + 120; x += SP, i++) verticals.push({ x, major: i % 4 === 1 });
  const horizontals = [];
  for (let y = -120, i = 0; y <= H + 120; y += SP, i++) horizontals.push({ y, major: i % 4 === 2 });

  // boulevards (diagonal avenues, drawn unrotated)
  const blv = [];
  for (let i = 0; i < 2; i++) {
    const off = 40 + rand() * 120;
    blv.push(`M ${-20} ${off} L ${W + 20} ${off + (rand() * 90 - 45)}`);
  }

  // freeway: a smooth sweeping curve
  const fy = 50 + rand() * 90;
  const freeway = `M -16 ${fy} C ${W * 0.28} ${fy - 44}, ${W * 0.5} ${fy + 50}, ${W * 0.66} ${fy + 8} S ${W + 16} ${fy - 30}, ${W + 16} ${fy - 30}`;

  // coastline / water (covers roads at the shore so they appear to end at water)
  const water = `M ${W} -4 L ${coastX + 12} -4 C ${coastX - 16} ${H * 0.28}, ${coastX + 22} ${H * 0.62}, ${coastX - 6} ${H + 4} L ${W} ${H + 4} Z`;

  // parks
  const parks = [];
  for (let i = 0; i < 2; i++) {
    const pw = 34 + rand() * 30, ph = 24 + rand() * 26;
    const px = 24 + rand() * (coastX - pw - 40), py = 28 + rand() * (H - ph - 56);
    parks.push({ px, py, pw, ph });
  }

  // scale bar (real km from the projection)
  const kmAcross = haversineKm({ lat: cLat, lng: minLng }, { lat: cLat, lng: maxLng });
  const kmPerPx = kmAcross / (W - 2 * PAD);
  const barKm = Math.max(1, Math.round(kmPerPx * 52));
  const barPx = barKm / kmPerPx;

  // street labels (on land only), rotated to the grid
  const labels = [];
  const pool = [...STREETS];
  for (let i = 0; i < 6; i++) {
    const name = pool.splice(Math.floor(rand() * pool.length), 1)[0] || "Main St";
    const lx = 26 + rand() * (coastX - 70);
    const ly = 30 + rand() * (H - 64);
    labels.push({ name, lx, ly, rot: i % 3 === 2 ? angle + 90 : angle });
  }

  const hx = highlight ? X(highlight.lng) : 0;
  const hy = highlight ? Y(highlight.lat) : 0;
  const labelLeft = hx > W * 0.6; // flip pin label to stay on-canvas

  return (
    <View style={{ width: "100%", aspectRatio: W / H, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={colors.amber} stopOpacity="0.3" />
            <Stop offset="100%" stopColor={colors.amber} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="wgrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#0E2034" />
            <Stop offset="100%" stopColor="#0B1726" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width={W} height={H} fill={M.land} />

        {/* parks (under roads) */}
        {parks.map((p, i) => (
          <Rect key={`pk${i}`} x={p.px} y={p.py} width={p.pw} height={p.ph} rx="7" fill={M.park} stroke={M.parkLine} strokeWidth="1" />
        ))}

        {/* rotated street grid */}
        <G rotation={angle} originX={W / 2} originY={H / 2}>
          {verticals.map((v, i) => (
            <Line key={`v${i}`} x1={v.x} y1={-120} x2={v.x} y2={H + 120} stroke={M.minor} strokeWidth="1" />
          ))}
          {horizontals.map((h, i) => (
            <Line key={`h${i}`} x1={-120} y1={h.y} x2={W + 120} y2={h.y} stroke={M.minor} strokeWidth="1" />
          ))}
          {/* arterials: casing then road */}
          {verticals.filter((v) => v.major).map((v, i) => (
            <Line key={`vc${i}`} x1={v.x} y1={-120} x2={v.x} y2={H + 120} stroke={M.arterialCase} strokeWidth="4.5" />
          ))}
          {horizontals.filter((h) => h.major).map((h, i) => (
            <Line key={`hc${i}`} x1={-120} y1={h.y} x2={W + 120} y2={h.y} stroke={M.arterialCase} strokeWidth="4.5" />
          ))}
          {verticals.filter((v) => v.major).map((v, i) => (
            <Line key={`vr${i}`} x1={v.x} y1={-120} x2={v.x} y2={H + 120} stroke={M.arterial} strokeWidth="2.4" />
          ))}
          {horizontals.filter((h) => h.major).map((h, i) => (
            <Line key={`hr${i}`} x1={-120} y1={h.y} x2={W + 120} y2={h.y} stroke={M.arterial} strokeWidth="2.4" />
          ))}
        </G>

        {/* boulevards */}
        {blv.map((d, i) => (
          <G key={`b${i}`}>
            <Path d={d} stroke={M.arterialCase} strokeWidth="5" fill="none" strokeLinecap="round" />
            <Path d={d} stroke={M.arterial} strokeWidth="2.6" fill="none" strokeLinecap="round" />
          </G>
        ))}

        {/* freeway with dashed centerline */}
        <Path d={freeway} stroke={M.freewayCase} strokeWidth="8" fill="none" strokeLinecap="round" />
        <Path d={freeway} stroke={M.freeway} strokeWidth="5" fill="none" strokeLinecap="round" />
        <Path d={freeway} stroke="#C99A52" strokeOpacity="0.5" strokeWidth="0.8" strokeDasharray="3 4" fill="none" />

        {/* water (covers roads at the shoreline) */}
        <Path d={water} fill="url(#wgrad)" />
        <Path d={water} fill="none" stroke={M.waterLine} strokeWidth="1.4" />
        <SvgText x={Math.min(coastX + 30, W - 26)} y={H * 0.5} fill={M.waterLine} fontSize="11" fontFamily={mono} fontStyle="italic" opacity="0.9">BAY</SvgText>

        {/* street names */}
        {labels.map((l, i) => (
          <SvgText key={`l${i}`} x={l.lx} y={l.ly} fill={M.label} fontSize="7.5" fontFamily={mono} rotation={l.rot} originX={l.lx} originY={l.ly} opacity="0.92">
            {l.name}
          </SvgText>
        ))}

        {/* other venues (skipped when an interactive overlay draws the pins) */}
        {showPins && points.filter((p) => p && p.lat != null).map((p, i) => (
          <G key={`pt${i}`}>
            <Circle cx={X(p.lng)} cy={Y(p.lat)} r="3.2" fill={colors.cool} />
            <Circle cx={X(p.lng)} cy={Y(p.lat)} r="1.1" fill="#0B0E16" />
          </G>
        ))}

        {/* focal: glow + rings always; solid pin + label only when not overlaid */}
        {highlight && (
          <>
            <Circle cx={hx} cy={hy} r="46" fill="url(#glow)" />
            {[14, 24, 34].map((r, i) => (
              <Circle key={`rg${i}`} cx={hx} cy={hy} r={r} stroke={colors.amber} strokeOpacity={0.32 - i * 0.09} strokeWidth="1" fill="none" />
            ))}
            {showPins && (
              <>
                <Circle cx={hx} cy={hy} r="6.5" fill={colors.amberStrong} stroke="#0B0E16" strokeWidth="1.5" />
                <Circle cx={hx} cy={hy} r="2.3" fill="#1A1206" />
                {pinLabel ? (
                  <G>
                    <Rect x={labelLeft ? hx - 12 - pinLabel.length * 6.0 : hx + 12} y={hy - 19} width={pinLabel.length * 6.0 + 12} height="17" rx="5" fill={colors.surface} stroke={colors.line} strokeWidth="1" />
                    <SvgText x={labelLeft ? hx - 6 : hx + 18} y={hy - 7} fill={colors.text} fontSize="9" fontWeight="700" textAnchor={labelLeft ? "end" : "start"}>{pinLabel}</SvgText>
                  </G>
                ) : null}
              </>
            )}
          </>
        )}

        {/* labels + scale bar */}
        <SvgText x={PAD - 8} y={H - 12} fill={colors.textDim} fontSize="12" fontFamily={mono} fontWeight="700">{label}</SvgText>
        <Polygon points={`${W - 28},12 ${W - 24},21 ${W - 32},21`} fill={colors.amber} />
        <SvgText x={W - 28} y={31} fill={colors.textFaint} fontSize="9" fontFamily={mono} textAnchor="middle">N</SvgText>
        <G>
          <Line x1={W - 20 - barPx} y1={H - 14} x2={W - 20} y2={H - 14} stroke={colors.text} strokeWidth="1.4" />
          <Line x1={W - 20 - barPx} y1={H - 17} x2={W - 20 - barPx} y2={H - 11} stroke={colors.text} strokeWidth="1.4" />
          <Line x1={W - 20} y1={H - 17} x2={W - 20} y2={H - 11} stroke={colors.text} strokeWidth="1.4" />
          <SvgText x={W - 20 - barPx / 2} y={H - 19} fill={colors.textDim} fontSize="8" fontFamily={mono} textAnchor="middle">{barKm} km</SvgText>
        </G>
      </Svg>
    </View>
  );
}
