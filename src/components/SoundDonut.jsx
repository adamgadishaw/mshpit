import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Text, View, StyleSheet } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors, mono } from "../theme";

const web = Platform.OS === "web";
export const DONUT_PALETTE = [colors.amber, colors.blue, colors.magenta, colors.gold, colors.good, "#8f7ee0", "#5bc8c8"];

const arcPath = (cx, cy, rad, start, end) => {
  const large = end - start > Math.PI ? 1 : 0;
  const x0 = cx + rad * Math.cos(start), y0 = cy + rad * Math.sin(start);
  const x1 = cx + rad * Math.cos(end), y1 = cy + rad * Math.sin(end);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rad} ${rad} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

// The springy candy-segment donut from Discover, made reusable. Feed it counts;
// it draws rounded-cap arcs with a soft gap, pops in with a bouncy scale, and
// tapping a slice highlights it (glow + center label) like the Discover pie.
export default memo(function SoundDonut({ data = [], size = 180, centerTop, centerSub }) {
  const cx = size / 2, cy = size / 2;
  const STROKE = 22, R = size / 2 - STROKE / 2 - 6;
  const GAP = 0.06;
  const total = data.reduce((s, d) => s + (d.count || 0), 0) || 1;
  const [active, setActive] = useState(null);

  const grow = useRef(new Animated.Value(0)).current;
  const sig = data.map((d) => `${d.label}:${d.count}`).join("|");
  useEffect(() => {
    grow.setValue(0);
    Animated.timing(grow, { toValue: 1, duration: 520, easing: Easing.out(Easing.back(1.4)), useNativeDriver: !web }).start();
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const scale = grow.interpolate({ inputRange: [0, 1], outputRange: [0.84, 1] });

  const segs = useMemo(() => {
    let a0 = -Math.PI / 2;
    return data.map((d, i) => {
      const frac = Math.min(0.9999, Math.max(0.004, (d.count || 0) / total));
      const a1 = a0 + frac * Math.PI * 2;
      const s = a0 + GAP / 2, e = Math.max(a0 + GAP / 2 + 0.02, a1 - GAP / 2);
      const seg = { label: d.label, count: d.count, color: DONUT_PALETTE[i % DONUT_PALETTE.length], d: arcPath(cx, cy, R, s, e), a0, a1 };
      a0 = a1;
      return seg;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, size]);

  // Hover highlights (web): one mousemove on the container, hit-tested by angle
  // and radius, because the SVG library only forwards click. Slices light up as
  // the cursor sweeps the ring, no clicking needed; touch still taps.
  const onMouseMove = web ? (e) => {
    const node = e.currentTarget;
    if (!node?.getBoundingClientRect) return;
    const rect = node.getBoundingClientRect();
    const me = e.nativeEvent || e;
    const dx = me.clientX - (rect.left + rect.width / 2);
    const dy = me.clientY - (rect.top + rect.height / 2);
    const r = Math.hypot(dx, dy);
    if (r < R - STROKE || r > R + STROKE) { setActive(null); return; }
    let a = Math.atan2(dy, dx);
    while (a < -Math.PI / 2) a += Math.PI * 2;
    const hit = segs.find((s) => a >= s.a0 && a <= s.a1);
    setActive(hit ? hit.label : null);
  } : undefined;
  const onMouseLeave = web ? () => setActive(null) : undefined;

  const activeSeg = segs.find((s) => s.label === active);
  return (
    <Animated.View style={{ width: size, height: size, opacity: grow, transform: [{ scale }] }} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={R} stroke={colors.bgElev} strokeWidth={STROKE} fill="none" opacity={0.5} />
        {segs.map((s, i) => {
          const on = s.label === active;
          const dim = active && !on;
          return (
            <Path
              key={s.label + i}
              d={s.d}
              stroke={s.color}
              strokeWidth={on ? STROKE + 6 : STROKE}
              strokeLinecap="round"
              fill="none"
              opacity={dim ? 0.35 : 1}
              onPress={() => setActive((cur) => (cur === s.label ? null : s.label))}
              style={web ? { cursor: "pointer", transformOrigin: "50% 50%", transform: on ? "scale(1.08)" : "scale(1)", transition: "transform .32s cubic-bezier(.34,1.56,.64,1), stroke-width .22s, opacity .22s", filter: on ? `drop-shadow(0 0 7px ${s.color})` : "none" } : null}
            />
          );
        })}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.num, activeSeg && { color: activeSeg.color, fontSize: 17 }]} numberOfLines={1}>
          {activeSeg ? activeSeg.label : centerTop}
        </Text>
        <Text style={styles.sub}>{activeSeg ? `${activeSeg.count} ${activeSeg.count === 1 ? "play" : "plays"}` : centerSub}</Text>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  num: { color: colors.text, fontFamily: mono, fontSize: 24, fontWeight: "900" },
  sub: { color: colors.textFaint, fontSize: 10.5, letterSpacing: 1, marginTop: 2, textTransform: "uppercase" },
});
