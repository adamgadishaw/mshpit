import { forwardRef, useContext, useMemo } from "react";
import { ScrollView as RNScrollView, FlatList as RNFlatList, TextInput as RNTextInput } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { NativeTabSwipeContext } from "./nativeTabSwipeContext.mjs";
import NativeTabSwipeExclusion from "./NativeTabSwipeExclusion";
function scroll(Component) {
  return forwardRef(function TabScroll(props, ref) {
    const scope = useContext(NativeTabSwipeContext);
    const native = useMemo(() => scope ? Gesture.Native().simultaneousWithExternalGesture(scope.gesture) : null, [scope?.gesture]);
    const content = <Component {...props} ref={ref} />;
    if (!native) return content;
    if (props.horizontal) return <NativeTabSwipeExclusion asChild>{content}</NativeTabSwipeExclusion>;
    return <GestureDetector gesture={native}>{content}</GestureDetector>;
  });
}
export const ScrollView = scroll(RNScrollView);
export const FlatList = scroll(RNFlatList);

export const TextInput = forwardRef(function TabInput(props, ref) {
  return <NativeTabSwipeExclusion asChild><RNTextInput {...props} ref={ref} /></NativeTabSwipeExclusion>;
});
