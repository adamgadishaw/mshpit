import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";

import {
  PORTAL_HOLD_MS,
  PORTAL_INNER_FIGURES,
  PORTAL_OPEN_MS,
  PORTAL_OUTER_FIGURES,
  PORTAL_SPEED_INPUT,
  PORTAL_SPIN_MS,
  PORTAL_TURNS,
  PORTAL_VIEWBOX,
} from "../domain/landingPortal.mjs";

const useNativeDriver = Platform.OS !== "web";
const INK = "#F4EFE7";

function Ring({ items, size }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${PORTAL_VIEWBOX} ${PORTAL_VIEWBOX}`}>
      {items.map((figure) => (
        <G key={figure.key} transform={figure.transform}>
          <Circle cx={0} cy={figure.headY} r={figure.headR} fill={INK} />
          <Path d={figure.body} fill={INK} />
        </G>
      ))}
    </Svg>
  );
}

// The community mark as a portal, drawn exactly as the logo and nothing else.
// The outer ring turns clockwise while the inner ring turns the other way; each
// run is ten whole turns, so both come to rest upright and hold still long
// enough to read before reversing. It sits above the headline, never over the
// photos, and stays still with Reduce Motion.
export default function LandingPortalMark({ size = 160, animate = true, style }) {
  const turns = useRef(new Animated.Value(0)).current;
  const open = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) {
      open.setValue(1);
      return undefined;
    }
    const easing = Easing.inOut(Easing.sin);
    const opening = Animated.timing(open, { toValue: 1, duration: PORTAL_OPEN_MS, easing: Easing.out(Easing.back(1.4)), useNativeDriver });
    const spin = Animated.loop(Animated.sequence([
      Animated.timing(turns, { toValue: PORTAL_TURNS, duration: PORTAL_SPIN_MS, easing, useNativeDriver }),
      Animated.delay(PORTAL_HOLD_MS),
      Animated.timing(turns, { toValue: 0, duration: PORTAL_SPIN_MS, easing, useNativeDriver }),
      Animated.delay(PORTAL_HOLD_MS),
    ]));
    opening.start();
    spin.start();
    return () => {
      opening.stop();
      spin.stop();
    };
  }, [animate, open, turns]);

  const degrees = PORTAL_TURNS * 360;
  const outerRotate = turns.interpolate({ inputRange: [0, PORTAL_TURNS], outputRange: ["0deg", `${degrees}deg`] });
  const innerRotate = turns.interpolate({ inputRange: [0, PORTAL_TURNS], outputRange: ["0deg", `-${degrees}deg`] });
  // A light fade at full speed softens the strobe any fast-turning pattern has
  // on a 60 Hz screen; at every stop the logo is fully solid.
  const speedFade = turns.interpolate({ inputRange: PORTAL_SPEED_INPUT, outputRange: [1, 0.6, 0.6, 1], extrapolate: "clamp" });
  const layer = [StyleSheet.absoluteFill, styles.noPointer];

  return (
    <Animated.View
      pointerEvents="none"
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        { width: size, height: size },
        style,
        {
          opacity: open.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
          transform: [{ scale: open.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
        },
      ]}
    >
      <Animated.View style={[layer, { opacity: speedFade, transform: [{ rotate: outerRotate }] }]}>
        <Ring items={PORTAL_OUTER_FIGURES} size={size} />
      </Animated.View>
      <Animated.View style={[layer, { opacity: speedFade, transform: [{ rotate: innerRotate }] }]}>
        <Ring items={PORTAL_INNER_FIGURES} size={size} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  noPointer: { pointerEvents: "none" },
});
