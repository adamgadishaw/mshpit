import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MEDIA_ASPECTS, MEDIA_FILTERS } from "../../domain/mediaEdit.mjs";
import { mediaAltTextGuidance } from "../../domain/media-alt-text.mjs";
import { colors, displayFont, focusRing, mono, radius, space } from "../../theme";
import Icon from "../Icon";
import { CapabilityNotice, ControlChip, InspectorSection, LabeledSlider } from "./MediaEditorControls";

const PHOTO_TABS = [
  { id: "crop", label: "Crop", icon: "photo" },
  { id: "adjust", label: "Adjust", icon: "edit" },
  { id: "filters", label: "Filters", icon: "camera" },
  { id: "accessibility", label: "Alt text", icon: "comment" },
];

const VIDEO_TABS = [
  { id: "cover", label: "Cover", icon: "camera" },
  { id: "accessibility", label: "Description", icon: "comment" },
];

const ASPECT_LABELS = {
  original: "Original",
  square: "Square",
  portrait: "Portrait",
  story: "Story",
  landscape: "Wide",
};

const ADJUSTMENTS = [
  ["brightness", "Brightness", -0.5, 0.5],
  ["contrast", "Contrast", -0.5, 0.5],
  ["highlights", "Highlights", -0.5, 0.5],
  ["shadows", "Shadows", -0.5, 0.5],
  ["saturation", "Saturation", -1, 1],
  ["warmth", "Warmth", -0.5, 0.5],
  ["tint", "Tint", -0.5, 0.5],
  ["fade", "Fade", 0, 0.5],
  ["vignette", "Vignette", 0, 0.7],
  ["grain", "Grain", 0, 0.35],
  ["sharpen", "Sharpen", 0, 0.5],
];

const FILTER_ACCENTS = {
  original: colors.textDim,
  pit: colors.amberStrong,
  encore: colors.gold,
  neon: colors.magenta,
  midnight: colors.cool,
  analog: "#C58A62",
  mono: "#C8CBD2",
};

