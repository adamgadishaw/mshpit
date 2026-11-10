import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { ImageManipulator } from "expo-image-manipulator";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius } from "../theme";
import useReducedMotion from "../hooks/useReducedMotion";
import { profileCropAfterDrag, profileCropPlan } from "../domain/profileCrop.mjs";
import { MEDIA_PHOTO_SOURCE_MAX_BYTES, mediaUploadLimitLabel } from "../domain/mediaUploadPolicy.mjs";

const CENTER = { zoom: 1, centerX: 0.5, centerY: 0.5 };
const touchState = touches => {
  const points = Array.from(touches || []);
  return points.length ? { count: points.length, x: points.reduce((n, p) => n + p.pageX, 0) / points.length,
    y: points.reduce((n, p) => n + p.pageY, 0) / points.length,
    distance: points.length > 1 ? Math.hypot(points[0].pageX - points[1].pageX, points[0].pageY - points[1].pageY) : 0 } : null;
};

export default function ProfileImageCropDialog({ request }) {
  const { asset, signal, finish, upload } = request;
  const reducedMotion = useReducedMotion();
  const [source, setSource] = useState(null), [position, setPosition] = useState(CENTER), [width, setWidth] = useState(0);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const mounted = useRef(false), pending = useRef(false), gesture = useRef(null), latest = useRef(null);
  const plan = source && width > 0 ? profileCropPlan({ imageWidth: source.width, imageHeight: source.height, frameWidth: width, frameHeight: width / 3, ...position }) : null;
  const update = next => {
    const current = latest.current;
    if (!current?.source || !current.width || pending.current || signal.aborted) return;
    const bounded = profileCropPlan({ imageWidth: current.source.width, imageHeight: current.source.height,
      frameWidth: current.width, frameHeight: current.width / 3, ...next });
    latest.current = { ...current, plan: bounded };
    setPosition({ zoom: bounded.zoom, centerX: bounded.centerX, centerY: bounded.centerY });
  };
  latest.current = { source, plan, width };
  useEffect(() => {
    mounted.current = true;
    let retired = false, image;
    const releaseImage = () => { image?.release?.(); image = null; };
    if (Number(asset.fileSize) > MEDIA_PHOTO_SOURCE_MAX_BYTES) {
      setError(`Choose a photo smaller than ${mediaUploadLimitLabel(MEDIA_PHOTO_SOURCE_MAX_BYTES)}.`);
      return () => { mounted.current = false; };
    }
    signal.addEventListener("abort", releaseImage, { once: true });
    let context;
    void Promise.resolve().then(() => {
      if (retired || signal.aborted) return null;
      context = ImageManipulator.manipulate(asset.uri);
      return context.renderAsync();
    }).then(value => {
      if (!value) return;
      image = value;
      if (retired || signal.aborted) { releaseImage(); return; }
      if (![value.width, value.height].every(n => Number.isFinite(n) && n > 0)) throw new Error("Unreadable photo dimensions");
      setSource(value);
    }).catch(() => {
      if (!retired && !signal.aborted) setError("This photo could not be opened. Cancel and choose another photo.");
    }).finally(() => context?.release?.());
    return () => {
      retired = true; mounted.current = false;
      signal.removeEventListener("abort", releaseImage);
      releaseImage();
    };
  }, [asset, signal]);
  const responder = useRef(null);
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => !!latest.current?.plan && !pending.current && !signal.aborted,
    onMoveShouldSetPanResponder: () => !!latest.current?.plan && !pending.current && !signal.aborted,
    onPanResponderGrant: event => { gesture.current = touchState(event.nativeEvent.touches); },
    onPanResponderMove: event => {
      const current = latest.current, next = touchState(event.nativeEvent.touches), previous = gesture.current;
      gesture.current = next;
      if (!current?.plan || !next || !previous || next.count !== previous.count) return;
      const moved = profileCropAfterDrag(current.plan, { deltaX: next.x - previous.x, deltaY: next.y - previous.y,
        imageWidth: current.source.width, imageHeight: current.source.height });
      if (next.distance && previous.distance) moved.zoom = current.plan.zoom * next.distance / previous.distance;
      update(moved);
    },
    onPanResponderRelease: () => { gesture.current = null; },
    onPanResponderTerminate: () => { gesture.current = null; },
    onPanResponderTerminationRequest: () => true,
  });
  const adjust = change => {
    const current = latest.current?.plan;
    if (current) update({ zoom: current.zoom, centerX: current.centerX, centerY: current.centerY, ...change(current) });
  };
  const apply = async () => {
    const current = latest.current;
    if (!current?.plan || pending.current || signal.aborted) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await upload({ ...asset, profileImageRef: current.source, profileCrop: current.plan.selection }, { signal });
      if (!signal.aborted && mounted.current) finish(result);
    } catch {
      if (!signal.aborted && mounted.current) setError("Your banner could not be uploaded. Your crop is still here. Try again or cancel to keep your current banner.");
    } finally {
      pending.current = false;
      if (!signal.aborted && mounted.current) setBusy(false);
    }
  };
  const control = (label, onPress, disabled = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled} onPress={onPress} style={[styles.control, (busy || disabled) && styles.disabled]}><Text style={styles.controlText}>{label}</Text></Pressable>;
  return <Modal visible animationType={reducedMotion ? "none" : "slide"} presentationStyle="fullScreen" onRequestClose={() => finish(null)}>
    <SafeAreaView style={styles.screen} accessibilityViewIsModal onAccessibilityEscape={() => finish(null)}>
      <View style={styles.header}>
        <Pressable onPress={() => finish(null)} accessibilityRole="button" accessibilityLabel="Cancel banner adjustment" style={styles.control}><Text style={styles.controlText}>Cancel</Text></Pressable>
        <Text style={styles.title} accessibilityRole="header">Adjust banner</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.hint}>Drag to reposition. Pinch to zoom, or use the controls below.</Text>
        <View testID="profile-banner-crop-frame" style={styles.frame} onLayout={event => setWidth(event.nativeEvent.layout.width)} {...responder.current.panHandlers}>
          {plan ? <Image source={source} contentFit="fill" allowDownscaling={false} transition={0} accessible={false}
            style={{ position: "absolute", left: plan.left, top: plan.top, width: plan.renderedWidth, height: plan.renderedHeight }} /> : !error ? <ActivityIndicator accessibilityLabel="Loading banner preview" color={colors.amber} /> : null}
        </View>
        <Text style={styles.hint}>This 3:1 crop is how your banner will appear on your profile.</Text>
        {plan && plan.width < 1800 ? <Text style={styles.hint}>This crop has less than 1800 pixels of detail. Zoom out or choose a larger photo for a sharper banner.</Text> : null}
        <View style={styles.controls}>
          {control("Zoom out", () => adjust(p => ({ zoom: p.zoom - 0.25 })), !plan || plan.zoom <= 1)}
          {control("Zoom in", () => adjust(p => ({ zoom: p.zoom + 0.25 })), !plan || plan.zoom >= 4)}
          {control("Reset crop", () => update(CENTER), !plan)}
        </View>
        <View style={styles.controls}>
          {control("Move left", () => adjust(p => ({ centerX: p.centerX - p.selection.width * 0.1 })), !plan)}
          {control("Move right", () => adjust(p => ({ centerX: p.centerX + p.selection.width * 0.1 })), !plan)}
          {control("Move up", () => adjust(p => ({ centerY: p.centerY - p.selection.height * 0.1 })), !plan)}
          {control("Move down", () => adjust(p => ({ centerY: p.centerY + p.selection.height * 0.1 })), !plan)}
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Use this banner" accessibilityState={{ disabled: !plan || busy, busy }}
          disabled={!plan || busy} onPress={apply} style={[styles.apply, (!plan || busy) && styles.disabled]}>
          {busy ? <ActivityIndicator color={colors.bg} /> : null}<Text style={styles.applyText}>{busy ? "Uploading…" : "Use this banner"}</Text>
        </Pressable>
        <Text style={styles.hint}>Your current banner stays in place until you save your profile.</Text>
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg }, header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12 },
  title: { flex: 1, color: colors.text, fontSize: 22, fontWeight: "700" }, body: { padding: 20, gap: 18 },
  hint: { color: colors.textDim, fontSize: 15, lineHeight: 21 }, frame: { width: "100%", aspectRatio: 3, overflow: "hidden", borderRadius: radius.md, backgroundColor: colors.surfaceAlt, justifyContent: "center", alignItems: "center" },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, control: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, paddingVertical: 12, justifyContent: "center", backgroundColor: colors.surfaceAlt, borderRadius: radius.md },
  controlText: { color: colors.text, fontSize: 15, fontWeight: "600" }, disabled: { opacity: 0.4 }, error: { color: colors.text, fontSize: 15, lineHeight: 21 },
  apply: { minHeight: 48, padding: 14, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: colors.amber, borderRadius: radius.md },
  applyText: { color: colors.bg, fontSize: 17, fontWeight: "700" },
});
