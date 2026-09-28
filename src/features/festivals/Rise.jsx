import { Platform, StyleSheet, View } from "react-native";
import useReducedMotion from "../../hooks/useReducedMotion";

// Cards and lineup rows rise into place one after another when the page
// opens. The resting style is fully visible, so if the animation never runs
// the content simply shows; reduced motion and native apps skip it.
export default function Rise({ index = 0, style, children }) {
  const reduceMotion = useReducedMotion();
  const motion = Platform.OS === "web" && !reduceMotion
    ? [styles.rise, { animationDelay: `${Math.min(Math.max(0, index), 12) * 60}ms` }]
    : null;
  return <View style={[style, motion]}>{children}</View>;
}

const styles = StyleSheet.create({
  rise: Platform.select({
    web: {
      animationKeyframes: [{ from: { opacity: 0, transform: "translate(0px, 14px) scale(0.98)" }, to: { opacity: 1, transform: "translate(0px, 0px) scale(1)" } }],
      animationDuration: "420ms",
      animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
      animationFillMode: "backwards",
    },
    default: {},
  }),
});