const signedPercent = (value) => `${value > 0 ? "+" : ""}${Math.round(value * 100)}`;
const percent = (value) => `${Math.round(value * 100)}%`;
const timecode = (milliseconds) => {
  const total = Math.max(0, Math.round((Number(milliseconds) || 0) / 100));
  const seconds = Math.floor(total / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${total % 10}`;
};

function Tabs({ asset, activeTab, onTabChange }) {
  const tabs = asset.kind === "video" ? VIDEO_TABS : PHOTO_TABS;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} keyboardShouldPersistTaps="handled" accessibilityRole="tablist">
      {tabs.map((tab) => (
        <Pressable
          key={tab.id}
          onPress={() => onTabChange(tab.id)}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === tab.id }}
          style={({ pressed, focused }) => [styles.tab, activeTab === tab.id && styles.tabSelected, pressed && styles.pressed, focused && focusRing]}
        >
          <Icon name={tab.icon} size={16} color={activeTab === tab.id ? colors.amber : colors.textDim} />
          <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextSelected]}>{tab.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function CropPanel({ edit, onEditChange, onSeal }) {
  return (
    <>
      <InspectorSection title="Frame" detail="Pick a publishing shape. PIT keeps the original pixels outside the frame until export.">
        <View style={styles.wrapRow}>
          {Object.keys(MEDIA_ASPECTS).map((aspect) => (
            <ControlChip key={aspect} label={ASPECT_LABELS[aspect]} selected={edit.aspect === aspect} onPress={() => onEditChange({ aspect })} />
          ))}
        </View>
      </InspectorSection>
      <InspectorSection title="Position" detail="Drag the preview to reframe and pinch to zoom, or use the precise sliders below.">
        <LabeledSlider label="Zoom" value={edit.zoom} minimumValue={1} maximumValue={3} step={0.01} formatValue={(value) => `${value.toFixed(2)}×`} onValueChange={(value) => onEditChange({ zoom: value }, "zoom")} onSlidingComplete={onSeal} />
        <LabeledSlider label="Horizontal focus" value={edit.focalX} minimumValue={0} maximumValue={1} step={0.01} formatValue={percent} onValueChange={(value) => onEditChange({ focalX: value }, "focal-x")} onSlidingComplete={onSeal} />
        <LabeledSlider label="Vertical focus" value={edit.focalY} minimumValue={0} maximumValue={1} step={0.01} formatValue={percent} onValueChange={(value) => onEditChange({ focalY: value }, "focal-y")} onSlidingComplete={onSeal} />
        <View style={styles.wrapRow}>
          <ControlChip label={`Rotate ${edit.rotation}°`} icon="shuffle" onPress={() => onEditChange({ rotation: (edit.rotation + 90) % 360 })} accessibilityLabel="Rotate photo clockwise 90 degrees" />
          <ControlChip label="Mirror" icon="shuffle" selected={edit.flipX} onPress={() => onEditChange({ flipX: !edit.flipX })} accessibilityLabel="Mirror photo horizontally" />
        </View>
      </InspectorSection>
    </>
  );
}

function AdjustPanel({ edit, onAdjustmentChange, onSeal }) {
  return (
    <InspectorSection title="Light and color" detail="Manual changes layer on top of the selected filter and remain reversible in the recipe.">
      {ADJUSTMENTS.map(([key, label, minimumValue, maximumValue]) => (
        <LabeledSlider
          key={key}
          label={label}
          value={edit.adjustments[key] || 0}
          minimumValue={minimumValue}
          maximumValue={maximumValue}
          step={0.01}
          formatValue={signedPercent}
          onValueChange={(value) => onAdjustmentChange(key, value, `adjust-${key}`)}
          onSlidingComplete={onSeal}
        />
      ))}
    </InspectorSection>
  );
}

function FiltersPanel({ edit, onEditChange, onSeal }) {
  return (
    <>
      <InspectorSection title="PIT looks" detail="Presets are deterministic starting points. Fine-tune them in Adjust.">
        <View style={styles.filterGrid}>
          {Object.entries(MEDIA_FILTERS).map(([key, filter]) => {
            const selected = edit.filter === key;
            return (
              <Pressable
                key={key}
                onPress={() => onEditChange({ filter: key })}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${filter.label} filter`}
                style={({ pressed, focused }) => [styles.filter, selected && styles.filterSelected, pressed && styles.pressed, focused && focusRing]}
              >
                <View style={[styles.filterSwatch, { backgroundColor: FILTER_ACCENTS[key] }]} />
                <Text style={[styles.filterName, selected && styles.filterNameSelected]}>{filter.label}</Text>
                {selected ? <Icon name="check" size={15} color={colors.amber} /> : null}
              </Pressable>
            );
          })}
        </View>
      </InspectorSection>
      {edit.filter !== "original" ? (
        <InspectorSection title="Filter strength">
          <LabeledSlider label="Intensity" value={edit.filterIntensity} minimumValue={0} maximumValue={1} step={0.01} formatValue={percent} onValueChange={(value) => onEditChange({ filterIntensity: value }, "filter-intensity")} onSlidingComplete={onSeal} />
        </InspectorSection>
      ) : null}
    </>
  );
}

