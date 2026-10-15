import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, radius, space } from "../theme";
import { loadChunk } from "../lib/lazyWithRetry";
import Icon from "./Icon";

// One dynamic importer keeps the editor out of Metro's eager shared chunk.
// Cache only public component code; never an account, model or prepared PNG.
let loadedModal = null;
let pendingModal = null;
const loadModal = () => {
  if (loadedModal) return Promise.resolve(loadedModal);
  if (!pendingModal) {
    pendingModal = loadChunk(() => import("./SocialShareModal"), { name: "SocialShareModal", reload: null })
      .then((module) => {
        if (typeof module?.default !== "function") throw new Error("Share editor unavailable");
        loadedModal = module.default;
        return loadedModal;
      })
      .finally(() => { pendingModal = null; });
  }
  return pendingModal;
};
const shareScope = (accountId, model) => JSON.stringify([accountId, model?.id, model?.kind,
  model?.renderRequest?.kind, model?.renderRequest?.eventId, model?.renderRequest?.intent, model?.renderRequest?.postId]);

export function SocialShareButton({
  model,
  accountId = null,
  color = colors.textDim,
  label = "Share",
  showLabel = false,
  style,
}) {
  const [open, setOpen] = useState(false);
  if (!model) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Share ${model.kind === "review" ? "review" : model.kind === "news" ? "this story" : model.kind + " status"}`}
        accessibilityHint="Preview a branded card and choose where to share it"
        style={({ pressed }) => [styles.shareTrigger, showLabel && styles.shareTriggerLabelled, pressed && styles.pressed, style]}
      >
        <Icon name="share" size={17} color={color} />
        {showLabel ? <Text style={[styles.shareTriggerText, { color }]}>{label}</Text> : null}
      </Pressable>
      {open ? (
        <SocialShareStudio key={shareScope(accountId, model)} accountId={accountId} model={model} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export default function SocialShareStudio({ accountId = null, model, onClose }) {
  const [Editor, setEditor] = useState(() => loadedModal);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const enabled = !!model;
  useEffect(() => {
    if (!enabled || Editor) return undefined;
    let active = true;
    setFailed(false);
    // Dynamic imports cannot be aborted. Stop adopting their result on close,
    // and turn a stalled network load into a visible retry instead of a trap.
    const timeout = setTimeout(() => { active = false; setFailed(true); }, 15_000);
    void loadModal().then((Component) => {
      if (active) setEditor(() => Component);
    }).catch(() => {
      if (active) setFailed(true);
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); };
  }, [enabled, Editor, attempt]);

  if (!model) return null;
  if (Editor) return <Editor key={shareScope(accountId, model)} accountId={accountId} model={model} onClose={onClose} />;
  return (
    <Modal transparent visible animationType={Platform.OS === "web" ? "fade" : "slide"} onRequestClose={onClose}>
      <View style={styles.loadingOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close share preview" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal onAccessibilityEscape={onClose} accessibilityLabel="Share preview" style={styles.loadingSheet}>
          <Text accessibilityRole={failed ? "alert" : "status"} accessibilityLiveRegion="polite" style={styles.loadingText}>
            {failed ? "The share editor could not load. Try again, or close and reopen it." : "Opening share preview…"}
          </Text>
          {failed ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading share preview" onPress={() => setAttempt(value => value + 1)} style={styles.loadingButton}>
            <Text style={styles.loadingButtonText}>Try again</Text>
          </Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Close share preview" onPress={onClose} style={styles.loadingButton}>
            <Text style={styles.loadingButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shareTrigger: { minWidth: 44, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.sm },
  shareTriggerLabelled: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, paddingHorizontal: space(3) },
  shareTriggerText: { fontFamily: displayFont, fontSize: 13, fontWeight: "900" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  loadingOverlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: space(4), backgroundColor: "rgba(4,5,8,0.78)" },
  loadingSheet: { width: "100%", maxWidth: 420, padding: space(5), gap: space(3), backgroundColor: colors.bgElev, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  loadingText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  loadingButton: { minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: space(4) },
  loadingButtonText: { color: colors.text, fontWeight: "800" },
});
