import { useId } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Polygon, RadialGradient, Rect, Stop } from "react-native-svg";
import useReducedMotion from "../../hooks/useReducedMotion";

// A festival poster background: the festival's two-colour gel over a dark
// stage, two soft spotlights and, for heroes, two light beams that sweep
// slowly. On the web the motion is CSS, so it costs nothing when nothing
// moves; reduced motion and native apps get the still picture.
export default function FestivalBackdrop({ accent, beams = false, still = false }) {
  const reduceMotion = useReducedMotion();
  const moving = !still && !reduceMotion && Platform.OS === "web";
  const id = `fb${useId().replace(/[^a-zA-Z0-9]/gu, "")}`;
  const [from, to] = accent;
  return <View style={styles.fill} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
    <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="#0B0A10" />
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}g)`} opacity={0.62} />
    </Svg>
    <Spot id={`${id}a`} color={from} style={[styles.spot, styles.spotA, moving && styles.driftA]} />
    <Spot id={`${id}b`} color={to} style={[styles.spot, styles.spotB, moving && styles.driftB]} />
    {beams ? <>
      <View style={[styles.pivot, styles.pivotLeft, moving && styles.sweepLeft]}><Beam id={`${id}l`} /></View>
      <View style={[styles.pivot, styles.pivotRight, moving && styles.sweepRight]}><Beam id={`${id}r`} /></View>
    </> : null}
    <View style={styles.scrim} />
  </View>;
}

function Spot({ id, color, style }) {
  return <View style={style}>
    <Svg width="100%" height="100%">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={0.9} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  </View>;
}

// A cone of light hanging from a zero-size pivot, so rotating the pivot
// swings the beam from its top.
function Beam({ id }) {
  return <View style={styles.beam}>
    <Svg width="100%" height="100%" viewBox="0 0 120 520" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.34} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Polygon points="54,0 66,0 120,520 0,520" fill={`url(#${id})`} />
    </Svg>
  </View>;
}

const loop = (frames, duration) => Platform.select({
  web: {
    // String transforms: react-native-web only compiles these inside keyframes.
    animationKeyframes: [frames],
    animationDuration: duration,
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
  },
  default: {},
});

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  spot: { position: "absolute", width: 360, height: 360 },
  spotA: { top: -150, left: -110 },
  spotB: { bottom: -170, right: -120 },
  driftA: loop({ from: { transform: "translate(0px, 0px) scale(1)" }, to: { transform: "translate(70px, 40px) scale(1.18)" } }, "9s"),
  driftB: loop({ from: { transform: "translate(0px, 0px) scale(1.1)" }, to: { transform: "translate(-80px, -30px) scale(0.92)" } }, "11s"),
  pivot: { position: "absolute", top: -12, width: 0, height: 0, transform: [{ rotate: "0deg" }] },
  pivotLeft: { left: "24%", transform: [{ rotate: "-14deg" }] },
  pivotRight: { right: "22%", transform: [{ rotate: "16deg" }] },
  sweepLeft: loop({ from: { transform: "rotate(-26deg)" }, to: { transform: "rotate(10deg)" } }, "7s"),
  sweepRight: loop({ from: { transform: "rotate(24deg)" }, to: { transform: "rotate(-12deg)" } }, "8.5s"),
  beam: { position: "absolute", top: 0, left: -60, width: 120, height: 520 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(6,6,10,0.28)" },
});
