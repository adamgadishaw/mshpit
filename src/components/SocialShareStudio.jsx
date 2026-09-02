import { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  copyShareLink,
  createShareCardAsset,
  downloadShareCard,
  instagramStorySharingConfigured,
  releaseShareCardAsset,
  shareCardToInstagramStory,
  shareCardToSocialPlatform,
} from "../lib/socialShare";
import { socialShareIntentUrl } from "../domain/socialShareCard.mjs";
import { colors, displayFont, font, mono, radius, shadow, space } from "../theme";
import BrandMark from "./BrandMark";
import Icon from "./Icon";

const KIND_ACCENTS = Object.freeze({
  going: "#FF8C42",
  interested: "#5B8DEF",
  review: "#ED5B8D",
});

function shareErrorMessage(error) {
  if (error?.message === "POPUP_BLOCKED") {
    return "Your browser blocked the new window. Allow pop-ups, then try again.";
  }
  if (error?.message === "INSTAGRAM_NOT_INSTALLED") {
    return "Instagram is not installed on this phone. Nothing was shared.";
  }
  if (error?.message === "INSTAGRAM_STORY_NOT_CONFIGURED") {
    return "Instagram Story sharing is not configured in this app build. Nothing was shared.";
  }
  if (error?.message === "INSTAGRAM_STORY_NOT_OPENED") {
    return "Instagram did not open the Story editor. Nothing was shared.";
  }
  if (error?.message === "INSTAGRAM_STORY_UNAVAILABLE") {
    return "This app build does not include Instagram Story sharing. Nothing was shared.";
  }
  if (error?.message === "STORY_ARTWORK_UNAVAILABLE") {
    return "The Story card is not ready yet. Copy the link or try again.";
  }
  if (error?.message === "SOCIAL_ARTWORK_UNAVAILABLE") {
    return "The finished share card is not ready. Wait a moment and try again.";
  }
  if (error?.message === "SOCIAL_SHARE_UNAVAILABLE" || error?.message === "SOCIAL_SHARE_NOT_OPENED") {
    return "That app or share sheet did not open. Nothing was posted.";
  }
  return "That share option did not open. Copy the link and try again.";
}

