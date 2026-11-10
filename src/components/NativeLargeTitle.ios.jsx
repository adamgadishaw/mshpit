import { createContext, useContext, useMemo } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue } from "react-native-reanimated";
import useReducedMotion from "../hooks/useReducedMotion";
import useScreenReaderEnabled from "../hooks/useScreenReaderEnabled";

export const NativeLargeTitleContext = createContext(null);
export const NativeTitleScrollContext = createContext(null);

// One owner per page. Scroll panes keep their own offsets; only the selected
// pane publishes here, so returning to a retained filter restores its heading.
export function NativeLargeTitleProvider({ children, reserveSpace = false }) {
  const offset = useSharedValue(0);
  const height = useSharedValue(0);
  const reader = useScreenReaderEnabled();
  const collapse = useDerivedValue(() => reader ? 0 : Math.min(height.get(), Math.max(0, offset.get())));
  const value = useMemo(() => ({ offset, height, collapse, reserveSpace }), [offset, height, collapse, reserveSpace]);
  return <NativeLargeTitleContext.Provider value={value}>{children}</NativeLargeTitleContext.Provider>;
}

export default function NativeLargeTitle({ children, style, containerStyle, inFlow = false }) {
  const owner = useContext(NativeLargeTitleContext);
  const scroll = useContext(NativeTitleScrollContext);
  const ownHeight = useSharedValue(0);
  const reduced = useReducedMotion();
  const reader = useScreenReaderEnabled();
  const motion = useAnimatedStyle(() => {
    const height = ownHeight.get();
    const displacement = reader ? 0 : inFlow ? Math.max(0, scroll?.get() || 0) : owner?.collapse.get() || 0;
    const progress = height > 0 ? Math.min(1, displacement / height) : 0;
    return {
      ...(!inFlow && !owner?.reserveSpace && height > 0 ? { height: reader ? height : Math.max(0, height - displacement) } : {}),
      // Reduced Motion retains the direct scroll/layout response, without an
      // additional fade or parallax movement. VoiceOver retains its heading.
      opacity: reduced || reader ? 1 : 1 - progress,
      transform: [{ translateY: reduced || reader ? 0 : -8 * progress }],
    };
  });
  return <Animated.View style={[{ overflow: "hidden", flexShrink: 0 }, containerStyle, motion]}>
    <View style={[{ flexShrink: 0 }, style]} onLayout={event => {
      const measured = event.nativeEvent.layout.height;
      if (!(measured > 0)) return;
      ownHeight.set(measured);
      if (!inFlow) owner?.height.set(measured);
    }}>{children}</View>
  </Animated.View>;
}