function AccessibilityPanel({ asset, altText, onMetaChange, onSeal, completion, photoIndex, photoCount }) {
  const video = asset?.kind === "video";
  const guidance = video ? null : mediaAltTextGuidance({ ...asset, altText }, { photoIndex, photoCount });
  const progressPercent = completion?.progress == null ? 0 : Math.round(completion.progress * 100);
  return (
    <InspectorSection title={`Describe this ${video ? "video" : "photo"}`} detail="This description is read aloud by screen readers. Describe what matters in the scene instead of repeating the post caption.">
      {!video && completion ? (
        <View style={styles.completionCard}>
          <View style={styles.completionHeader}>
            <Text style={styles.completionLabel}>{completion.label}</Text>
            {completion.tracked > 0 ? <Text style={styles.completionValue}>{progressPercent}%</Text> : null}
          </View>
          {completion.tracked > 0 ? (
            <View
              style={styles.completionTrack}
              accessibilityRole="progressbar"
              accessibilityLabel="Photo description completion"
              accessibilityValue={{ min: 0, max: completion.tracked, now: completion.completed, text: completion.label }}
            >
              <View style={[styles.completionFill, { width: `${progressPercent}%` }]} />
            </View>
          ) : null}
          <Text style={styles.completionScope}>
            {completion.optional > 0
              ? `${completion.optional} decorative or older photo${completion.optional === 1 ? " is" : "s are"} optional. This reminder never blocks Apply.`
              : "This reminder never blocks Apply."}
          </Text>
        </View>
      ) : null}
      {guidance ? (
        <View style={[styles.guidanceCard, guidance.state === "complete" && styles.guidanceComplete]}>
          <View style={styles.guidanceTitleRow}>
            <Icon name={guidance.state === "complete" ? "check" : guidance.state === "optional" ? "minus" : "comment"} size={15} color={guidance.state === "complete" ? colors.good : colors.amber} />
            <Text style={styles.guidanceTitle}>{guidance.position}</Text>
          </View>
          <Text style={styles.guidanceReminder}>{guidance.reminder}</Text>
          <Text style={styles.guidanceBody}>{guidance.guidance} Skip phrases like “image of.”</Text>
        </View>
      ) : null}
      <TextInput
        value={altText}
        onChangeText={(value) => onMetaChange({ altText: value.slice(0, 1_000) }, "alt-text")}
        onBlur={onSeal}
        placeholder={video ? "Example: A singer runs onto the stage as the crowd raises glowing phones." : guidance?.placeholder}
        placeholderTextColor={colors.textFaint}
        multiline
        maxLength={1_000}
        accessibilityLabel={video ? "Video description" : `${guidance?.position || "Photo"} alt text`}
        accessibilityHint="Describe the important visual content for people using screen readers"
        style={styles.altInput}
      />
      <Text style={styles.characterCount}>{altText.length} / 1,000</Text>
      {video ? <CapabilityNotice compact title="Useful description" body="Name people when known, include the action and setting, and skip phrases like “video of.”" /> : null}
    </InspectorSection>
  );
}

function LockedFeature({ name, detail }) {
  return (
    <View style={styles.lockedRow} accessibilityState={{ disabled: true }}>
      <View style={styles.lockIcon}><Icon name="lock" size={15} color={colors.textFaint} /></View>
      <View style={styles.lockCopy}>
        <Text style={styles.lockName}>{name}</Text>
        <Text style={styles.lockDetail}>{detail}</Text>
      </View>
      <Text style={styles.lockState}>UNAVAILABLE</Text>
    </View>
  );
}

function CoverPanel({ asset, edit, onEditChange, onSeal, coverAvailable, resolvedCoverTimeMs, resolvingAutoCover }) {
  const minimum = Math.max(0, edit.trimStartMs || 0);
  const maximum = Math.max(minimum + 1, edit.trimEndMs || asset.durationMs || 1);
  return (
    <>
      <InspectorSection title="Choose a cover" detail="Auto samples the opening for a useful non-black frame. Move the slider to choose a specific decoded frame instead.">
        <View style={styles.wrapRow}>
          <ControlChip label="Auto cover" selected={edit.coverMode !== "manual"} onPress={() => onEditChange({ coverMode: "auto" })} accessibilityLabel="Automatically choose a clear clip cover" />
          {edit.coverMode === "manual" ? (
            <Text style={styles.manualCover}>MANUAL FRAME</Text>
          ) : (
            <Text style={styles.manualCover}>{resolvingAutoCover ? "FINDING CLEAR FRAME" : resolvedCoverTimeMs != null ? `AUTO ${timecode(resolvedCoverTimeMs)}` : "AUTO COVER"}</Text>
          )}
        </View>
        <LabeledSlider
          label="Cover time"
          value={Math.min(maximum - 1, Math.max(minimum, edit.coverMs || 0))}
          minimumValue={minimum}
          maximumValue={maximum - 1}
          step={100}
          formatValue={timecode}
          onValueChange={(value) => onEditChange({ coverMs: Math.round(value), coverMode: "manual" }, "cover-time")}
          onSlidingComplete={onSeal}
          disabled={!coverAvailable}
        />
        {!coverAvailable ? <CapabilityNotice title="Cover export unavailable" body="This device does not expose a verified frame-extraction engine. Your original video stays untouched." /> : null}
      </InspectorSection>
      <InspectorSection title="Video editing scope" detail="These controls stay off until PIT has an authoritative renderer that can guarantee output codecs, orientation, audio, and metadata.">
        <LockedFeature name="Trim" detail="No destructive cut is claimed or uploaded." />
        <LockedFeature name="Mute" detail="The source audio track remains unchanged." />
        <LockedFeature name="Video filters" detail="Photo looks are not silently applied to video." />
      </InspectorSection>
    </>
  );
}

