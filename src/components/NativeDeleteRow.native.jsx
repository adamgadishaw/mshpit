import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { colors } from "../theme";
import useScreenReaderEnabled from "../hooks/useScreenReaderEnabled";

// Only the owner's management list opts in. Swiping reveals a button; the
// existing confirmation and delete API remain the only path to deletion.
export default function NativeDeleteRow({ children, style, enabled = false, onDelete, testID }) {
  const swipeable = useRef(null), screenReader = useScreenReaderEnabled();
  const content = <View testID={testID} style={style}>{children}</View>;
  if (!enabled || screenReader) return content;
  return <ReanimatedSwipeable ref={swipeable} rightThreshold={72} overshootRight={false}
    dragOffsetFromRightEdge={24} hitSlop={{ left: -24, right: -24 }}
    renderRightActions={() => <Pressable style={styles.action} accessibilityRole="button" accessibilityLabel="Delete your post"
      onPress={() => { swipeable.current?.close(); onDelete?.(); }}>
      <Text style={styles.label}>Delete</Text>
    </Pressable>}>
    {content}
  </ReanimatedSwipeable>;
}
const styles = StyleSheet.create({ action: { width: 96, minHeight: 48, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" }, label: { color: "#fff", fontSize: 16, fontWeight: "600" } });
