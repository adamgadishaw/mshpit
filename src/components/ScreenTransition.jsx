import { Platform, StyleSheet, View } from "react-native";

import useReducedMotion from "../hooks/useReducedMotion";

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

// A short, quiet entrance for each new page on the web: a small slide in the
// direction of travel (deeper pages from the right, going back from the left)
// or a soft fade for tabs. Mount it with a new `key` per page.
//
// It is a CSS animation on purpose. The page's resting state is its normal
// style, fully visible, so if the animation never runs (a busy main thread, a
// hidden tab, an old browser) the page simply shows. Nothing stays transformed
// afterwards, and reduced motion or native apps get no entrance at all.
export default function ScreenTransition({ direction = "fade", children }) {
  const reduceMotion = useReducedMotion();
  const entrance = Platform.OS === "web" && !reduceMotion ? styles[direction] || styles.fade : null;
  return <View style={[styles.fill, entrance]}>{children}</View>;
}

const entranceFrom = (from, duration) => Platform.select({
  web: {
    // String transforms: react-native-web only compiles these inside keyframes.
    animationKeyframes: [{ from: { opacity: 0, transform: from }, to: { opacity: 1, transform: "translate(0px, 0px)" } }],
    animationDuration: duration,
    animationTimingFunction: EASE_OUT,
    animationFillMode: "backwards",
  },
  default: {},
});

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  forward: entranceFrom("translate(16px, 0px)", "220ms"),
  back: entranceFrom("translate(-16px, 0px)", "220ms"),
  fade: entranceFrom("translate(0px, 6px)", "180ms"),
});
