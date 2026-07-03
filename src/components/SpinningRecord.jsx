import { useRef, useEffect } from "react";
import { Animated, Easing, Image, View } from "react-native";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { colors } from "../theme";

// A little vinyl that spins while a snippet "plays". The centre label shows the
// artist's photo / cover art when we have it, otherwise a music note. Colour
// marks Treble (amber, top pick) vs Bass (magenta, underdog pick).
export default function SpinningRecord({ size = 64, playing = false, color = colors.amberStrong, art = null }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let anim;
    if (playing) {
      spin.setValue(0);
      anim = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true }));
      anim.start();
    }
    return () => anim?.stop();
  }, [playing]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const labelR = size * 0.2;

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate }] }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx="50" cy="50" r="49" fill="#0A0A0C" stroke={colors.line} strokeWidth="1" />
        {[44, 38, 32, 26].map((r) => (
          <Circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#17181E" strokeWidth="1" />
        ))}
        <Circle cx="50" cy="50" r="20" fill={color} />
        {!art && (
          <>
            {/* eighth note */}
            <Ellipse cx="45" cy="58" rx="6.5" ry="5" fill="#1A1206" transform="rotate(-20 45 58)" />
            <Path d="M51 56 L51 40" stroke="#1A1206" strokeWidth="2.6" strokeLinecap="round" />
            <Path d="M51 40 C56 41, 58 45, 57 49" stroke="#1A1206" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          </>
        )}
        <Circle cx="50" cy="50" r="3.5" fill="#0A0A0C" />
        {/* notch so the spin reads */}
        <Circle cx="50" cy="11" r="2.2" fill={colors.bg} />
      </Svg>
      {art && (
        <>
          <Image source={{ uri: art }} style={{ position: "absolute", width: labelR * 2, height: labelR * 2, borderRadius: labelR, top: size / 2 - labelR, left: size / 2 - labelR }} />
          <View style={{ position: "absolute", width: size * 0.07, height: size * 0.07, borderRadius: size, backgroundColor: "#0A0A0C", top: size / 2 - size * 0.035, left: size / 2 - size * 0.035 }} />
        </>
      )}
    </Animated.View>
  );
}