export default function MediaEditorInspector({
  asset,
  snapshot,
  activeTab,
  onTabChange,
  onEditChange,
  onAdjustmentChange,
  onMetaChange,
  onSeal,
  coverAvailable,
  resolvedCoverTimeMs,
  resolvingAutoCover,
  altTextCompletion,
  photoIndex,
  photoCount,
}) {
  return (
    <View style={styles.wrap}>
      <Tabs asset={asset} activeTab={activeTab} onTabChange={onTabChange} />
      <ScrollView style={styles.scroller} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {activeTab === "crop" ? <CropPanel edit={snapshot.edit} onEditChange={onEditChange} onSeal={onSeal} /> : null}
        {activeTab === "adjust" ? <AdjustPanel edit={snapshot.edit} onAdjustmentChange={onAdjustmentChange} onSeal={onSeal} /> : null}
        {activeTab === "filters" ? <FiltersPanel edit={snapshot.edit} onEditChange={onEditChange} onSeal={onSeal} /> : null}
        {activeTab === "accessibility" ? <AccessibilityPanel asset={asset} altText={snapshot.altText} onMetaChange={onMetaChange} onSeal={onSeal} completion={altTextCompletion} photoIndex={photoIndex} photoCount={photoCount} /> : null}
        {activeTab === "cover" ? <CoverPanel asset={asset} edit={snapshot.edit} onEditChange={onEditChange} onSeal={onSeal} coverAvailable={coverAvailable} resolvedCoverTimeMs={resolvedCoverTimeMs} resolvingAutoCover={resolvingAutoCover} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, backgroundColor: colors.bgElev },
  tabs: { paddingHorizontal: space(3), paddingVertical: space(2), gap: space(1), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  tab: { minHeight: 44, paddingHorizontal: 13, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "transparent" },
  tabSelected: { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
  tabText: { color: colors.textDim, fontFamily: displayFont, fontSize: 12, fontWeight: "800" },
  tabTextSelected: { color: colors.text },
  scroller: { flex: 1 },
  content: { padding: space(4), paddingBottom: space(10) },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  manualCover: { alignSelf: "center", color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  filterGrid: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  filter: { width: "47%", minHeight: 58, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  filterSelected: { borderColor: colors.amber, backgroundColor: colors.surfaceAlt },
  filterSwatch: { width: 30, height: 30, borderRadius: 10 },
  filterName: { flex: 1, color: colors.textDim, fontFamily: displayFont, fontSize: 12, fontWeight: "800" },
  filterNameSelected: { color: colors.text },
  altInput: { minHeight: 150, maxHeight: 240, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, lineHeight: 20, textAlignVertical: "top" },
  characterCount: { color: colors.textFaint, fontFamily: mono, fontSize: 10, textAlign: "right" },
  completionCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, padding: 12, gap: 8 },
  completionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  completionLabel: { flex: 1, color: colors.text, fontFamily: displayFont, fontSize: 12, fontWeight: "800" },
  completionValue: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900" },
  completionTrack: { height: 7, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  completionFill: { height: "100%", borderRadius: 4, backgroundColor: colors.good },
  completionScope: { color: colors.textFaint, fontSize: 10.5, lineHeight: 15 },
  guidanceCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface, padding: 12, gap: 5 },
  guidanceComplete: { borderColor: colors.good },
  guidanceTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  guidanceTitle: { color: colors.text, fontFamily: displayFont, fontSize: 12, fontWeight: "900" },
  guidanceReminder: { color: colors.text, fontSize: 12, lineHeight: 17 },
  guidanceBody: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  lockedRow: { minHeight: 58, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, padding: 10, flexDirection: "row", alignItems: "center", gap: 10, opacity: 0.68 },
  lockIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  lockCopy: { flex: 1, gap: 2 },
  lockName: { color: colors.text, fontFamily: displayFont, fontSize: 12, fontWeight: "800" },
  lockDetail: { color: colors.textDim, fontSize: 10, lineHeight: 14 },
  lockState: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  pressed: { opacity: 0.72 },
});
