import { Image as ExpoImage } from "expo-image";

const COMMUNITY_MARK = require("../../assets/pit-community-mark-small-v2.png");

/**
 * The shared Mshpit community mark used in small interface lockups.
 * The bundled source is an opacity mask, so one asset can follow the
 * surrounding surface without downloading or decoding a second variant.
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
