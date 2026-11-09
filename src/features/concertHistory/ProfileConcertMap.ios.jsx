import Map from "./ProfileConcertMapView.ios.jsx";
import NativeTabSwipeExclusion from "../../components/NativeTabSwipeExclusion";
export default function ProfileConcertMap(props) {
  return <NativeTabSwipeExclusion><Map {...props} /></NativeTabSwipeExclusion>;
}
