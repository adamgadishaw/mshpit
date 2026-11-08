import { createContext, forwardRef, useContext, useMemo } from "react";
import { ScrollView as RNScrollView, FlatList as RNFlatList, TextInput as RNTextInput } from "react-native";
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
    const content = <Component {...props} ref={ref} />;
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
