import Component from "./PostMediaGrid.jsx";
import NativeTabSwipeExclusion from "./NativeTabSwipeExclusion";
export default function PostMediaGrid(props) {
  return <NativeTabSwipeExclusion><Component {...props} /></NativeTabSwipeExclusion>;
}
