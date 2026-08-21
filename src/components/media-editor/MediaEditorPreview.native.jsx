import { useMemo, useState } from "react";
import { Image as NativeImage, StyleSheet, Text, View } from "react-native";
import {
  Canvas,
  ColorMatrix,
  FractalNoise,
  Group,
  Image as SkiaImage,
  RadialGradient,
  Rect,
  useImage,
  vec,
} from "@shopify/react-native-skia";
import { defaultMediaEdit, effectiveAdjustments, mediaPreviewTransformPlan } from "../../domain/mediaEdit.mjs";
import { buildMediaColorMatrix } from "../../lib/mediaEditColor.mjs";
import { colors, radius } from "../../theme";
import MediaEditorVideoPreview from "./MediaEditorVideoPreview";

function NativePhotoPreview({ asset, edit, showOriginal, renderedPreview }) {
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const [loadError, setLoadError] = useState(false);
  const image = useImage(asset.uri, () => setLoadError(true));
  const recipe = showOriginal ? defaultMediaEdit("image") : edit;
  const adjustments = effectiveAdjustments(recipe);
  const matrix = useMemo(() => buildMediaColorMatrix(adjustments), [adjustments]);
  const width = Math.max(1, layout.width);
  const height = Math.max(1, layout.height);
  const plan = mediaPreviewTransformPlan({ width: asset.width, height: asset.height, edit: recipe, viewportWidth: width, viewportHeight: height });
  const turn = plan.edit.rotation * Math.PI / 180;
  const rotatedOffset = plan.edit.rotation === 90
    ? { x: asset.height, y: 0 }
    : plan.edit.rotation === 180
      ? { x: asset.width, y: asset.height }
      : plan.edit.rotation === 270
        ? { x: 0, y: asset.width }
        : { x: 0, y: 0 };
  const hasDetailedExportEffects = Math.abs(adjustments.highlights) > 0.0001
    || Math.abs(adjustments.shadows) > 0.0001
    || adjustments.sharpen > 0.0001;

  return (
    <View
      style={styles.fill}
      onLayout={(event) => setLayout(event.nativeEvent.layout)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={asset.altText || "Photo editing preview"}
    >
      {showOriginal || renderedPreview?.uri ? (
        <NativeImage source={{ uri: showOriginal ? asset.uri : renderedPreview.uri }} resizeMode="contain" style={styles.fill} />
      ) : (
      <Canvas style={styles.fill}>
        <Group clip={{ x: 0, y: 0, width, height }}>
          <Group transform={[{ translateX: -plan.crop.originX * plan.scaleX }, { translateY: -plan.crop.originY * plan.scaleY }]}>
            <Group transform={[{ scaleX: plan.scaleX }, { scaleY: plan.scaleY }]}>
              <Group transform={plan.edit.flipX ? [{ translateX: plan.rotated.width }] : []}>
                <Group transform={plan.edit.flipX ? [{ scaleX: -1 }] : []}>
                  <Group transform={[{ translateX: rotatedOffset.x }, { translateY: rotatedOffset.y }]}>
                    <Group transform={turn ? [{ rotate: turn }] : []}>
                      <SkiaImage image={image} x={0} y={0} width={asset.width} height={asset.height} fit="fill">
                        <ColorMatrix matrix={matrix} />
                      </SkiaImage>
                    </Group>
                  </Group>
                </Group>
              </Group>
            </Group>
          </Group>
        </Group>
        {!showOriginal && adjustments.vignette > 0.0001 ? (
          <Rect x={0} y={0} width={width} height={height}>
            <RadialGradient
              c={vec(width / 2, height / 2)}
              r={Math.hypot(width, height) / 2}
              colors={["rgba(0,0,0,0)", "rgba(0,0,0,0)", `rgba(0,0,0,${adjustments.vignette})`]}
              positions={[0, 0.42, 1]}
            />
          </Rect>
        ) : null}
        {!showOriginal && adjustments.grain > 0.0001 ? (
          <Group blendMode="softLight" opacity={Math.min(0.3, adjustments.grain * 0.72)}>
            <Rect x={0} y={0} width={width} height={height}>
              <FractalNoise freqX={0.32} freqY={0.32} octaves={1} seed={41} tileWidth={width} tileHeight={height} />
            </Rect>
          </Group>
        ) : null}
      </Canvas>
      )}
      {loadError ? <Text style={styles.message}>This photo could not be decoded.</Text> : null}
      {!showOriginal && hasDetailedExportEffects && !renderedPreview?.uri ? <Text style={styles.exportBadge}>Rendering exact preview...</Text> : null}
    </View>
  );
}

export default function MediaEditorPreview({ asset, edit, showOriginal, resolvedCover, renderedPreview }) {
  if (asset.kind === "video") return <MediaEditorVideoPreview asset={asset} edit={edit} showOriginal={showOriginal} resolvedCover={resolvedCover} />;
  return <NativePhotoPreview asset={asset} edit={edit} showOriginal={showOriginal} renderedPreview={renderedPreview} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, width: "100%", minHeight: 0, backgroundColor: "#030409", overflow: "hidden" },
  message: { position: "absolute", alignSelf: "center", top: "45%", color: colors.textDim, fontSize: 13 },
  exportBadge: { position: "absolute", left: 10, bottom: 10, color: colors.text, backgroundColor: "rgba(7,9,15,0.82)", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, fontSize: 10, fontWeight: "800" },
});
