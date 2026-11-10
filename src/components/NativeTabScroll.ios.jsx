import { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ScrollView as RNScrollView, FlatList as RNFlatList, TextInput as RNTextInput, StyleSheet } from "react-native";
import { useAnimatedReaction, useAnimatedRef, useScrollOffset, useSharedValue } from "react-native-reanimated";
import useNativeTabPreview from "../hooks/useNativeTabPreview";
import { NativeScrollChromeContext } from "./NativeScrollChrome.ios";
import { advanceScrollChrome, scrollChromeState } from "../domain/iosScrollChrome.mjs";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { NativeTabSwipeContext } from "./nativeTabSwipeContext.mjs";
import NativeTabSwipeExclusion, { useNativeTabSwipeExclusionGesture } from "./NativeTabSwipeExclusion";

// A nested UIScrollView needs its own Native handler. Relating only the page
// pan to the outer vertical scroll leaves the inner horizontal native pan
// outside RNGH arbitration and can leave its Pressable child handling release.
const NativeScrollContext = createContext(null);
function scroll(Component) {
  return forwardRef(function TabScroll(props, ref) {
    const scope = useContext(NativeTabSwipeContext);
    const ancestor = useContext(NativeScrollContext);
    const native = useMemo(() => scope ? Gesture.Native()
      .simultaneousWithExternalGesture(scope.gesture, ...[ancestor].filter(Boolean)) : null, [scope?.gesture, ancestor]);
    const observer = useNativeTabSwipeExclusionGesture({ enabled: !!props.horizontal, nativeGesture: native, ancestorGesture: ancestor });
    const composed = useMemo(() => native && observer ? Gesture.Simultaneous(native, observer) : native, [native, observer]);
    const chrome = useContext(NativeScrollChromeContext);
    const { collapsingTitle = false, observePageTitle = true, observeScrollChrome = observePageTitle, ...scrollProps } = props;
    const observe = !props.horizontal && !ancestor && observeScrollChrome && chrome;
    const content = observe
      ? <ChromeScroll Component={Component} scrollProps={scrollProps} forwardedRef={ref} chrome={chrome} />
      : <Component {...scrollProps} ref={ref} />;
    if (!native) return content;
    return <NativeScrollContext.Provider value={native}>
      <GestureDetector gesture={composed}>{content}</GestureDetector>
    </NativeScrollContext.Provider>;
  });
}
export const ScrollView = scroll(RNScrollView);
export const FlatList = scroll(RNFlatList);

export const TextInput = forwardRef(function TabInput(props, ref) {
  return <NativeTabSwipeExclusion asChild><RNTextInput {...props} ref={ref} /></NativeTabSwipeExclusion>;
});

