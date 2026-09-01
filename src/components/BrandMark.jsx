import { Image as ExpoImage } from "expo-image";

const COMMUNITY_MARK = require("../../assets/pit-community-mark-small-v2.png");

/**
 * The one Mshpit community mark used throughout interface lockups. This is a
 * smaller raster of the exact two-ring master, never a simplified glyph. Its
 * opacity mask can follow the surrounding surface without a second variant.
 */
export default function BrandMark({
  size = 32,
  color = "#FFFFFF",
  style,
  accessible = false,
  accessibilityLabel = "Mshpit",
  ...imageProps
}) {
  return (
    <ExpoImage
      {...imageProps}
      source={COMMUNITY_MARK}
      style={[{ width: size, height: size }, style]}
      contentFit="contain"
      tintColor={color}
      accessible={accessible}
      accessibilityLabel={accessible ? accessibilityLabel : undefined}
    />
  );
}
