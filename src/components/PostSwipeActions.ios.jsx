import Component from "./RetainedPostSwipeActions.ios.jsx";
import NativeTabSwipeExclusion from "./NativeTabSwipeExclusion";
export default function PostSwipeActions(props) {
  if (!props.enabled) return props.children;
  return <NativeTabSwipeExclusion><Component {...props} /></NativeTabSwipeExclusion>;
}
