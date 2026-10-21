import { Component, lazy, Suspense } from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "../../theme";
import LegacyMap from "./DiscoverVenueMapLegacy";

const MapLibreVenueMap = lazy(() => import("./MapLibreVenueMap.web"));
class VenueMapBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <View style={{ minHeight:180,padding:24,backgroundColor:colors.surface }} accessibilityRole="alert"><Text style={{color:colors.textDim}}>The map is unavailable. Every venue is still in the list below.</Text><Pressable accessibilityRole="button" onPress={()=>window.location.reload()} style={{minHeight:44,justifyContent:"center"}}><Text style={{color:colors.amber}}>Reload map preview</Text></Pressable></View> : this.props.children;
  }
}
export default function DiscoverVenueMap(props) {
  if (process.env.EXPO_PUBLIC_WEB_MAP_RENDERER !== "maplibre") return <LegacyMap {...props} />;
  return <VenueMapBoundary><Suspense fallback={<View style={{ minHeight: 180, padding: 24, backgroundColor: colors.surface }}><Text style={{ color: colors.textDim }}>Loading venue map. Venue details remain available below.</Text></View>}><MapLibreVenueMap {...props} /></Suspense></VenueMapBoundary>;
}
