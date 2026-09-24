import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";

import useReducedMotion from "../hooks/useReducedMotion";
import { colors, displayFont, font } from "../theme";
import Icon from "./Icon";

const useNativeDriver = Platform.OS !== "web";

// The finished card rises out of a slot with a slight tilt, settles, and then
// catches one sweep of light, like a ticket leaving the printer. With Reduce
// Motion on it simply appears.
export default function ShareCardReveal({ children, style }) {
  const reduceMotion = useReducedMotion();
  const rise = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const sheen = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      rise.setValue(1);
      sheen.setValue(1);
      return undefined;
    }
    rise.setValue(0);
    sheen.setValue(0);
    const animation = Animated.sequence([
      Animated.spring(rise, { toValue: 1, friction: 7, tension: 52, useNativeDriver }),
      Animated.timing(sheen, { toValue: 1, duration: 950, easing: Easing.out(Easing.cubic), useNativeDriver }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, rise, sheen]);

  const cardMotion = {
    opacity: rise.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
    transform: [
      { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [72, 0] }) },
      { rotate: rise.interpolate({ inputRange: [0, 1], outputRange: ["-5deg", "0deg"] }) },
      { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1], extrapolate: "clamp" }) },
    ],
  };
  const sheenMotion = {
    opacity: sheen.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }),
    transform: [
      { translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-260, 420] }) },
      { rotate: "16deg" },
    ],
  };

  return (
    <Animated.View style={[style, cardMotion]}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.sheen, sheenMotion]}>
        <View style={[styles.sheenBand, styles.sheenSoft]} />
        <View style={[styles.sheenBand, styles.sheenBright]} />
        <View style={[styles.sheenBand, styles.sheenSoft]} />
      </Animated.View>
    </Animated.View>
  );
}

// While the server draws the card, show the outline of a ticket with a slow
// pulse instead of a spinner, so the wait looks like the thing being made.
export function ShareCardPrinting({ unavailable = false }) {
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (unavailable || reduceMotion) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver }),
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, unavailable]);

  return (
    <View style={styles.printing}>
      <Animated.View style={[styles.printingPhoto, { opacity: pulse }]}>
        <Icon name={unavailable ? "x" : "photo"} size={26} color={colors.textFaint} />
      </Animated.View>
      <Animated.View style={[styles.printingLine, styles.printingLineWide, { opacity: pulse }]} />
      <Animated.View style={[styles.printingLine, { opacity: pulse }]} />
      <View style={styles.printingTear} />
      <Text style={styles.printingBrand}>MSHPIT</Text>
      <Text style={styles.printingCopy}>
        {unavailable ? "The card isn’t available yet." : "Making your card…"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheen: { position: "absolute", top: "-20%", bottom: "-20%", left: 0, width: 150, flexDirection: "row" },
  sheenBand: { flex: 1 },
  sheenSoft: { backgroundColor: "rgba(255,255,255,0.07)" },
  sheenBright: { backgroundColor: "rgba(255,255,255,0.16)" },
  printing: { flex: 1, padding: 18, gap: 12, borderWidth: 1, borderColor: colors.line },
  printingPhoto: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.surface },
  printingLine: { width: "46%", height: 12, borderRadius: 6, backgroundColor: colors.surface },
  printingLineWide: { width: "72%", height: 18 },
  printingTear: { marginTop: 6, borderTopWidth: 2, borderStyle: "dashed", borderColor: colors.line },
  printingBrand: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900", letterSpacing: 4 },
  printingCopy: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 18 },
});
