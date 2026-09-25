import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { colors, radius } from "../theme";

const useNativeDriver = Platform.OS !== "web";
const SWIPE_DISTANCE = 110;
const FLING_VELOCITY = 0.6;

// A stack of cards you drag left, right or up. The same choices are always
// available as buttons through the ref (swipe("left" | "right" | "up")), so
// nobody has to drag to use it. `labels` names what each direction means.
// The parent owns the list: onSwipe must remove the answered item (and may put
// it back if saving fails), so the deck survives remounts without repeats.
// On the web, letting go of a drag also fires a click on the card, so
// renderCard gets `pressAllowed()` to tell a real tap from a drag release.
const SwipeDeck = forwardRef(function SwipeDeck({
  items,
  keyOf = (item) => item.id,
  renderCard,
  onSwipe,
  labels = { left: "Pass", right: "Yes", up: null },
  height = 460,
  reduceMotion = false,
  emptyState = null,
}, ref) {
  const { width } = useWindowDimensions();
  const position = useRef(new Animated.ValueXY()).current;
  const busy = useRef(false);
  const lastDragAt = useRef(0);
  const pressAllowed = useCallback(() => Date.now() - lastDragAt.current > 350, []);
  const latest = useRef({ items, onSwipe, labels });
  latest.current = { items, onSwipe, labels };
  const topKey = items.length ? keyOf(items[0]) : null;

  // A new top card starts centred. Resetting here, before paint, rather than
  // when the old card leaves avoids a frame of it snapping back into view.
  useLayoutEffect(() => {
    position.setValue({ x: 0, y: 0 });
    busy.current = false;
  }, [topKey, position]);

  const finish = (direction) => {
    const { items: list, onSwipe: handler } = latest.current;
    const item = list[0];
    if (!item || busy.current) return;
    busy.current = true;
    const offscreen = Math.max(width, 480) * 1.4;
    const target = direction === "up" ? { x: 0, y: -900 } : { x: direction === "right" ? offscreen : -offscreen, y: 40 };
    const done = () => handler?.(item, direction);
    if (reduceMotion) done();
    else Animated.timing(position, { toValue: target, duration: 220, useNativeDriver }).start(done);
  };

  const settle = () => Animated.spring(position, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver }).start();

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => !busy.current && (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6),
    onPanResponderGrant: () => { lastDragAt.current = Date.now(); },
    onPanResponderMove: (_, gesture) => position.setValue({ x: gesture.dx, y: gesture.dy }),
    onPanResponderRelease: (_, gesture) => {
      lastDragAt.current = Date.now();
      const { labels: current } = latest.current;
      if (current.up && (gesture.dy < -SWIPE_DISTANCE || gesture.vy < -FLING_VELOCITY) && Math.abs(gesture.dx) < SWIPE_DISTANCE) finish("up");
      else if (gesture.dx > SWIPE_DISTANCE || gesture.vx > FLING_VELOCITY) finish("right");
      else if (gesture.dx < -SWIPE_DISTANCE || gesture.vx < -FLING_VELOCITY) finish("left");
      else settle();
    },
    onPanResponderTerminate: () => { lastDragAt.current = Date.now(); settle(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [position, width]);

  useImperativeHandle(ref, () => ({
    swipe: (direction) => finish(direction),
    reset: () => { position.setValue({ x: 0, y: 0 }); busy.current = false; },
    remaining: () => latest.current.items.length,
  }));

  const visible = items.slice(0, 3);
  if (!visible.length) return <View style={[styles.deck, { height }]}>{emptyState}</View>;

  const rotate = position.x.interpolate({ inputRange: [-300, 0, 300], outputRange: ["-12deg", "0deg", "12deg"], extrapolate: "clamp" });
  const rightOpacity = position.x.interpolate({ inputRange: [20, SWIPE_DISTANCE], outputRange: [0, 1], extrapolate: "clamp" });
  const leftOpacity = position.x.interpolate({ inputRange: [-SWIPE_DISTANCE, -20], outputRange: [1, 0], extrapolate: "clamp" });
  const upOpacity = position.y.interpolate({ inputRange: [-SWIPE_DISTANCE, -20], outputRange: [1, 0], extrapolate: "clamp" });
  const nextScale = position.x.interpolate({ inputRange: [-200, 0, 200], outputRange: [1, 0.95, 1], extrapolate: "clamp" });

  return (
    <View style={[styles.deck, { height }]}>
      {visible.slice().reverse().map((item, reversedIndex) => {
        const depth = visible.length - 1 - reversedIndex;
        const top = depth === 0;
        const cardStyle = top
          ? { transform: [{ translateX: position.x }, { translateY: position.y }, { rotate: reduceMotion ? "0deg" : rotate }] }
          : { transform: [{ scale: depth === 1 ? nextScale : 0.9 }, { translateY: depth * 10 }], opacity: depth === 1 ? 1 : 0.6 };
        return (
          <Animated.View key={keyOf(item)} style={[styles.card, cardStyle]} {...(top ? responder.panHandlers : {})}
            accessibilityElementsHidden={!top} importantForAccessibility={top ? "auto" : "no-hide-descendants"} aria-hidden={!top}>
            {renderCard(item, { top, pressAllowed })}
            {top ? (
              <>
                {labels.right ? <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampRight, { opacity: rightOpacity }]}><Text style={[styles.stampText, { color: colors.good }]}>{labels.right}</Text></Animated.View> : null}
                {labels.left ? <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampLeft, { opacity: leftOpacity }]}><Text style={[styles.stampText, { color: colors.danger }]}>{labels.left}</Text></Animated.View> : null}
                {labels.up ? <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampUp, { opacity: upOpacity }]}><Text style={[styles.stampText, { color: colors.gold }]}>{labels.up}</Text></Animated.View> : null}
              </>
            ) : null}
          </Animated.View>
        );
      })}
    </View>
  );
});

export default SwipeDeck;

const styles = StyleSheet.create({
  deck: { width: "100%", maxWidth: 440, alignSelf: "center", position: "relative" },
  card: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.line,
    ...(Platform.OS === "web" ? { userSelect: "none", cursor: "grab", touchAction: "none" } : {}),
  },
  stamp: { position: "absolute", top: 28, paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 3, backgroundColor: "rgba(0,0,0,0.35)" },
  stampRight: { left: 22, borderColor: colors.good, transform: [{ rotate: "-12deg" }] },
  stampLeft: { right: 22, borderColor: colors.danger, transform: [{ rotate: "12deg" }] },
  stampUp: { alignSelf: "center", left: "30%", right: "30%", top: "40%", borderColor: colors.gold, alignItems: "center" },
  stampText: { fontSize: 24, fontWeight: "900", letterSpacing: 1 },
});
