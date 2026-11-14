import { Component, Suspense, lazy } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, focusRing } from "../theme";
import { loadChunk } from "../lib/lazyWithRetry";
import { venuePhotoFrameHeight } from "./venuePhotoFrame.mjs";

// Photos are secondary to the show's details. A failed optional import stays
// inside this panel; retry never reloads the page or unmounts its other controls.
const createRenderer = () => lazy(() => loadChunk(() => import("./VenuePhotoWidget"), { reload: null }));

class PhotoPanelBoundary extends Component {
  state = { failed: false, Renderer: createRenderer() };
  static getDerivedStateFromError() { return { failed: true }; }
  retry = () => this.setState({ failed: false, Renderer: createRenderer() });
  render() {
    const { Renderer, failed } = this.state;
    const { height, panelProps } = this.props;
    const fallback = <View style={[styles.frame, { height }]} accessibilityLiveRegion="polite">
      <Text style={styles.label}>{failed ? "Venue photos could not load." : "Loading venue photos…"}</Text>
      {failed
        ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading venue photos" onPress={this.retry} style={({ focused }) => [styles.retry, focused && focusRing]}><Text style={styles.label}>Try again</Text></Pressable>
        : <ActivityIndicator color={colors.amber} />}
    </View>;
    return failed ? fallback : <Suspense fallback={fallback}><Renderer {...panelProps} /></Suspense>;
  }
}

export default function VenuePhotoPanel(props) {
  const { width } = useWindowDimensions();
  return <PhotoPanelBoundary height={venuePhotoFrameHeight(width, props.compact)} panelProps={props} />;
}

const styles = StyleSheet.create({
  frame: { width: "100%", minWidth: 0, borderRadius: 16, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev, alignItems: "center", justifyContent: "center", gap: 12 },
  label: { color: colors.textDim, textAlign: "center" },
  retry: { minHeight: 44, minWidth: 44, padding: 12, justifyContent: "center" },
});
