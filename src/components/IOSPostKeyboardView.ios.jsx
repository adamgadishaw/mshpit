import { useLayoutEffect, useRef, useState } from "react";
import { AppState, Dimensions, Keyboard, View, useWindowDimensions } from "react-native";

// Post's full-size outer frame is the keyboard owner. Its native bounds do not
// shrink when padding changes. RN 0.86 KAV does not recalculate on offset-only
// changes, so measure the real window bounds instead of assuming a safe-area,
// verification-banner or player height. RN's iOS keyboard coordinates are also
// converted to this window by RCTKeyboardObserver.
export default function IOSPostKeyboardView({ children, style, ...props }) {
  const view = useRef(null);
  const measure = useRef(() => {});
  const [bottom, setBottom] = useState(0);
  const appliedBottom = useRef(0);
  useWindowDimensions(); // Rotation, split-view resizing and Dynamic Type.

  useLayoutEffect(() => {
    let alive = true;
    let active = AppState.currentState === "active";
    let frame = active ? Keyboard.metrics() : null;
    let generation = 0;
    const update = (next, event) => {
      if (!alive || appliedBottom.current === next) return;
      appliedBottom.current = next;
      if (event) Keyboard.scheduleLayoutAnimation(event);
      setBottom(next);
    };
    const inspect = (event) => {
      const request = ++generation;
      const target = view.current;
      if (!alive || !active || !frame) { update(0, event); return; }
      target?.measureInWindow((x, y, width, height) => {
        if (!alive || !active || request !== generation || target !== view.current) return;
        const window = Dimensions.get("window");
        const k = frame;
        // Only a docked keyboard owns bottom space. Hardware/floating keyboards
        // and iOS cross-fade's zero-Y metrics must not collapse the screen.
        const valid = k && [x, y, width, height, k.screenX, k.screenY, k.width, k.height, window.height].every(Number.isFinite);
        const docked = valid && width > 0 && height > 0 && k.height > 0 && k.screenY > 0
          && k.screenX <= x && k.screenX + k.width >= x + width
          && k.screenY + k.height >= window.height - 1;
        update(docked ? Math.min(height, Math.max(0, y + height - k.screenY)) : 0, event);
      });
    };
    measure.current = () => inspect();
    const show = (event) => {
      if (!alive || !active || event.isEventFromThisApp === false) return;
      frame = event.endCoordinates;
      inspect(event);
    };
    const hide = (event) => { frame = null; generation++; update(0, event); };
    const subscriptions = [
      Keyboard.addListener("keyboardWillShow", show),
      Keyboard.addListener("keyboardDidShow", show),
      // Ignore frame changes after hide (including undocking), as KAV does.
      Keyboard.addListener("keyboardWillChangeFrame", event => { if (frame) show(event); }),
      Keyboard.addListener("keyboardWillHide", hide),
      Keyboard.addListener("keyboardDidHide", hide),
      AppState.addEventListener("change", state => {
        active = state === "active";
        frame = active ? Keyboard.metrics() : null;
        inspect();
      }),
    ];
    inspect();
    return () => {
      alive = false;
      generation++;
      measure.current = () => {};
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, []);

  // An ancestor can move without changing this view's local layout. Check on
  // parent renders as well as native layout, without replacing any descendants.
  useLayoutEffect(() => { measure.current(); });
  return <View {...props} ref={view} collapsable={false} onLayout={() => measure.current()} style={[style, { paddingBottom: bottom }]}>{children}</View>;
}
