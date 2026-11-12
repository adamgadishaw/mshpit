import { View } from "react-native";
import { PageTitle } from "./PageReturnContext";

// Compatibility for existing page layouts. Large headings are ordinary
// content again: no offset subscription, measurement, clipping or animation.
export function NativeLargeTitleProvider({ children }) { return children; }
export default function NativeLargeTitle({ children, style, containerStyle, label }) {
  const text = children?.props?.children;
  return <PageTitle label={label || (typeof text === "string" ? text : "Page")} style={containerStyle}>
    {style ? <View style={style}>{children}</View> : children}
  </PageTitle>;
}
