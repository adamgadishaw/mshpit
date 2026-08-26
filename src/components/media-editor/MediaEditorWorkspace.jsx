import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  MEDIA_ASPECTS,
  mediaEditFingerprint,
  mediaImageRequiresRender,
  normalizeMediaEdit,
  rotatedDimensions,
  videoEditRequiresExport,
} from "../../domain/mediaEdit.mjs";
import { normalizeMediaProject } from "../../domain/mediaProject.mjs";
import { mediaUploadProgressCopy } from "../../domain/mediaTransferProgress.mjs";
import { mediaAltTextCompletion } from "../../domain/media-alt-text.mjs";
import { mediaEditorGesturePatch, touchCentroid, touchDistance } from "../../domain/mediaEditorGesture.mjs";
import { mediaEditorNarrowStageHeight, mediaEditorWideStageHeight } from "../../domain/mediaEditorLayout.mjs";
import { exportEditedImage, mediaEditImageCapabilities } from "../../lib/mediaEditImageEngine";
import { generateVideoCover, mediaEditVideoCapabilities } from "../../lib/mediaEditVideoCover";
import { attachMediaEditArtifacts } from "../../lib/mediaEditApplyResult.mjs";
import {
  commitMediaEditHistory,
  createMediaEditHistory,
  mediaEditHistoryState,
  redoMediaEditHistory,
  resetMediaEditHistory,
  sealMediaEditHistory,
  undoMediaEditHistory,
} from "../../lib/mediaEditHistory.mjs";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../../theme";
import Icon from "../Icon";
import MediaAssetRail from "./MediaAssetRail";
import { HistoryButton } from "./MediaEditorControls";
import MediaEditorInspector from "./MediaEditorInspector";
import MediaEditorPreview from "./MediaEditorPreview";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.()).then((value) => {
      if (mounted) setReduced(!!value);
    });
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (value) => setReduced(!!value));
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);
  return reduced;
}

function assetSnapshot(asset) {
  return { edit: asset.edit, altText: asset.altText || "" };
}

function snapshotFingerprint(snapshot, asset) {
  return `${mediaEditFingerprint(snapshot.edit, { kind: asset.kind, durationMs: asset.durationMs })}\n${snapshot.altText}`;
}

const autoCoverCacheKey = (asset) => `${asset?.id || "video"}:${asset?.uri || ""}`;

const photoPreviewCacheKey = (asset, edit) => asset?.kind === "image"
  && mediaImageRequiresRender(asset, edit)
  ? `${asset.id}:${asset.uri}:${mediaEditFingerprint(edit, { kind: "image" })}`
  : null;

function disposeMediaArtifact(value) {
  try { value?.dispose?.(); } catch {}
  try { value?.release?.(); } catch {}
}

function previewSize(asset, edit, viewport, wide) {
  const rotated = rotatedDimensions(asset.width, asset.height, edit.rotation);
  const ratio = MEDIA_ASPECTS[edit.aspect] || rotated.width / rotated.height || 1;
  const availableWidth = Math.max(160, viewport.width - (wide ? 430 : 32));
  const availableHeight = wide
    ? mediaEditorWideStageHeight(viewport.height)
    : Math.max(130, Math.min(230, viewport.height * 0.27));
  if (availableWidth / availableHeight > ratio) return { width: Math.max(80, availableHeight * ratio), height: availableHeight };
  return { width: availableWidth, height: Math.max(100, availableWidth / ratio) };
}

function CloseButton({ onPress, disabled }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Close PIT Studio"
      accessibilityState={{ disabled }}
      style={({ pressed, focused }) => [styles.iconButton, disabled && styles.disabled, pressed && !disabled && styles.pressed, focused && focusRing]}
    >
      <Icon name="x" size={20} color={colors.text} />
    </Pressable>
  );
}

function ApplyButton({ onPress, disabled, busy, cancelling }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={busy ? (cancelling ? "Cancelling media processing" : "Cancel media processing") : "Apply media edits"}
      accessibilityState={{ disabled, busy: busy && !cancelling }}
      style={({ pressed, focused }) => [styles.applyButton, disabled && styles.applyDisabled, pressed && !disabled && styles.applyPressed, focused && focusRing]}
    >
      <Icon name={busy ? (cancelling ? "clock" : "x") : "check"} size={17} color={disabled ? colors.textFaint : "#1A1206"} />
      <Text style={[styles.applyText, disabled && styles.applyTextDisabled]}>{busy ? (cancelling ? "Cancelling" : "Cancel") : "Apply"}</Text>
    </Pressable>
  );
}