function LocalShareCard({ model }) {
  const accent = KIND_ACCENTS[model.kind] || colors.amberStrong;
  return (
    <View style={styles.previewCard} accessibilityRole="image" accessibilityLabel={model.accessibilityLabel}>
      <View style={[styles.register, { backgroundColor: accent }]} />
      <View style={styles.previewTopline}>
        <View style={styles.brandLockup}>
          <BrandMark size={27} color={accent} />
          <View>
            <Text style={styles.brandName}>MSHPIT</Text>
            <Text style={styles.brandSub}>LIVE MUSIC, REMEMBERED</Text>
          </View>
        </View>
        <View style={[styles.kindPill, { borderColor: accent }]}>
          <Text style={[styles.kindPillText, { color: accent }]}>{model.eyebrow}</Text>
        </View>
      </View>

      <View style={styles.artworkStage}>
        {model.artworkUri ? (
          <ExpoImage
            source={{ uri: model.artworkUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={160}
            accessible={false}
          />
        ) : (
          <View style={styles.abstractArtwork} pointerEvents="none">
            <View style={[styles.stageBeam, styles.stageBeamLeft, { backgroundColor: accent + "36" }]} />
            <View style={[styles.stageBeam, styles.stageBeamRight, { backgroundColor: colors.cool + "28" }]} />
            <View style={[styles.recordRing, { borderColor: accent + "9A" }]}>
              <View style={[styles.recordLabel, { backgroundColor: accent }]} />
            </View>
          </View>
        )}
        <View style={styles.artworkScrim} />
        <View style={styles.artworkCopy}>
          {model.authorName ? <Text style={styles.actionLine}>{model.authorName}</Text> : null}
          <Text style={styles.previewTitle} numberOfLines={2}>{model.title}</Text>
          {model.contextTitle && model.contextTitle !== model.title
            ? <Text style={[styles.contextTitle, { color: accent }]} numberOfLines={2}>{model.contextTitle}</Text>
            : null}
        </View>
      </View>

      <View style={styles.previewBody}>
        <View style={styles.metaRow}>
          <View style={styles.metaColumn}>
            <Text style={styles.metaLabel}>VENUE / CITY</Text>
            <Text style={styles.metaValue} numberOfLines={2}>{model.place || "Live event"}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={[styles.metaColumn, styles.metaColumnRight]}>
            <Text style={styles.metaLabel}>DATE / TIME</Text>
            <Text style={[styles.metaValue, styles.metaValueRight]} numberOfLines={2}>
              {[model.dateLabel, model.timeLabel].filter(Boolean).join(" · ") || "See event details"}
            </Text>
          </View>
        </View>
        {model.kind === "review" && model.rating ? (
          <View style={styles.scoreRow}>
            <View style={[styles.scoreMark, { backgroundColor: accent }]}>
              <Icon name="star" size={14} color="#090A0D" />
            </View>
            <Text style={styles.scoreValue}>{model.rating.toFixed(1)}</Text>
            <Text style={styles.scoreLabel}>FAN SCORE / 5</Text>
          </View>
        ) : null}
        {model.quote ? (
          <Text style={styles.quote} numberOfLines={3}>“{model.quote}”</Text>
        ) : null}
      </View>

      <View style={styles.perforation}>
        <View style={styles.perforationNotchLeft} />
        <View style={styles.perforationLine} />
        <View style={styles.perforationNotchRight} />
      </View>
      <View style={styles.previewFooter}>
        <Text style={styles.footerPrompt}>SEE THE FULL NIGHT</Text>
        <Text style={[styles.footerUrl, { color: accent }]}>MSHPIT.COM</Text>
      </View>
    </View>
  );
}

function ShareAction({ label, detail, mark, icon, onPress, disabled, active, accent = colors.amber }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      accessibilityState={{ disabled: !!disabled, busy: !!active }}
      style={({ pressed }) => [
        styles.shareAction,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={[styles.actionMark, { borderColor: accent + "90" }]}>
        {icon ? <Icon name={icon} size={18} color={accent} /> : <Text style={[styles.actionMarkText, { color: accent }]}>{mark}</Text>}
      </View>
      <View style={styles.actionCopy}>
        <Text style={styles.actionLabel}>{active ? "Working…" : label}</Text>
        <Text style={styles.actionDetail} numberOfLines={2}>{detail}</Text>
      </View>
    </Pressable>
  );
}

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
        accessibilityLabel={`Share ${model.kind === "review" ? "review" : model.kind + " status"}`}
        accessibilityHint="Preview a branded card and choose where to share it"
        style={({ pressed }) => [styles.shareTrigger, showLabel && styles.shareTriggerLabelled, pressed && styles.pressed, style]}
      >
        <Icon name="share" size={17} color={color} />
        {showLabel ? <Text style={[styles.shareTriggerText, { color }]}>{label}</Text> : null}
      </Pressable>
      {open ? (
        <SocialShareStudio
          accountId={accountId}
          model={model}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export default function SocialShareStudio({ accountId = null, model, onClose }) {
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === "web" && width >= 760;
  const nativeStory = Platform.OS !== "web";
  const storyConfigured = instagramStorySharingConfigured();
  const [assetState, setAssetState] = useState({ status: "loading", asset: null });
  const [busyAction, setBusyAction] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const accent = KIND_ACCENTS[model?.kind] || colors.amberStrong;
  const renderKind = model?.renderRequest?.kind || null;
  const renderPostId = model?.renderRequest?.postId || null;
  const renderEventId = model?.renderRequest?.eventId || null;
  const renderIntent = model?.renderRequest?.intent || null;
  const renderModel = useMemo(() => {
    if (!model || !renderKind) return null;
    return {
      id: model.id,
      kind: model.kind,
      renderRequest: renderKind === "post"
        ? { kind: "post", postId: renderPostId }
        : { kind: "event", eventId: renderEventId, intent: renderIntent },
    };
  }, [model?.id, model?.kind, renderEventId, renderIntent, renderKind, renderPostId]);

  useEffect(() => {
    if (!renderModel) return undefined;
    const controller = new AbortController();
    let active = true;
    let prepared = null;
    setAssetState({ status: "loading", asset: null });
    void createShareCardAsset(renderModel, { accountId, signal: controller.signal })
      .then((asset) => {
        prepared = asset || null;
        if (!active) {
          releaseShareCardAsset(prepared);
          return;
        }
        setAssetState({ status: prepared ? "ready" : "unavailable", asset: prepared });
      })
      .catch((error) => {
        if (!active || error?.name === "AbortError") return;
        setAssetState({ status: "unavailable", asset: null });
      });
    return () => {
      active = false;
      controller.abort();
      releaseShareCardAsset(prepared);
    };
  }, [accountId, renderModel]);

  if (!model) return null;

  const run = async (name, task, success) => {
    if (busyAction) return;
    setBusyAction(name);
    setFeedback(null);
    try {
      const result = await task();
      setFeedback({ type: "success", text: typeof success === "function" ? success(result) : success });
    } catch (error) {
      if (error?.name !== "AbortError") {
        setFeedback({
          type: "error",
          text: shareErrorMessage(error),
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const shareToStory = () => run(
    "instagram",
    () => shareCardToInstagramStory(model, { preparedAsset: assetState.asset }),
    (result) => {
      if (result?.mode === "instagram-story") {
        return "Instagram opened a Story draft. Nothing was posted automatically.";
      }
      if (result?.mode === "dismissed") return "Share options closed. Nothing was posted.";
      if (result?.mode === "web-share-sheet") {
        return "Your share options opened with the card and Mshpit link. Choose an available app and post when ready.";
      }
      return "The Story card download started. Add it to Instagram when ready.";
    },
  );
  const shareTo = (platform) => {
    const url = socialShareIntentUrl(platform, model);
    if (!url) return;
    const label = platform === "x" ? "X" : "Facebook";
    void run(
      platform,
      () => shareCardToSocialPlatform(platform, model, { preparedAsset: assetState.asset, intentUrl: url }),
      (result) => {
        if (result?.mode === "dismissed") return "Share options closed. Nothing was posted.";
        if (Platform.OS === "web") {
          if (result?.mode === "web-share-sheet") {
            return "Your share options opened with the card and Mshpit link. Choose an available app and post when ready.";
          }
          return `${label}’s web composer opened and the card download started. Attach the downloaded card before posting.`;
        }
        if (result?.mode === "native-share-sheet") {
          return "Your share sheet opened with the card and Mshpit link. Choose an app, review it, and post when ready.";
        }
        return `${label} opened with the card and Mshpit link. Review it there—nothing was posted automatically.`;
      },
    );
  };
  const copyLink = () => run("copy", () => copyShareLink(model.url), "Link copied.");
  const download = () => run(
    "download",
    () => downloadShareCard(model, { preparedAsset: assetState.asset }),
    "Share card download started.",
  );
  const instagramLabel = "Instagram Story";
  const instagramDetail = nativeStory
    ? storyConfigured
      ? "Open this card in Instagram’s Story editor"
      : "Instagram Story sharing is unavailable in this app build"
    : "Open your share options with this card, or save it to add to Instagram";
  const socialDetail = (platform) => Platform.OS === "web"
    ? `Open your share options with this card, or use ${platform}’s web composer`
    : Platform.OS === "android"
      ? `Open ${platform} with this card and the Mshpit link`
      : "Open the iPhone share sheet with this card and the Mshpit link";

  return (
    <Modal
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
    >
      <View style={[styles.overlay, desktop && styles.overlayDesktop]}>
        <Pressable accessibilityLabel="Close share preview" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView
          accessibilityLabel={`Share ${model.title}`}
          accessibilityViewIsModal
          edges={["bottom"]}
          onAccessibilityEscape={onClose}
          style={[styles.sheet, desktop && styles.sheetDesktop]}
        >
          <View style={[styles.handle, desktop && styles.handleDesktop]} />
          <View style={styles.topbar}>
            <View style={styles.topbarCopy}>
              <Text style={[styles.kicker, { color: accent }]}>SHARE FROM MSHPIT</Text>
              <Text style={styles.sheetTitle}>{model.kind === "review" ? "Share your review" : "Share your night"}</Text>
              <Text style={styles.sheetIntro}>A clean card with the key details, plus a link you can share.</Text>
            </View>
            <Pressable accessibilityLabel="Close share preview" accessibilityRole="button" hitSlop={10} onPress={onClose} style={styles.closeButton}>
              <Icon name="x" size={20} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {assetState.asset?.previewUri ? (
              <View style={styles.finalPreview}>
                <ExpoImage
                  source={{ uri: assetState.asset.previewUri }}
                  style={styles.finalPreviewImage}
                  contentFit="contain"
                  accessibilityLabel={model.accessibilityLabel}
                />
              </View>
            ) : <LocalShareCard model={model} />}
            <Text style={styles.cardStatus}>
              {assetState.status === "loading"
                ? "Preparing the final share card…"
                : assetState.status === "ready"
                  ? "Share artwork ready"
                  : "The artwork is unavailable right now. You can still copy the link."}
            </Text>

            <View style={styles.actionsGrid}>
              <ShareAction
                accent={accent}
                active={busyAction === "instagram"}
                detail={instagramDetail}
                disabled={!!busyAction || assetState.status === "loading"
                  || assetState.status !== "ready"
                  || (nativeStory && !storyConfigured)}
                icon="camera"
                label={instagramLabel}
                onPress={shareToStory}
              />
              <ShareAction
                accent={colors.text}
                active={busyAction === "x"}
                detail={socialDetail("X")}
                disabled={!!busyAction || assetState.status !== "ready"}
                label="X"
                mark="X"
                onPress={() => shareTo("x")}
              />
              <ShareAction
                accent={colors.cool}
                active={busyAction === "facebook"}
                detail={socialDetail("Facebook")}
                disabled={!!busyAction || assetState.status !== "ready"}
                label="Facebook"
                mark="f"
                onPress={() => shareTo("facebook")}
              />
              <ShareAction
                accent={colors.amber}
                active={busyAction === "copy"}
                detail="Copy the public page address"
                disabled={!!busyAction}
                icon="external"
                label="Copy link"
                onPress={copyLink}
              />
              {Platform.OS === "web" ? (
                <ShareAction
                  accent={colors.magenta}
                  active={busyAction === "download"}
                  detail="Save the finished PNG card"
                  disabled={!!busyAction || assetState.status !== "ready"}
                  icon="photo"
                  label="Download card"
                  onPress={download}
                />
              ) : null}
            </View>
            <Text style={styles.platformNote}>
              The iPhone and Android apps can open Instagram’s Story editor. Supported browsers open your device’s share options. Browsers cannot choose a destination or post automatically; other browsers download the card and open the X or Facebook web composer.
            </Text>
            {feedback ? (
              <Text
                selectable
                accessibilityLiveRegion="polite"
                accessibilityRole={feedback.type === "error" ? "alert" : "text"}
                style={[styles.feedback, feedback.type === "error" ? styles.feedbackError : styles.feedbackSuccess]}
              >
                {feedback.text}
              </Text>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", alignItems: "center", paddingTop: space(7), backgroundColor: "rgba(4,5,8,0.78)" },
  overlayDesktop: { justifyContent: "center", paddingHorizontal: space(6), paddingVertical: space(8) },
  sheet: { width: "100%", maxWidth: 760, maxHeight: "94%", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderBottomWidth: 0, borderColor: colors.line, backgroundColor: colors.bgElev, overflow: "hidden", ...shadow.sheet },
  sheetDesktop: { maxHeight: "92%", borderRadius: radius.lg, borderBottomWidth: 1 },
  handle: { width: 42, height: 4, alignSelf: "center", marginTop: 9, borderRadius: 2, backgroundColor: colors.line },
  handleDesktop: { height: 0, marginTop: 0, opacity: 0 },
  topbar: { minHeight: 86, flexDirection: "row", alignItems: "center", gap: space(3), paddingHorizontal: space(5), paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  topbarCopy: { flex: 1, minWidth: 0 },
  kicker: { fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  sheetTitle: { color: colors.text, fontFamily: displayFont, fontSize: 22, fontWeight: "900", letterSpacing: -0.35, marginTop: 3 },
  sheetIntro: { color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 17, marginTop: 3 },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  content: { padding: space(4), gap: space(3) },
  previewCard: { width: "100%", maxWidth: 440, alignSelf: "center", borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: "#3D3F49", backgroundColor: "#090A0D", overflow: "hidden", boxShadow: "0 18px 46px rgba(0,0,0,0.42)" },
  register: { height: 5 },
  previewTopline: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2), paddingHorizontal: space(4) },
  brandLockup: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: space(2) },
  brandName: { color: "#FFF8EE", fontFamily: mono, fontSize: 11, fontWeight: "900", letterSpacing: 2.2 },
  brandSub: { color: "#858895", fontFamily: mono, fontSize: 6.5, fontWeight: "900", letterSpacing: 1.15, marginTop: 2 },
  kindPill: { flexShrink: 0, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: space(2), paddingVertical: 5 },
  kindPillText: { fontFamily: mono, fontSize: 7.5, fontWeight: "900", letterSpacing: 1.2 },
  artworkStage: { height: 190, justifyContent: "flex-end", overflow: "hidden", backgroundColor: "#12141B" },
  abstractArtwork: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  stageBeam: { position: "absolute", width: 110, height: 310, top: -100, borderRadius: 55 },
  stageBeamLeft: { left: 12, transform: [{ rotate: "27deg" }] },
  stageBeamRight: { right: 6, transform: [{ rotate: "-25deg" }] },
  recordRing: { width: 126, height: 126, alignItems: "center", justifyContent: "center", borderRadius: 63, borderWidth: 22, backgroundColor: "#08090C" },
  recordLabel: { width: 25, height: 25, borderRadius: 13 },
  artworkScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(3,4,8,0.45)" },
  artworkCopy: { zIndex: 1, paddingHorizontal: space(4), paddingBottom: space(4) },
  actionLine: { color: "#D4D0C8", fontFamily: mono, fontSize: 8.5, fontWeight: "900", letterSpacing: 1.15, textTransform: "uppercase" },
  previewTitle: { color: "#FFF8EE", fontFamily: displayFont, fontSize: 30, lineHeight: 32, fontWeight: "900", letterSpacing: -0.8, marginTop: 5 },
  contextTitle: { fontFamily: displayFont, fontSize: 12.5, lineHeight: 17, fontWeight: "900", marginTop: 4 },
  previewBody: { paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(3) },
  metaRow: { flexDirection: "row", alignItems: "stretch", gap: space(3) },
  metaColumn: { flex: 1, minWidth: 0 },
  metaColumnRight: { alignItems: "flex-end" },
  metaDivider: { width: 1, backgroundColor: "#333641" },
  metaLabel: { color: "#858895", fontFamily: mono, fontSize: 7, fontWeight: "900", letterSpacing: 1.2 },
  metaValue: { color: "#FFF8EE", fontFamily: displayFont, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 5 },
  metaValueRight: { textAlign: "right" },
  scoreRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(3), paddingTop: space(3), borderTopWidth: 1, borderTopColor: "#252832" },
  scoreMark: { width: 29, height: 29, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  scoreValue: { color: "#FFF8EE", fontFamily: mono, fontSize: 21, fontWeight: "900" },
  scoreLabel: { color: "#858895", fontFamily: mono, fontSize: 7.5, fontWeight: "900", letterSpacing: 1.1 },
  quote: { color: "#D7D4CC", fontFamily: font, fontSize: 12.5, lineHeight: 18, marginTop: space(3) },
  perforation: { height: 17, flexDirection: "row", alignItems: "center" },
  perforationLine: { flex: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: "#3D3F49" },
  perforationNotchLeft: { width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.bgElev },
  perforationNotchRight: { width: 14, height: 14, borderRadius: 7, marginRight: -7, backgroundColor: colors.bgElev },
  previewFooter: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3), paddingHorizontal: space(4) },
  footerPrompt: { color: "#858895", fontFamily: mono, fontSize: 7.5, fontWeight: "900", letterSpacing: 1.25 },
  footerUrl: { fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  finalPreview: { width: "100%", maxWidth: 300, aspectRatio: 9 / 16, alignSelf: "center", borderRadius: radius.md, overflow: "hidden", backgroundColor: "#090A0D", ...shadow.card },
  finalPreviewImage: { width: "100%", height: "100%" },
  cardStatus: { color: colors.textFaint, fontFamily: mono, fontSize: 9, lineHeight: 14, textAlign: "center", letterSpacing: 0.5 },
  actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) },
  shareAction: { minWidth: 0, minHeight: 68, flexGrow: 1, flexBasis: 230, flexDirection: "row", alignItems: "center", gap: space(3), borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: space(3), paddingVertical: space(2) },
  actionMark: { width: 38, height: 38, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, backgroundColor: colors.bgElev },
  actionMarkText: { fontFamily: displayFont, fontSize: 17, fontWeight: "900" },
  actionCopy: { flex: 1, minWidth: 0 },
  actionLabel: { color: colors.text, fontFamily: displayFont, fontSize: 13, fontWeight: "900" },
  actionDetail: { color: colors.textDim, fontFamily: font, fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  platformNote: { color: colors.textDim, fontFamily: font, fontSize: 11, lineHeight: 16, paddingHorizontal: space(1) },
  feedback: { borderRadius: radius.sm, borderWidth: 1, padding: space(3), fontFamily: font, fontSize: 12, lineHeight: 17 },
  feedbackSuccess: { color: colors.good, borderColor: colors.good + "70", backgroundColor: colors.surface },
  feedbackError: { color: colors.danger, borderColor: colors.danger + "70", backgroundColor: colors.surface },
  shareTrigger: { minWidth: 44, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.sm },
  shareTriggerLabelled: { alignSelf: "flex-start", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, paddingHorizontal: space(3) },
  shareTriggerText: { fontFamily: displayFont, fontSize: 12, fontWeight: "900" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.44 },
});
