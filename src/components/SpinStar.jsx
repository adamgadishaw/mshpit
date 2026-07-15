import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { colors } from "../theme";

const STAR = "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2";

// A collectible-style twirling star: the star spins on its vertical axis like a
// coin, faked with a scaleX squash (rotateY needs real 3D, which RN web lacks).
// Drawn from our own star polygon, gold body with a darker edge, so it reads as
// the app's star, not anyone else's.
export default function SpinStar({ size = 44, spinning = true }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spinning) { t.setValue(0); return; }
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, t]);

  // A full twirl: wide -> edge-on -> wide (mirrored) -> edge-on -> wide. The
  // brief edge-on flashes are what sell the 3D turn.
  const scaleX = t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0.12, -1, -0.12, 1] });
  const glow = t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0.55, 1, 0.55, 1] });

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ transform: [{ scaleX }], opacity: glow }}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Polygon points={STAR} fill={colors.gold} stroke={colors.amberStrong} strokeWidth={1.1} strokeLinejoin="round" />
          <Polygon points="12 5 13.7 8.9 18 9.6 12 9.3 8 9.6 10.3 8.9 12 5" fill="rgba(255,255,255,0.35)" />
        </Svg>
      </Animated.View>
    </View>
  );
}
