import { createContext, forwardRef, useCallback, useContext, useMemo } from "react";
import { ScrollView as RNScrollView, FlatList as RNFlatList, TextInput as RNTextInput } from "react-native";
import { useAnimatedReaction, useAnimatedRef, useScrollOffset, useSharedValue } from "react-native-reanimated";
import useNativeTabPreview from "../hooks/useNativeTabPreview";
import { NativeLargeTitleContext, NativeTitleScrollContext } from "./NativeLargeTitle.ios";
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
    const title = useContext(NativeLargeTitleContext);
    const { collapsingTitle = false, observePageTitle = true, ...scrollProps } = props;
    const observe = !props.horizontal && !ancestor && observePageTitle && (title || collapsingTitle);
    const content = observe
      ? <TitleScroll Component={Component} scrollProps={scrollProps} forwardedRef={ref} title={title} />
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

// useScrollOffset subscribes to the native scroll node independently. Existing
// onScroll, drag, refresh, pagination and restoration handlers stay untouched.
function TitleScroll({ Component, scrollProps, forwardedRef, title, collapsable }) {
  const nativeRef = useAnimatedRef();
  const offset = useScrollOffset(nativeRef);
  const preview = useNativeTabPreview();
  const contentHeight = useSharedValue(0);
  const expandedViewport = useSharedValue(0);
  const bind = useCallback(node => {
    nativeRef(node);
    if (typeof forwardedRef === "function") return forwardedRef(node);
    if (forwardedRef) forwardedRef.current = node;
  }, [nativeRef, forwardedRef]);
  useAnimatedReaction(() => {
    if (!title || preview) return null;
    // A short list cannot sustain a full collapse as its viewport grows. Keep
    // its heading expanded instead of feeding end-of-scroll clamping back into
    // the header height. The expanded viewport excludes our own layout change.
    const fits = contentHeight.get() - expandedViewport.get() >= 2 * title.height.get();
    return fits ? Math.max(0, offset.get()) : 0;
  }, value => { if (title && value !== null) title.offset.set(value); }, [title, preview]);
  return <NativeLargeTitleContext.Provider value={null}>
    <NativeTitleScrollContext.Provider value={offset}>
      <Component {...scrollProps} ref={bind} collapsable={collapsable ?? scrollProps.collapsable} scrollEventThrottle={Math.min(scrollProps.scrollEventThrottle || 16, 16)}
        onLayout={event => {
          expandedViewport.set(Math.max(0, event.nativeEvent.layout.height - (title && !title.reserveSpace ? title.collapse.get() : 0)));
          scrollProps.onLayout?.(event);
        }}
        onContentSizeChange={(width, height) => {
          contentHeight.set(height);
          scrollProps.onContentSizeChange?.(width, height);
        }} />
    </NativeTitleScrollContext.Provider>
  </NativeLargeTitleContext.Provider>;
}
