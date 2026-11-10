import { View } from "react-native";
// Metro's default entry deliberately adds no animation or scroll ownership.
export default function NativeLargeTitle({ children, style }) {
  return style ? <View style={style}>{children}</View> : children;
}