// Native offset observation does not replace the screen's onScroll callback.
// Only a primary scroll owns the overlay inset and direction detector.
function ChromeScroll({ Component, scrollProps, forwardedRef, chrome, collapsable }) {
  const nativeRef = useAnimatedRef();
  const offset = useScrollOffset(nativeRef);
  const preview = useNativeTabPreview();
  const contentHeight = useSharedValue(0);
  const viewport = useSharedValue(0);
  const generation = useSharedValue(0);
  const serial = useRef(0);
  const [admission, setAdmission] = useState(null);
  const momentumExpected = useRef(false);
  const interactive = useSharedValue(false);
  const state = useSharedValue(scrollChromeState());
  const token = useRef({});
  const presentation = useRef(null);
  const owner = useMemo(() => ({}), [chrome.owner, preview]);
  useLayoutEffect(() => {
    if (preview) return;
    return chrome.register(token.current);
  }, [preview, chrome.register]);
  useLayoutEffect(() => {
    const entry = { owner, id: ++serial.current };
    presentation.current = entry;
    setAdmission(entry);
    momentumExpected.current = false;
    interactive.set(false);
    state.set(scrollChromeState(offset.get(), true));
    generation.set(!preview && chrome.active ? entry.id : -entry.id);
    if (!preview && chrome.active) chrome.shown.set(true);
    return () => { if (presentation.current === entry) { presentation.current = null; generation.set(-entry.id); interactive.set(false); momentumExpected.current = false; } };
  }, [owner, preview, chrome.active]);
  const accepts = () => admission && presentation.current === admission && admission.owner === owner && !preview && chrome.active;
  const bind = useCallback(node => {
    nativeRef(node);
    if (typeof forwardedRef === "function") {
      const cleanup = forwardedRef(node);
      if (typeof cleanup === "function") return () => { nativeRef(null); cleanup(); };
    } else if (forwardedRef) forwardedRef.current = node;
  }, [nativeRef, forwardedRef]);
  const admittedId = admission?.owner === owner ? admission.id : 0;
  const { admitted, shown } = chrome;
  useAnimatedReaction(() => {
    if (!admittedId || generation.get() !== admittedId || !admitted.get()) return null;
    return { y: offset.get(), max: contentHeight.get() - viewport.get(), interactive: interactive.get() };
  }, sample => {
    if (!sample || !admittedId || generation.get() !== admittedId || !admitted.get()) return;
    const next = advanceScrollChrome(state.get(), sample.y, sample.max, sample.interactive);
    state.set(next);
    if (shown.get() !== next.shown) shown.set(next.shown);
  }, [admittedId]);
  const style = StyleSheet.flatten(scrollProps.contentContainerStyle) || {};
  const top = style.paddingTop ?? style.paddingVertical ?? style.padding ?? 0;
  const begin = event => {
    if (accepts()) {
      state.set(scrollChromeState(event.nativeEvent.contentOffset.y, chrome.shown.get()));
      momentumExpected.current = false;
      interactive.set(true);
    }
    scrollProps.onScrollBeginDrag?.(event);
  };
  return <NativeScrollChromeContext.Provider value={null}>
    <Component {...scrollProps} ref={bind} collapsable={collapsable ?? scrollProps.collapsable}
      contentContainerStyle={[scrollProps.contentContainerStyle, { paddingTop: chrome.height + (typeof top === "number" ? top : 0) }]}
      scrollIndicatorInsets={{ ...scrollProps.scrollIndicatorInsets, top: chrome.height + (scrollProps.scrollIndicatorInsets?.top || 0) }}
      scrollEventThrottle={Math.min(scrollProps.scrollEventThrottle || 16, 16)}
      onScrollBeginDrag={begin}
      onScrollEndDrag={event => {
        if (accepts()) {
          const native = event.nativeEvent;
          momentumExpected.current = Math.abs(native.velocity?.y || 0) > 0.01
            || Math.abs((native.targetContentOffset?.y ?? native.contentOffset.y) - native.contentOffset.y) > 1;
          interactive.set(momentumExpected.current);
        }
        scrollProps.onScrollEndDrag?.(event);
      }}
      onMomentumScrollBegin={event => { if (accepts()) interactive.set(momentumExpected.current); scrollProps.onMomentumScrollBegin?.(event); }}
      onMomentumScrollEnd={event => { if (accepts()) { interactive.set(false); momentumExpected.current = false; } scrollProps.onMomentumScrollEnd?.(event); }}
      onLayout={event => {
        if (presentation.current?.owner === owner) {
          const height = event.nativeEvent.layout.height;
          state.set(scrollChromeState(Math.min(Math.max(0, contentHeight.get() - height), Math.max(0, offset.get())), shown.get()));
          viewport.set(height);
        }
        scrollProps.onLayout?.(event);
      }}
      onContentSizeChange={(width, height) => {
        if (presentation.current?.owner === owner) {
          state.set(scrollChromeState(Math.min(Math.max(0, height - viewport.get()), Math.max(0, offset.get())), shown.get()));
          contentHeight.set(height);
        }
        scrollProps.onContentSizeChange?.(width, height);
      }} />
  </NativeScrollChromeContext.Provider>;
}
