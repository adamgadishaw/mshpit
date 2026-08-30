import { Children } from "react";
import { StyleSheet, View } from "react-native";

// Browser refresh belongs to the browser itself. Keep the platform-specific
// boundary transparent so shared screens can use the native pull-to-refresh
// contract without adding a second refresh owner on web.
export function VinylRefreshIndicator() {
  return null;
}

export default function VinylRefreshBoundary({ children, style, testID }) {
  const child = Children.only(children);

  return (
    <View style={[styles.boundary, style]} testID={testID}>
      {child}
    </View>
  );
}

const styles = StyleSheet.create({
  boundary: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
});
