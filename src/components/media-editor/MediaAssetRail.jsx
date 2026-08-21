import { AccessibilityInfo, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, focusRing, radius, space } from "../../theme";
import { mediaAltTextCompletion, mediaAltTextState } from "../../domain/media-alt-text.mjs";
import Icon from "../Icon";

export default function MediaAssetRail({ assets, selectedId, onSelect, onMove, onRemove }) {
  if (!assets?.length) return null;
  const completion = mediaAltTextCompletion(assets);
  const completionPercent = completion.progress == null ? 0 : Math.round(completion.progress * 100);
  const selectedIndex = Math.max(0, assets.findIndex((asset) => asset.id === selectedId));
  const selected = assets[selectedIndex];
  const moveSelected = (toIndex) => {
    if (!selected || toIndex < 0 || toIndex >= assets.length) return;
    onMove?.(selected.id, toIndex);
    AccessibilityInfo.announceForAccessibility?.(`${selected.kind === "video" ? "Video" : "Photo"} moved to ${toIndex + 1} of ${assets.length}`);
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>MEDIA ORDER</Text>
        {assets.length > 1 && selected ? (
          <View style={styles.orderActions}>
            <Pressable
              onPress={() => {
                onRemove?.(selected.id);
                AccessibilityInfo.announceForAccessibility?.(`${selected.kind === "video" ? "Video" : "Photo"} removed. ${assets.length - 1} media items remain.`);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Remove selected ${selected.kind}`}
              style={({ pressed, focused }) => [styles.orderButton, styles.removeButton, pressed && styles.pressed, focused && focusRing]}
            ><Icon name="trash" size={15} color={colors.danger} /></Pressable>
            <Pressable
              onPress={() => moveSelected(selectedIndex - 1)}
              disabled={selectedIndex === 0}
              accessibilityRole="button"
              accessibilityLabel={`Move selected ${selected.kind} earlier`}
              accessibilityState={{ disabled: selectedIndex === 0 }}
              style={({ pressed, focused }) => [styles.orderButton, selectedIndex === 0 && styles.disabled, pressed && styles.pressed, focused && focusRing]}
            ><Icon name="chevron-left" size={15} color={colors.text} /></Pressable>
            <Pressable
              onPress={() => moveSelected(selectedIndex + 1)}
              disabled={selectedIndex === assets.length - 1}
              accessibilityRole="button"
              accessibilityLabel={`Move selected ${selected.kind} later`}
              accessibilityState={{ disabled: selectedIndex === assets.length - 1 }}
              style={({ pressed, focused }) => [styles.orderButton, selectedIndex === assets.length - 1 && styles.disabled, pressed && styles.pressed, focused && focusRing]}
            ><Icon name="chevron-right" size={15} color={colors.text} /></Pressable>
          </View>
        ) : selected ? (
          <Pressable
            onPress={() => onRemove?.(selected.id)}
            accessibilityRole="button"
            accessibilityLabel={`Remove selected ${selected.kind}`}
            style={({ pressed, focused }) => [styles.orderButton, styles.removeButton, pressed && styles.pressed, focused && focusRing]}
          ><Icon name="trash" size={15} color={colors.danger} /></Pressable>
        ) : null}
      </View>
      {completion.photos > 0 ? (
        <View style={styles.descriptionSummary}>
          <View style={styles.descriptionSummaryRow}>
            <Text style={styles.descriptionLabel}>ALT TEXT · {completion.label.toUpperCase()}</Text>
            {completion.tracked > 0 ? <Text style={styles.descriptionPercent}>{completionPercent}%</Text> : null}
          </View>
          {completion.tracked > 0 ? (
            <View
              style={styles.descriptionTrack}
              accessibilityRole="progressbar"
              accessibilityLabel="Photo description completion"
              accessibilityValue={{ min: 0, max: completion.tracked, now: completion.completed, text: completion.label }}
            >
              <View style={[styles.descriptionFill, { width: `${completionPercent}%` }]} />
            </View>
          ) : null}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {assets.map((asset, index) => {
          const selected = asset.id === selectedId;
          const source = asset.kind === "video" ? asset.posterUri : asset.uri;
          const altTextState = mediaAltTextState(asset);
          const altTextLabel = altTextState === "complete"
            ? "Alt text added"
            : altTextState === "missing"
              ? "Alt text not added"
              : altTextState === "optional"
                ? "Alt text optional for this decorative or older photo"
                : "";
          return (
            <Pressable
              key={asset.id}
              onPress={() => onSelect(asset.id)}
              accessibilityRole="tab"
              accessibilityLabel={`${asset.kind === "video" ? "Video" : "Photo"} ${index + 1} of ${assets.length}${altTextLabel ? `. ${altTextLabel}` : ""}`}
              accessibilityState={{ selected }}
              style={({ pressed, focused }) => [styles.item, selected && styles.itemSelected, pressed && styles.pressed, focused && focusRing]}
            >
              {source ? (
                <Image source={{ uri: source }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.placeholder]}>
                  <Icon name={asset.kind === "video" ? "play" : "photo"} size={20} color={colors.textDim} />
                </View>
              )}
              <View style={[styles.badge, selected && styles.badgeSelected]}>
                <Text style={[styles.badgeText, selected && styles.badgeTextSelected]}>{index + 1}</Text>
              </View>
              {asset.kind === "video" ? (
                <View style={styles.videoMark}><Icon name="play" size={10} color="#fff" /></View>
              ) : (
                <View style={[styles.descriptionMark, altTextState === "complete" && styles.descriptionMarkComplete, altTextState === "optional" && styles.descriptionMarkOptional]}>
                  <Icon name={altTextState === "complete" ? "check" : altTextState === "optional" ? "minus" : "comment"} size={10} color={altTextState === "complete" ? "#07120A" : "#fff"} />
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: space(2), gap: space(1) },
  header: { minHeight: 44, paddingHorizontal: space(4), flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  label: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  descriptionSummary: { paddingHorizontal: space(4), gap: 6 },
  descriptionSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  descriptionLabel: { flex: 1, color: colors.textFaint, fontFamily: displayFont, fontSize: 8.5, fontWeight: "900", letterSpacing: 0.7 },
  descriptionPercent: { color: colors.amber, fontFamily: displayFont, fontSize: 9, fontWeight: "900" },
  descriptionTrack: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  descriptionFill: { height: "100%", borderRadius: 3, backgroundColor: colors.good },
  orderActions: { flexDirection: "row", gap: space(1) },
  orderButton: { width: 44, height: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceAlt },
  disabled: { opacity: 0.35 },
  removeButton: { borderColor: colors.danger },
  content: { paddingHorizontal: space(4), paddingBottom: space(2), gap: space(2) },
  item: { width: 68, height: 68, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", padding: 2, position: "relative", overflow: "hidden" },
  itemSelected: { borderColor: colors.amber },
  thumb: { width: "100%", height: "100%", borderRadius: 8, backgroundColor: colors.surfaceAlt },
  placeholder: { alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.72 },
  badge: { position: "absolute", left: 5, top: 5, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(7,9,15,0.78)", alignItems: "center", justifyContent: "center" },
  badgeSelected: { backgroundColor: colors.amberStrong },
  badgeText: { color: "#fff", fontFamily: displayFont, fontSize: 10, fontWeight: "900" },
  badgeTextSelected: { color: "#1A1206" },
  videoMark: { position: "absolute", right: 6, bottom: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(7,9,15,0.82)", alignItems: "center", justifyContent: "center" },
  descriptionMark: { position: "absolute", right: 6, bottom: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(164,105,42,0.94)", alignItems: "center", justifyContent: "center" },
  descriptionMarkComplete: { backgroundColor: colors.good },
  descriptionMarkOptional: { backgroundColor: "rgba(7,9,15,0.82)" },
});
