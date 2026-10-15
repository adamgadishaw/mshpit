import { Text } from "react-native";
import { PublicPressableLink } from "./PublicWebLinks";
import { colors, focusRing, radius } from "../theme";
export default function SponsorPlaceholder() {
  return <PublicPressableLink href="/contact" accessibilityLabel="Your ad here. Contact mshpit about advertising." style={({ focused }) => [{ flexShrink: 0, minHeight: 84, margin: 12, padding: 16, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.surface }, focused && focusRing]}>
    <Text style={{ color: colors.textDim, fontSize: 14 }}>Your ad here</Text>
  </PublicPressableLink>;
}