export default function MediaEditorWorkspace({
  visible,
  assets: inputAssets = [],
  initialAssetId,
  returnFocusRef = null,
  onClose,
  onAssetChange,
  onAssetMove,
  onAssetRemove,
  onApply,
  onCancelProcessing,
  uploadProgress = null,
}) {
  const viewport = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const wide = viewport.width >= 920;
  const assets = useMemo(() => {
    const normalized = normalizeMediaProject({ assets: inputAssets }).assets;
    return normalized.map((asset, index) => {
      const source = inputAssets.find?.((item) => item?.id === asset.id || (asset.assetId && item?.assetId === asset.assetId)) || inputAssets[index];
      return {
        ...asset,
        ...(source?.decorative === true ? { decorative: true } : {}),
        ...(source?.altTextRequired === false ? { altTextRequired: false } : {}),
      };
    });
  }, [inputAssets]);
  const [selectedId, setSelectedId] = useState(initialAssetId || assets[0]?.id || null);
  const [histories, setHistories] = useState(() => Object.fromEntries(assets.map((asset) => [asset.id, createMediaEditHistory(assetSnapshot(asset))])));
  const historiesRef = useRef(histories);
  const modalRootRef = useRef(null);
  const [activeTab, setActiveTab] = useState(assets[0]?.kind === "video" ? "cover" : "crop");
  const [showOriginal, setShowOriginal] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancellingRef = useRef(false);
  const processingAbortRef = useRef(null);
  const [message, setMessage] = useState(null);
  const [progress, setProgress] = useState(null);
  const [previewCovers, setPreviewCovers] = useState({});
  const previewCoversRef = useRef(previewCovers);
  const coverPreviewAbortRef = useRef(null);
  const [resolvingAutoCoverId, setResolvingAutoCoverId] = useState(null);
  const [coverGenerationNonce, setCoverGenerationNonce] = useState(0);
  const [photoPreview, setPhotoPreview] = useState(null);
  const photoPreviewRef = useRef(null);
  const photoPreviewAbortRef = useRef(null);
  const assetChangeRef = useRef(onAssetChange);
  const gestureRef = useRef(null);
  const gestureEditRef = useRef(null);

  useEffect(() => {
    historiesRef.current = histories;
  }, [histories]);

  useEffect(() => {
    previewCoversRef.current = previewCovers;
  }, [previewCovers]);

  useEffect(() => {
    assetChangeRef.current = onAssetChange;
  }, [onAssetChange]);

  useEffect(() => {
    const show = Keyboard.addListener?.("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener?.("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show?.remove?.();
      hide?.remove?.();
    };
  }, []);

  useEffect(() => {
    const next = {};
    for (const asset of assets) next[asset.id] = historiesRef.current[asset.id] || createMediaEditHistory(assetSnapshot(asset));
    historiesRef.current = next;
    setHistories(next);
    if (!assets.some((asset) => asset.id === selectedId)) setSelectedId(initialAssetId || assets[0]?.id || null);
  }, [assets, initialAssetId, selectedId]);

  const selectedAsset = assets.find((asset) => asset.id === selectedId) || assets[0] || null;
  const selectedHistory = selectedAsset ? histories[selectedAsset.id] || createMediaEditHistory(assetSnapshot(selectedAsset)) : null;
  const snapshot = selectedHistory?.present || null;
  const historyState = mediaEditHistoryState(selectedHistory, {
    equals: (left, right) => snapshotFingerprint(left, selectedAsset) === snapshotFingerprint(right, selectedAsset),
  });
  const size = selectedAsset && snapshot ? previewSize(selectedAsset, snapshot.edit, viewport, wide) : { width: 320, height: 320 };
  // On a narrow screen the preview, its metadata and its padding occupy a
  // fixed slice above the scrollable inspector. Avoid `flex: 0`: RN Web maps
  // that shorthand to a zero flex-basis and can collapse the visual preview
  // while leaving only the column padding on screen.
  const narrowStageHeight = mediaEditorNarrowStageHeight(viewport.height);
  const selectedPhotoPreviewKey = selectedAsset && snapshot ? photoPreviewCacheKey(selectedAsset, snapshot.edit) : null;
  const autoCoverAssets = assets.filter((asset) => {
    const working = histories[asset.id]?.present?.edit || asset.edit;
    return asset.kind === "video" && working?.coverMode !== "manual";
  });
  const autoCoverSignature = autoCoverAssets.map((asset) => `${autoCoverCacheKey(asset)}:auto`).join("|");
  const unsupportedVideo = assets.some((asset) => {
    const working = histories[asset.id]?.present?.edit || asset.edit;
    return asset.kind === "video" && videoEditRequiresExport(working);
  });
  const needsImageRenderer = assets.some((asset) => {
    const working = histories[asset.id]?.present?.edit || asset.edit;
    return mediaImageRequiresRender(asset, working);
  });
  const applyBlocked = saving
    || !assets.length
    || typeof onApply !== "function"
    || unsupportedVideo
    || (needsImageRenderer && !mediaEditImageCapabilities.image.export);
  const anyDirty = assets.some((asset) => {
    const history = histories[asset.id];
    return history && snapshotFingerprint(history.present, asset) !== snapshotFingerprint(history.baseline, asset);
  });
  const workingAssets = useMemo(() => assets.map((asset) => ({
    ...asset,
    ...(histories[asset.id]?.present || {}),
    ...(previewCovers[asset.id]?.cover?.uri ? { posterUri: previewCovers[asset.id].cover.uri } : {}),
  })), [assets, histories, previewCovers]);
  const altTextCompletion = useMemo(() => mediaAltTextCompletion(workingAssets), [workingAssets]);
  const photoAssets = workingAssets.filter((asset) => asset.kind === "image");
  const selectedPhotoIndex = selectedAsset?.kind === "image"
    ? photoAssets.findIndex((asset) => asset.id === selectedAsset.id)
    : -1;

  function requestClose() {
    if (saving) return;
    if (!assets.length) return onClose?.();
    const detail = anyDirty
      ? "Your selected media and reversible edits have not been applied to this post."
      : "Your selected media has not been applied to this post.";
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`Discard PIT Studio changes?\n\n${detail}`)) onClose?.();
      return;
    }
    Alert.alert("Discard PIT Studio changes?", detail, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => onClose?.() },
    ]);
  }

  useEffect(() => {
    if (!selectedAsset) return;
    setActiveTab(selectedAsset.kind === "video" ? "cover" : "crop");
    setShowOriginal(false);
  }, [selectedAsset?.id, selectedAsset?.kind]);

  // Auto-cover scoring is a best-effort preview. Its timestamp is forwarded to
  // the private verifier when available, but a device frame-extraction failure
  // must not block the authoritative server-generated cover or the video.
  useEffect(() => {
    if (!visible || !mediaEditVideoCapabilities.video.cover) return undefined;
    const wanted = new Map(autoCoverAssets.map((asset) => [asset.id, {
      ...asset,
      edit: historiesRef.current[asset.id]?.present?.edit || asset.edit,
      key: autoCoverCacheKey(asset),
    }]));

    const retained = {};
    let cacheChanged = false;
    for (const [id, entry] of Object.entries(previewCoversRef.current)) {
      if (wanted.get(id)?.key === entry.key) retained[id] = entry;
      else {
        cacheChanged = true;
        disposeMediaArtifact(entry.cover);
      }
    }
    if (cacheChanged) {
      previewCoversRef.current = retained;
      setPreviewCovers(retained);
    }

    const missing = [...wanted.values()].filter((asset) => retained[asset.id]?.key !== asset.key);
    if (!missing.length) {
      setResolvingAutoCoverId(null);
      return undefined;
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    coverPreviewAbortRef.current?.abort?.();
    coverPreviewAbortRef.current = controller;
    let active = true;
    (async () => {
      for (const asset of missing) {
        if (!active || controller?.signal.aborted) return;
        setResolvingAutoCoverId(asset.id);
        const cover = await generateVideoCover(asset, {
          coverMode: "auto",
          signal: controller?.signal,
        });
        if (!active || controller?.signal.aborted) {
          disposeMediaArtifact(cover);
          return;
        }
        const current = previewCoversRef.current[asset.id];
        if (current?.cover && current.cover !== cover) disposeMediaArtifact(current.cover);
        const entry = { key: asset.key, cover };
        const next = { ...previewCoversRef.current, [asset.id]: entry };
        previewCoversRef.current = next;
        setPreviewCovers(next);
        assetChangeRef.current?.(asset.id, {
          posterUri: cover.uri,
          posterTimeMs: Math.max(0, Math.round(Number(cover.actualTimeMs) || 0)),
          ...(cover.durationMs ? { durationMs: Math.max(1, Math.round(cover.durationMs)) } : {}),
        });
      }
    })().catch((error) => {
      if (!active || controller?.signal.aborted) return;
      setMessage(error?.message || "PIT could not find a clear video cover. Try a manual frame.");
    }).finally(() => {
      if (active) setResolvingAutoCoverId(null);
      if (coverPreviewAbortRef.current === controller) coverPreviewAbortRef.current = null;
    });
    return () => {
      active = false;
      controller?.abort?.();
    };
  // The compact signature changes only when auto-video identity changes. A
  // decoded duration update must not throw away the already scored artifact.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCoverSignature, coverGenerationNonce, visible]);

  // The geometry preview responds immediately while dragging. After a short
  // idle window, render a small artifact through the *same* pixel engine used
  // for publication and swap it in. This makes every enabled color/filter
  // control inspectable without running a full-resolution export per tick.
  useEffect(() => {
    photoPreviewAbortRef.current?.abort?.();
    if (!visible || !selectedPhotoPreviewKey || !selectedAsset || !snapshot || !mediaEditImageCapabilities.image.export) {
      if (photoPreviewRef.current) disposeMediaArtifact(photoPreviewRef.current.artifact);
      photoPreviewRef.current = null;
      setPhotoPreview(null);
      return undefined;
    }
    if (photoPreviewRef.current?.key === selectedPhotoPreviewKey) return undefined;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    photoPreviewAbortRef.current = controller;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const artifact = await exportEditedImage({ ...selectedAsset, edit: snapshot.edit }, {
          maxEdge: 512,
          quality: 0.82,
          signal: controller?.signal,
        });
        if (!active || controller?.signal.aborted) {
          disposeMediaArtifact(artifact);
          return;
        }
        if (photoPreviewRef.current?.artifact && photoPreviewRef.current.artifact !== artifact) {
          disposeMediaArtifact(photoPreviewRef.current.artifact);
        }
        const entry = { key: selectedPhotoPreviewKey, artifact };
        photoPreviewRef.current = entry;
        setPhotoPreview(entry);
      } catch (error) {
        if (!active || controller?.signal.aborted || error?.name === "AbortError") return;
        // The responsive transform preview remains available. Apply still
        // fails closed if the authoritative renderer cannot produce bytes.
      } finally {
        if (photoPreviewAbortRef.current === controller) photoPreviewAbortRef.current = null;
      }
    }, 80);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort?.();
    };
  }, [selectedPhotoPreviewKey, selectedAsset?.id, selectedAsset?.uri, visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof window === "undefined") return undefined;
    const editableTarget = (target) => /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName) || target?.isContentEditable;
    const keyDown = (event) => {
      if (event.key === "Escape" && !saving) requestClose();
      if (event.key.toLowerCase() === "b" && !editableTarget(event.target)) setShowOriginal(true);
    };
    const keyUp = (event) => {
      if (event.key.toLowerCase() === "b" && !editableTarget(event.target)) setShowOriginal(false);
    };
    const releaseCompare = () => setShowOriginal(false);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") releaseCompare();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", releaseCompare);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", releaseCompare);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [anyDirty, assets.length, onClose, saving, visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof document === "undefined") return undefined;
    const root = modalRootRef.current;
    if (!root?.querySelectorAll) return undefined;
    const previous = returnFocusRef?.current?.element || document.activeElement;
    const focusable = () => Array.from(root.querySelectorAll(
      'button,[href],[role="button"],[role="tab"],[role="slider"],input,textarea,select,[tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      !element.hasAttribute?.("disabled")
      && element.getAttribute?.("aria-disabled") !== "true"
      && element.getAttribute?.("aria-hidden") !== "true"
      && !element.closest?.('[aria-hidden="true"]')
      && element.getClientRects?.().length > 0
      && (
        /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
        || !!element.getAttribute?.("aria-label")
        || !!element.getAttribute?.("aria-labelledby")
        || !!element.textContent?.trim()
      )
    ));
    const focusElement = (element) => {
      try { element?.focus?.({ preventScroll: true }); } catch { try { element?.focus?.(); } catch {} }
    };
    const frame = requestAnimationFrame(() => focusElement(
      root.querySelector?.('[aria-label="Close PIT Studio"]') || focusable()[0],
    ));
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) return;
      const current = elements.indexOf(document.activeElement);
      const target = current < 0
        ? (event.shiftKey ? elements.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
      event.preventDefault();
      focusElement(elements[target]);
    };
    root.addEventListener("keydown", trapFocus);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("keydown", trapFocus);
      // LogScreen owns deferred opener restoration when it captured the
      // trigger before this RN Web Modal mounted. Synchronous focus here loses
      // to the portal's own <body> teardown.
      if (!returnFocusRef && previous?.isConnected) {
        setTimeout(() => {
          if (previous?.isConnected) focusElement(previous);
        }, 0);
      }
    };
  }, [returnFocusRef, visible]);

  useEffect(() => () => {
    cancellingRef.current = true;
    processingAbortRef.current?.abort?.();
    coverPreviewAbortRef.current?.abort?.();
    photoPreviewAbortRef.current?.abort?.();
    for (const entry of Object.values(previewCoversRef.current)) disposeMediaArtifact(entry?.cover);
    previewCoversRef.current = {};
    disposeMediaArtifact(photoPreviewRef.current?.artifact);
    photoPreviewRef.current = null;
  }, []);

  function replaceHistory(asset, nextHistory, patch) {
    const next = { ...historiesRef.current, [asset.id]: nextHistory };
    historiesRef.current = next;
    setHistories(next);
    if (patch) onAssetChange?.(asset.id, patch);
  }

  function editChange(patch, groupKey = null) {
    if (!selectedAsset || !selectedHistory) return;
    const edit = normalizeMediaEdit({ ...selectedHistory.present.edit, ...patch }, { kind: selectedAsset.kind, durationMs: selectedAsset.durationMs });
    const nextSnapshot = { ...selectedHistory.present, edit };
    const nextHistory = commitMediaEditHistory(selectedHistory, nextSnapshot, {
      groupKey,
      equals: (left, right) => snapshotFingerprint(left, selectedAsset) === snapshotFingerprint(right, selectedAsset),
    });
    replaceHistory(selectedAsset, nextHistory, { edit });
  }

  function adjustmentChange(key, value, groupKey) {
    editChange({ adjustments: { ...snapshot.edit.adjustments, [key]: value } }, groupKey);
  }

  function metaChange(patch, groupKey = null) {
    if (!selectedAsset || !selectedHistory) return;
    const nextSnapshot = { ...selectedHistory.present, ...patch };
    const nextHistory = commitMediaEditHistory(selectedHistory, nextSnapshot, {
      groupKey,
      equals: (left, right) => snapshotFingerprint(left, selectedAsset) === snapshotFingerprint(right, selectedAsset),
    });
    replaceHistory(selectedAsset, nextHistory, patch);
  }

  function seal() {
    if (!selectedAsset || !selectedHistory) return;
    replaceHistory(selectedAsset, sealMediaEditHistory(selectedHistory));
  }

  gestureEditRef.current = {
    change: (patch) => editChange(patch, "direct-transform"),
    seal,
  };

  const stagePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => (event.nativeEvent.touches?.length || 0) > 1,
    onMoveShouldSetPanResponder: (event, gesture) => {
      const touches = event.nativeEvent.touches || [];
      return touches.length > 1 || Math.hypot(gesture.dx, gesture.dy) >= 5;
    },
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches || [];
      const asset = selectedAsset;
      const present = asset ? historiesRef.current[asset.id]?.present : null;
      if (!asset || asset.kind !== "image" || !present?.edit || saving || showOriginal) {
        gestureRef.current = null;
        return;
      }
      gestureRef.current = {
        edit: present.edit,
        centroid: touchCentroid(touches),
        distance: touchDistance(touches),
        width: size.width,
        height: size.height,
        sourceWidth: asset.width,
        sourceHeight: asset.height,
      };
    },
    onPanResponderMove: (event, gesture) => {
      const start = gestureRef.current;
      if (!start) return;
      const touches = event.nativeEvent.touches || [];
      const centroid = touchCentroid(touches);
      const distance = touchDistance(touches);
      const deltaX = centroid && start.centroid ? centroid.x - start.centroid.x : gesture.dx;
      const deltaY = centroid && start.centroid ? centroid.y - start.centroid.y : gesture.dy;
      const scale = distance && start.distance ? distance / start.distance : 1;
      gestureEditRef.current?.change?.(mediaEditorGesturePatch({
        edit: start.edit,
        sourceWidth: start.sourceWidth,
        sourceHeight: start.sourceHeight,
        viewportWidth: start.width,
        viewportHeight: start.height,
        deltaX,
        deltaY,
        scale,
      }));
    },
    onPanResponderRelease: () => {
      if (gestureRef.current) gestureEditRef.current?.seal?.();
      gestureRef.current = null;
    },
    onPanResponderTerminate: () => {
      if (gestureRef.current) gestureEditRef.current?.seal?.();
      gestureRef.current = null;
    },
    onPanResponderTerminationRequest: () => true,
  // The responder is rebuilt when selection or stage geometry changes; edit
  // updates during a gesture are absolute against the grant-time snapshot.
  }), [selectedAsset?.id, selectedAsset?.kind, selectedAsset?.width, selectedAsset?.height, saving, showOriginal, size.width, size.height]);

  function moveHistory(action) {
    if (!selectedAsset || !selectedHistory) return;
    const nextHistory = action(selectedHistory);
    replaceHistory(selectedAsset, nextHistory, nextHistory === selectedHistory ? null : nextHistory.present);
  }

  async function applyEdits() {
    if (applyBlocked) return;
    setSaving(true);
    setCancelling(false);
    cancellingRef.current = false;
    processingAbortRef.current = typeof AbortController === "function" ? new AbortController() : null;
    setMessage(null);
    const renders = {};
    try {
      const staged = normalizeMediaProject({
        assets: assets.map((asset) => ({ ...asset, ...(historiesRef.current[asset.id]?.present || assetSnapshot(asset)) })),
      }).assets;
      const committed = [];
      for (let index = 0; index < staged.length; index += 1) {
        if (cancellingRef.current) throw new Error("Media processing was cancelled.");
        const asset = staged[index];
        setProgress({ current: index + 1, total: staged.length, kind: asset.kind });
        if (mediaImageRequiresRender(asset, asset.edit)) {
          const render = await exportEditedImage(asset, { signal: processingAbortRef.current?.signal });
          renders[asset.id] = render;
          committed.push(attachMediaEditArtifacts(asset, { renderedAsset: render }));
        } else if (asset.kind === "video") {
          if (videoEditRequiresExport(asset.edit)) throw new Error("Trim, mute, crop, and video filters need PIT's authoritative video renderer and cannot be applied yet.");
          const cached = asset.edit.coverMode !== "manual" ? previewCoversRef.current[asset.id] : null;
          const cover = cached?.key === autoCoverCacheKey(asset) ? cached.cover : null;
          if (cover) renders[asset.id] = { cover };
          committed.push(attachMediaEditArtifacts(asset, { posterAsset: cover }));
        } else committed.push(asset);
      }
      if (cancellingRef.current) throw new Error("Media processing was cancelled.");
      await onApply({ version: 1, assets: committed, renders });
      setProgress(null);
      onClose?.();
    } catch (error) {
      for (const value of Object.values(renders)) {
        try { (value?.cover || value)?.dispose?.(); } catch {}
      }
      // Upload/cancel paths own and dispose the concrete artifacts. Drop every
      // cached reference after a failed Apply so Retry regenerates valid bytes
      // instead of reusing an already released Blob/native image.
      for (const entry of Object.values(previewCoversRef.current)) disposeMediaArtifact(entry?.cover);
      previewCoversRef.current = {};
      setPreviewCovers({});
      setCoverGenerationNonce((value) => value + 1);
      setProgress(null);
      setMessage(cancellingRef.current
        ? "Media processing was cancelled. Your originals are unchanged."
        : (error?.message || "PIT Studio could not finish this edit. Your originals are unchanged."));
    } finally {
      setSaving(false);
      setCancelling(false);
      cancellingRef.current = false;
      processingAbortRef.current = null;
    }
  }

  async function cancelProcessing() {
    if (!saving || cancelling || typeof onCancelProcessing !== "function") return;
    setCancelling(true);
    cancellingRef.current = true;
    processingAbortRef.current?.abort?.();
    try {
      await onCancelProcessing();
    } catch (error) {
      cancellingRef.current = false;
      setCancelling(false);
      setMessage(error?.message || "PIT could not cancel this operation yet. Processing is still active.");
    }
  }

  return (
    <Modal
      visible={!!visible}
      onRequestClose={saving ? undefined : requestClose}
      animationType={reduceMotion ? "none" : "slide"}
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      accessibilityViewIsModal
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <SafeAreaView ref={modalRootRef} style={styles.safe}>
        <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.header}>
            <CloseButton onPress={requestClose} disabled={saving} />
            <View style={styles.titleWrap}>
              <Text style={styles.kicker}>PIT STUDIO</Text>
              <Text style={styles.title} numberOfLines={1}>{assets.length > 1 ? `${assets.length} media items` : "Create your look"}</Text>
            </View>
            <ApplyButton
              onPress={saving ? cancelProcessing : applyEdits}
              disabled={saving ? cancelling || typeof onCancelProcessing !== "function" : applyBlocked}
              busy={saving}
              cancelling={cancelling}
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.historyScroll}
            contentContainerStyle={styles.historyBar}
            keyboardShouldPersistTaps="handled"
          >
            <HistoryButton label="Undo" icon="chevron-left" onPress={() => moveHistory(undoMediaEditHistory)} disabled={!historyState.canUndo || saving} />
            <HistoryButton label="Redo" icon="chevron-right" onPress={() => moveHistory(redoMediaEditHistory)} disabled={!historyState.canRedo || saving} />
            <HistoryButton label="Reset" icon="shuffle" onPress={() => moveHistory((history) => resetMediaEditHistory(history, { equals: (left, right) => snapshotFingerprint(left, selectedAsset) === snapshotFingerprint(right, selectedAsset) }))} disabled={!historyState.isDirty || saving} />
            <View style={styles.historySpacer} />
            <Text style={styles.saveState}>{anyDirty ? "Reversible edits" : "Original"}</Text>
          </ScrollView>

          {message ? (
            <View style={styles.error} accessibilityRole="alert">
              <Icon name="flag" size={17} color={colors.danger} />
              <Text style={styles.errorText}>{message}</Text>
            </View>
          ) : null}
          {unsupportedVideo ? (
            <View style={styles.error} accessibilityRole="alert">
              <Icon name="lock" size={17} color={colors.amber} />
              <Text style={styles.errorText}>This draft contains a destructive video recipe. Reset that video to cover-only editing before applying.</Text>
            </View>
          ) : null}
          {uploadProgress ? (
            <View
              style={styles.transferProgress}
              accessibilityRole="progressbar"
              accessibilityLabel={mediaUploadProgressCopy(uploadProgress)}
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(Math.min(1, Math.max(0, Number(uploadProgress.fraction) || 0)) * 100),
                text: mediaUploadProgressCopy(uploadProgress),
              }}
            >
              <Text style={styles.progress} accessibilityLiveRegion="polite">{mediaUploadProgressCopy(uploadProgress)}</Text>
              <View style={styles.transferProgressTrack}>
                <View style={[styles.transferProgressFill, { width: `${Math.min(1, Math.max(0, Number(uploadProgress.fraction) || 0)) * 100}%` }]} />
              </View>
            </View>
          ) : progress ? (
            <Text style={styles.progress} accessibilityLiveRegion="polite">Preparing media {progress.current} of {progress.total}…</Text>
          ) : null}

          {selectedAsset && snapshot ? (
            <View style={[styles.body, wide ? styles.bodyWide : styles.bodyNarrow]}>
              {wide || !keyboardOpen ? <View style={[styles.stageColumn, !wide && { flexGrow: 0, flexShrink: 0, flexBasis: "auto", minHeight: narrowStageHeight, height: narrowStageHeight }]}>
                <View style={[styles.stage, { width: size.width, height: size.height, maxWidth: "100%" }]}>
                  <View
                    style={styles.previewGesture}
                    {...(selectedAsset.kind === "image" ? stagePanResponder.panHandlers : {})}
                  >
                    <MediaEditorPreview
                      asset={{ ...selectedAsset, altText: snapshot.altText }}
                      edit={snapshot.edit}
                      showOriginal={showOriginal}
                      resolvedCover={previewCovers[selectedAsset.id]?.cover || null}
                      renderedPreview={photoPreview?.key === selectedPhotoPreviewKey ? photoPreview.artifact : null}
                    />
                  </View>
                  <Pressable
                    onPressIn={() => setShowOriginal(true)}
                    onPressOut={() => setShowOriginal(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Hold to compare with original"
                    accessibilityHint="Press and hold, or hold the B key on a keyboard"
                    style={({ pressed, focused }) => [styles.compare, pressed && styles.comparePressed, focused && focusRing]}
                  >
                    <Icon name="photo" size={14} color={colors.text} />
                    <Text style={styles.compareText}>{showOriginal ? "Original" : "Hold to compare"}</Text>
                  </Pressable>
                </View>
                <Text style={styles.stageMeta}>{selectedAsset.width} × {selectedAsset.height} · {snapshot.edit.aspect}</Text>
              </View> : null}

              <View style={[styles.inspector, wide ? styles.inspectorWide : styles.inspectorNarrow]}>
                <MediaEditorInspector
                  asset={selectedAsset}
                  snapshot={snapshot}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  onEditChange={editChange}
                  onAdjustmentChange={adjustmentChange}
                  onMetaChange={metaChange}
                  onSeal={seal}
                  coverAvailable
                  resolvedCoverTimeMs={previewCovers[selectedAsset.id]?.cover?.actualTimeMs}
                  resolvingAutoCover={resolvingAutoCoverId === selectedAsset.id}
                  altTextCompletion={altTextCompletion}
                  photoIndex={selectedPhotoIndex}
                  photoCount={photoAssets.length}
                />
              </View>
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="photo" size={32} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>Choose media first</Text>
              <Text style={styles.emptyBody}>PIT Studio opens after at least one photo or video is selected.</Text>
            </View>
          )}
          {wide || !keyboardOpen ? <MediaAssetRail
            assets={workingAssets}
            selectedId={selectedAsset?.id}
            onSelect={setSelectedId}
            onMove={onAssetMove}
            onRemove={onAssetRemove}
          /> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 64, paddingHorizontal: space(3), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft, flexDirection: "row", alignItems: "center", gap: space(3) },
  iconButton: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", ...shadow.control },
  titleWrap: { flex: 1, minWidth: 0 },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.6 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900", letterSpacing: -0.25 },
  applyButton: { minWidth: 96, height: 44, borderRadius: radius.pill, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.amber, borderBottomColor: colors.accentEdge, backgroundColor: colors.amberStrong, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, ...shadow.control },
  applyPressed: { transform: [{ translateY: 2 }] },
  applyDisabled: { backgroundColor: colors.surfaceAlt, borderColor: colors.line, opacity: 0.6 },
  applyText: { color: "#1A1206", fontFamily: displayFont, fontSize: 13, fontWeight: "900" },
  applyTextDisabled: { color: colors.textFaint },
  historyScroll: { flexGrow: 0, flexShrink: 0, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  historyBar: { minWidth: "100%", minHeight: 54, paddingHorizontal: space(3), paddingVertical: space(1), flexDirection: "row", alignItems: "center", gap: space(2) },
  historySpacer: { flex: 1 },
  saveState: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 0.7 },
  body: { flex: 1, minHeight: 0 },
  bodyNarrow: { minHeight: 0 },
  bodyWide: { flexDirection: "row" },
  stageColumn: { flex: 1, minWidth: 0, minHeight: 240, backgroundColor: "#05070B", alignItems: "center", justifyContent: "center", padding: space(4), gap: space(2), overflow: "hidden" },
  stage: { maxHeight: "100%", borderRadius: radius.md, backgroundColor: "#030409", overflow: "hidden", position: "relative", ...shadow.sheet },
  previewGesture: { ...StyleSheet.absoluteFillObject, ...(Platform.OS === "web" ? { touchAction: "none" } : {}) },
  stageMeta: { color: colors.textFaint, fontFamily: mono, fontSize: 9 },
  compare: { position: "absolute", right: 10, bottom: 10, minHeight: 44, paddingHorizontal: 13, borderRadius: radius.pill, backgroundColor: "rgba(7,9,15,0.84)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", flexDirection: "row", alignItems: "center", gap: 7 },
  comparePressed: { backgroundColor: "rgba(242,166,90,0.9)" },
  compareText: { color: colors.text, fontFamily: displayFont, fontSize: 11, fontWeight: "800" },
  inspector: { flex: 1, minHeight: 0, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  inspectorNarrow: { flex: 1, minHeight: 0 },
  inspectorWide: { flex: 0, width: 410, borderTopWidth: 0, borderLeftWidth: 1, borderLeftColor: colors.lineSoft },
  error: { marginHorizontal: space(3), marginTop: space(2), borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  errorText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 17 },
  progress: { color: colors.amber, fontFamily: mono, fontSize: 10, textAlign: "center", paddingVertical: 7 },
  transferProgress: { marginHorizontal: space(3), paddingBottom: 7 },
  transferProgressTrack: { height: 4, overflow: "hidden", borderRadius: 2, backgroundColor: colors.lineSoft },
  transferProgressFill: { height: "100%", borderRadius: 2, backgroundColor: colors.amber },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(8), gap: space(2) },
  emptyTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900" },
  emptyBody: { maxWidth: 360, color: colors.textDim, fontSize: 13, lineHeight: 19, textAlign: "center" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
