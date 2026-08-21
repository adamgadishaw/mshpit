import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { defaultMediaEdit, effectiveAdjustments, mediaPreviewTransformPlan } from "../../domain/mediaEdit.mjs";
import { colors, radius } from "../../theme";
import MediaEditorVideoPreview from "./MediaEditorVideoPreview";

function cssFilter(adjustments) {
  const brightness = Math.max(0.5, 1 + adjustments.brightness);
  const contrast = Math.max(0.5, 1 + adjustments.contrast);
  const saturation = Math.max(0, 1 + adjustments.saturation);
  const warmth = Math.abs(adjustments.warmth) * 0.28;
  const hue = adjustments.tint * 24 + (adjustments.warmth < 0 ? -adjustments.warmth * 12 : 0);
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation}) sepia(${warmth}) hue-rotate(${hue}deg)`;
}

function WebPhotoPreview({ asset, edit, showOriginal, renderedPreview }) {
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const recipe = showOriginal ? defaultMediaEdit("image") : edit;
  const adjustments = effectiveAdjustments(recipe);
  const plan = mediaPreviewTransformPlan({
    width: asset.width,
    height: asset.height,
    edit: recipe,
    viewportWidth: layout.width,
    viewportHeight: layout.height,
  });
  const detailed = Math.abs(adjustments.highlights) > 0.0001
    || Math.abs(adjustments.shadows) > 0.0001
    || adjustments.sharpen > 0.0001
    || adjustments.grain > 0.0001
    || adjustments.vignette > 0.0001;
  return (
    <View
      style={styles.fill}
      onLayout={(event) => setLayout(event.nativeEvent.layout)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={asset.altText || "Photo editing preview"}
    >
      {!showOriginal && renderedPreview?.uri ? (
        <Image source={{ uri: renderedPreview.uri }} resizeMode="contain" style={styles.originalImage} />
      ) : <Image
        source={{ uri: asset.uri }}
        resizeMode={showOriginal ? "contain" : "stretch"}
        style={[
          showOriginal ? styles.originalImage : styles.image,
          !showOriginal && {
            width: asset.width,
            height: asset.height,
            transformOrigin: [0, 0, 0],
            filter: showOriginal ? "none" : cssFilter(adjustments),
            transform: [{ matrix: plan.matrix }],
          },
        ]}
      />}
      {!showOriginal && detailed && !renderedPreview?.uri ? <Text style={styles.exportBadge}>Rendering exact preview...</Text> : null}
    </View>
  );
}

export default function MediaEditorPreview({ asset, edit, showOriginal, resolvedCover, renderedPreview }) {
  if (asset.kind === "video") return <MediaEditorVideoPreview asset={asset} edit={edit} showOriginal={showOriginal} resolvedCover={resolvedCover} />;
  return <WebPhotoPreview asset={asset} edit={edit} showOriginal={showOriginal} renderedPreview={renderedPreview} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, width: "100%", minHeight: 0, backgroundColor: "#030409", overflow: "hidden" },
  image: { position: "absolute", left: 0, top: 0 },
  originalImage: { width: "100%", height: "100%" },
  exportBadge: { position: "absolute", left: 10, bottom: 10, color: colors.text, backgroundColor: "rgba(7,9,15,0.82)", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, fontSize: 10, fontWeight: "800" },
});
