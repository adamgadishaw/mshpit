import { cloneElement, isValidElement, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { NativeFeedBackContext } from "./nativeFeedBackContext.mjs";
import { iosBackGestureAllowed } from "../domain/iosNavigationPolicy.mjs";

export default function NativeFeedMediaLayer({ obscured, frames, header, tabBar, children, media }) {
  const presented = useRef(null), live = useRef(null);
  const [owner, setOwner] = useState(null);
  const base = frames?.[0];
  // A layer mounted while covered (e.g. Back from an editor) has not retained
  // a visible Feed. It must not pretend its fresh hidden list is the old page.
  const reveal = !!obscured && !!base && presented.current === base
    && frames.length === 2 && iosBackGestureAllowed(frames[1]);
  useLayoutEffect(() => {
    if (!base || presented.current !== base) presented.current = null;
    if (!obscured && base) presented.current = base;
  }, [base, obscured]);
  useLayoutEffect(() => {
    const token = {};
    live.current = token; setOwner(token);
    return () => { if (live.current === token) live.current = null; };
  }, [frames, obscured]);
  // Hidden chrome can still have a native press queued from its visible frame.
  // Reconnection never revives that callback, and Root's predicate denies it
  // as soon as navigation starts, before this layer receives new props.
  const chrome = element => {
    if (!isValidElement(element)) return element;
    const props = {};
    for (const key of ["onMenu", "onHome", "onAccount", "onPost", "onChange"]) {
      const callback = element.props[key];
      if (typeof callback === "function") props[key] = (...args) => {
        if (!obscured && owner && live.current === owner && element.props.isCurrentSwipeRoute?.() !== false) return callback(...args);
      };
    }
    return cloneElement(element, props);
  };
  return <NativeFeedBackContext.Provider value={reveal}><View style={styles.fill}>
    <View style={[styles.fill, obscured && !reveal && styles.hidden]}
      pointerEvents={obscured ? "none" : "auto"}
      accessibilityElementsHidden={!!obscured}
      importantForAccessibility={obscured ? "no-hide-descendants" : "auto"}>
      {chrome(header)}{children}{chrome(tabBar)}
    </View>
    {obscured ? <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>{media}</View> : null}
  </View></NativeFeedBackContext.Provider>;
}
const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0 }, hidden: { opacity: 0 } });
