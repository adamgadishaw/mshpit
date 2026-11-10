import { View } from "react-native";

// Compatibility for existing page layouts. Large headings are ordinary
// content again: no offset subscription, measurement, clipping or animation.
export function NativeLargeTitleProvider({ children }) { return children; }
export default function NativeLargeTitle({ children, style, containerStyle }) {
  if (!style && !containerStyle) return children;
  return <View style={containerStyle}><View style={style}>{children}</View></View>;
}
