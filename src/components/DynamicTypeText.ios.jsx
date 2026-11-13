import { Text, useWindowDimensions } from "react-native";

// RN 0.86's retained paragraphs can keep a measurement from the previous
// Dynamic Type scale. A new empty inline span gives Fabric changed children,
// invalidating that measurement without replacing the paragraph or its content.
// The span adds no glyphs; native scaling, selection, refs and pressables remain
// owned by the original Text and its callers. Do not key the page or controls.
export default function DynamicTypeText({ children, ...props }) {
  const { fontScale } = useWindowDimensions();
  return <Text {...props}>{children}<Text key={fontScale} accessible={false} /></Text>;
}
