import Panel from "./DiscoverPhotoPanel.jsx";
import NativeTabSwipeExclusion from "../../components/NativeTabSwipeExclusion";
export default function DiscoverPhotoPanel(props) {
  return <NativeTabSwipeExclusion><Panel {...props} /></NativeTabSwipeExclusion>;
}
