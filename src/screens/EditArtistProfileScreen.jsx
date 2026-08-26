import { useEffect, useState } from "react";
import { ActivityIndicator, View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import { artistMeta } from "../seed/ingested";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import Button from "../components/Button";
import SheetHeader from "../components/SheetHeader";
import { isDurableMediaUrl, reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";
import {
  changedProfileImageFields,
  profileImagePickerOptions,
  profileImageSelectionHint,
} from "../domain/profileImagePolicy.mjs";
import { artistPageEditReady } from "../domain/artistPageEditor.mjs";
import {
  beginLoadState,
  createLoadState,
  projectLoadState,
  rejectLoadState,
  resolveLoadState,
} from "../domain/loadState.mjs";
import { accountTargetScope } from "../domain/screenScope.mjs";

const AVATAR_IMAGE_HINT = profileImageSelectionHint("avatar");
const BANNER_IMAGE_HINT = profileImageSelectionHint("banner");

function ConfirmedArtistProfileEditor({
  artist,
  confirmedProfile,
  meta,
  resource,
  updateArtistProfile,
  onClose,
}) {
  const [bio, setBio] = useState(confirmedProfile.bio ?? meta?.bio ?? "");
  const initialAvatar = confirmedProfile.avatarUri ?? meta?.photo;
  const initialBanner = confirmedProfile.banner ?? meta?.photo;
  const [avatarUri, setAvatarUri] = useState(isDurableMediaUrl(initialAvatar) ? initialAvatar : null);
  const [banner, setBanner] = useState(isDurableMediaUrl(initialBanner) ? initialBanner : null);
  const [feedEnabled, setFeedEnabled] = useState(!!confirmedProfile.feedEnabled);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [bannerChanged, setBannerChanged] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [saving, setSaving] = useState(false);

  const pickPhoto = async () => {
    if (uploadingAvatar || saving) return;
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync(profileImagePickerOptions("avatar", { platform: Platform.OS }));
    } catch (error) {
      reportMediaPickerError(error, "Opening the artist profile photo library");
      return;
    }
    if (!res || res.canceled || !res.assets?.[0]) return;
    setUploadingAvatar(true);
    try {
      const uploaded = await uploadMediaAsset(res.assets[0], "avatar");
      setAvatarUri(uploaded);
      setAvatarChanged(true);
    } catch {
      // Keep the previous durable photo; the helper records themed feedback.
    } finally {
      setUploadingAvatar(false);
    }
  };

  const pickBanner = async () => {
    if (uploadingBanner || saving) return;
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync(profileImagePickerOptions("banner", { platform: Platform.OS }));
    } catch (error) {
      reportMediaPickerError(error, "Opening the artist banner photo library");
      return;
    }
    if (!res || res.canceled || !res.assets?.[0]) return;
    setUploadingBanner(true);
    try {
      const uploaded = await uploadMediaAsset(res.assets[0], "banner");
      setBanner(uploaded);
      setBannerChanged(true);
    } catch {
      // Keep this editor open so the owner can retry without losing the bio.
    } finally {
      setUploadingBanner(false);
    }
  };

  const mediaBusy = uploadingAvatar || uploadingBanner;
  const save = async () => {
    if (!artistPageEditReady(resource) || mediaBusy || saving) return;
    setSaving(true);
    try {
      const result = await updateArtistProfile(artist.name, {
        bio: bio.trim(),
        feedEnabled,
        ...changedProfileImageFields({ avatarUri, banner, avatarChanged, bannerChanged }),
      });
      if (result?.ok !== false) onClose?.();
    } catch {
      // API diagnostics already explain the failure; preserve the form values.
    } finally {
      setSaving(false);
    }
  };

  const preview = {
    avatarUri,
    initials: artist.name.slice(0, 2).toUpperCase(),
    avatarColor: colors.amber,
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader
        title="Edit public page"
        onClose={onClose}
        action={{
          label: saving ? "Saving..." : mediaBusy ? "Uploading..." : "Save",
          onPress: save,
          disabled: !artistPageEditReady(resource) || mediaBusy || saving,
        }}
      />

      <ScrollView
        style={saving ? styles.savingLock : null}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          style={styles.bannerEdit}
          onPress={pickBanner}
          disabled={uploadingBanner || saving}
          accessibilityRole="button"
          accessibilityLabel={banner ? "Change artist profile banner" : "Add an artist profile banner"}
          accessibilityHint={BANNER_IMAGE_HINT}
        >
          {banner ? <Image source={{ uri: banner }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.bannerOverlay}>
            <Icon name="camera" size={18} color={colors.text} />
            <View>
              <Text style={styles.bannerEditTxt}>{uploadingBanner ? "Uploading..." : banner ? "Change banner" : "Add a banner"}</Text>
              <Text style={styles.bannerFormat}>{BANNER_IMAGE_HINT}</Text>
            </View>
          </View>
        </Pressable>

        <View style={styles.headRow}>
          <View style={styles.avatarWrap}>
            <Avatar user={preview} size={84} />
            <Pressable
              style={styles.cameraBtn}
              onPress={pickPhoto}
              disabled={uploadingAvatar || saving}
              accessibilityRole="button"
              accessibilityLabel="Change artist profile photo"
              accessibilityHint={AVATAR_IMAGE_HINT}
            >
              <Icon name="camera" size={15} color="#1A1206" />
            </Pressable>
          </View>
        </View>
        <Pressable
          onPress={pickPhoto}
          disabled={uploadingAvatar || saving}
          accessibilityRole="button"
          accessibilityLabel="Change artist profile photo"
          accessibilityHint={AVATAR_IMAGE_HINT}
        >
          <Text style={styles.changePhoto}>{uploadingAvatar ? "Uploading photo..." : "Change profile photo"}</Text>
        </Pressable>
        <Text style={styles.avatarFormat}>{AVATAR_IMAGE_HINT}</Text>

        <Text style={styles.label}>BIO</Text>
        <TextInput style={[styles.input, styles.multiline]} value={bio} onChangeText={setBio} placeholder="Tell fans who you are" placeholderTextColor={colors.textFaint} multiline />

        <Text style={styles.label}>PAGE UPDATES</Text>
        <Pressable
          style={styles.toggleRow}
          onPress={() => setFeedEnabled((value) => !value)}
          disabled={mediaBusy || saving}
          accessibilityRole="switch"
          accessibilityLabel="Show page updates on the public artist profile"
          accessibilityHint="Controls whether fans can see short updates published from Artist HQ"
          accessibilityState={{ checked: feedEnabled, disabled: mediaBusy || saving }}
          accessibilityValue={{ text: feedEnabled ? "Shown" : "Hidden" }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>Show page updates</Text>
            <Text style={styles.toggleSub}>{feedEnabled ? "Fans can see page updates published from Artist HQ." : "Page updates stay in Artist HQ until you make them public."}</Text>
          </View>
          <View style={[styles.switch, feedEnabled && styles.switchOn]}>
            <View style={[styles.knob, feedEnabled && styles.knobOn]} />
          </View>
        </Pressable>

        <Button title={saving ? "Saving public page..." : mediaBusy ? "Uploading photo..." : "Save public page"} icon="check" onPress={save} disabled={!artistPageEditReady(resource) || mediaBusy || saving} style={{ marginTop: 28 }} />
      </ScrollView>
    </View>
  );
}

// The verified artist account and Pit staff edit the public artist page.
// Personal member-profile details remain in the separate profile editor.
export default function EditArtistProfileScreen({ artistName, onClose }) {
  const {
    session,
    artistSummary,
    loadArtistPage,
    updateArtistProfile,
    isArtistOwner,
  } = useStore();
  const artist = artistSummary(artistName);
  const meta = artistMeta(artist.name);
  const authorized = isArtistOwner(artist.name);
  const artistKey = String(artist.name || artistName || "").trim().toLowerCase();
  const editorScope = accountTargetScope(session?.id || null, `artist-page-editor:${artistKey}`);
  const [requestVersion, setRequestVersion] = useState(0);
  const [resource, setResource] = useState(() => createLoadState({
    scope: editorScope,
    status: "loading",
    data: null,
  }));
  const scopedResource = projectLoadState(resource, editorScope, null);

  useEffect(() => {
    if (!authorized || !artistKey) return;
    const controller = new AbortController();
    let active = true;
    setResource((current) => beginLoadState(current, {
      scope: editorScope,
      emptyData: null,
      retainData: false,
    }));
    void loadArtistPage(artist.name, { signal: controller.signal }).then((result) => {
      if (!active || controller.signal.aborted) return;
      if (result?.ok) {
        setResource(resolveLoadState({
          scope: editorScope,
          data: result.value,
          updatedAt: result.value.loadedAt,
        }));
        return;
      }
      setResource((current) => rejectLoadState(current, {
        scope: editorScope,
        error: result.error,
        emptyData: null,
        retainData: false,
      }));
    });
    return () => {
      active = false;
      controller.abort();
    };
    // Store reads are keyed by the authorized account and artist target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, artist.name, artistKey, editorScope, requestVersion]);

  if (!authorized) {
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Edit public page" onClose={onClose} />
        <Text style={styles.denied}>Only the verified {artist.name} account or Pit staff can edit this public page.</Text>
      </View>
    );
  }

  if (!artistPageEditReady(scopedResource)) {
    const failed = scopedResource.status === "error";
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Edit public page" onClose={onClose} />
        <View style={styles.editorGate} accessibilityLiveRegion="polite">
          {failed
            ? <Icon name="lock" size={28} color={colors.amber} />
            : <ActivityIndicator size="small" color={colors.amber} />}
          <Text style={styles.editorGateTitle}>{failed ? "Public page unavailable" : "Confirming the public page"}</Text>
          <Text selectable style={styles.editorGateText}>
            {failed
              ? scopedResource.error?.userMessage || "Pit could not confirm the current public page. Nothing can be edited or saved until it is safely loaded."
              : "Pit is loading the latest saved artist page before opening the editor."}
          </Text>
          {failed ? <Button title="Try again" icon="refresh" onPress={() => setRequestVersion((version) => version + 1)} small /> : null}
        </View>
      </View>
    );
  }

  return (
    <ConfirmedArtistProfileEditor
      key={`${editorScope}:${scopedResource.updatedAt}`}
      artist={artist}
      confirmedProfile={scopedResource.data.profile}
      meta={meta}
      resource={scopedResource}
      updateArtistProfile={updateArtistProfile}
      onClose={onClose}
    />
  );
}
const styles = StyleSheet.create({
  savingLock: { pointerEvents: "none", opacity: 0.82 },
  wrap: { flex: 1, backgroundColor: colors.bg },
  editorGate: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 28, paddingBottom: 48 },
  editorGateTitle: { color: colors.text, fontSize: 19, fontWeight: "800", textAlign: "center" },
  editorGateText: { color: colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 420 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  cancel: { color: colors.textDim, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  save: { color: colors.amber, fontSize: 15, fontWeight: "700" },
  denied: { color: colors.textDim, fontSize: 14, textAlign: "center", marginTop: 40, paddingHorizontal: 24, lineHeight: 21 },
  content: { padding: 16, paddingBottom: 48 },
  bannerEdit: { height: 120, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  bannerOverlay: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(11,14,22,0.4)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  bannerEditTxt: { color: colors.text, fontSize: 13, fontWeight: "600" },
  headRow: { marginTop: -42, paddingLeft: 4, flexDirection: "row" },
  avatarWrap: { borderWidth: 3, borderColor: colors.bg, borderRadius: 48, backgroundColor: colors.bg },
  cameraBtn: { position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.bg },
  changePhoto: { color: colors.amber, fontSize: 13, marginTop: 10, marginLeft: 4 },
  avatarFormat: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 4, marginLeft: 4 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8, marginTop: 22 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14 },
  toggleTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  toggleSub: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 4 },
  bannerFormat: { color: colors.textDim, fontSize: 10, lineHeight: 14, marginTop: 2 },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, padding: 2, justifyContent: "center" },
  switchOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.textDim },
  knobOn: { backgroundColor: "#1A1206", alignSelf: "flex-end" },
});
