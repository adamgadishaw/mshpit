import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import { useAccountTaskScope } from "../hooks/useAccountTaskScope";
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
import { fetchArtistBiography, saveArtistBiography } from "../features/artistBiography/artistBiographyService";
import { validateStaffArtistBiography } from "../domain/artistBiography.mjs";
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

function ArtistBiographyEditor({ artist, accountId, refreshMetadata }) {
  const [snapshot, setSnapshot] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const saveController = useRef(null);
  const artistKey = artist.key || artist.name.toLowerCase();
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null); setDraft(null); setError(""); setNote("");
    void fetchArtistBiography({ artistKey, accountId, signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      setSnapshot(value);
      const editable = value.facts || value.pendingFacts;
      setDraft({ artistType: editable?.artistType || "unknown", birthDate: editable?.birthDate || "",
        formedDate: editable?.formedDate || "", careerStartYear: editable?.careerStartYear || "", sourceUrl: editable?.sourceUrl || "" });
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message || "Artist facts could not load."); });
    return () => { controller.abort(); saveController.current?.abort(); };
  }, [artistKey, accountId, requestVersion]);
  const save = async () => {
    if (!snapshot || !draft || saveController.current) return;
    setError(""); setNote("");
    let facts;
    try { facts = validateStaffArtistBiography(draft); }
    catch (failure) { setError(failure.message); return; }
    const controller = new AbortController();
    saveController.current = controller; setSaving(true);
    try {
      const value = await saveArtistBiography({ artistKey, accountId, artistMbid: snapshot.artistMbid, revision: snapshot.revision, facts, signal: controller.signal });
      if (controller.signal.aborted) return;
      setSnapshot(value); setNote("Artist facts saved.");
      try { await refreshMetadata?.(artist.name, { signal: controller.signal }); }
      catch { if (!controller.signal.aborted) setNote("Artist facts saved. Refresh the artist page to load them."); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || "Artist facts could not save. Your edits are still here.");
    } finally {
      if (saveController.current === controller) saveController.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  };
  const field = (key, label, maximum, hint) => <View key={key}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} style={styles.input} value={draft[key]} maxLength={maximum} editable={!saving}
      onChangeText={(value) => setDraft((current) => ({ ...current, [key]: value }))} placeholder={hint} placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
  </View>;
  return <View style={styles.factsPanel}>
    <Text accessibilityRole="header" style={styles.toggleTitle}>Artist facts · staff</Text>
    <Text style={styles.toggleSub}>Only enter facts supported by the source below. These save separately and are protected from automatic refreshes.</Text>
    {snapshot?.requiresReview ? <Text selectable accessibilityRole="alert" style={styles.factsError}>The artist identity changed or was not previously confirmed. These saved facts are hidden publicly. Check them against the current artist and source before saving.</Text> : null}
    {snapshot?.legacyYear && !snapshot.facts ? <Text selectable style={styles.toggleSub}>Previous unverified year: {snapshot.legacyYear}. It stays hidden until its meaning is confirmed.</Text> : null}
    {error ? <Text selectable accessibilityRole="alert" style={styles.factsError}>{error}</Text> : null}
    {!draft ? (error ? <Button title="Reload artist facts" variant="secondary" onPress={() => setRequestVersion((value) => value + 1)} /> : <ActivityIndicator accessibilityLabel="Loading artist facts" color={colors.accent} />) : <>
      <View style={styles.factsTypes}>{[["person", "Person"], ["group", "Group"], ["other", "Other"], ["unknown", "Unknown"]].map(([value, label]) => <Button key={value} title={label} small disabled={saving} variant={draft.artistType === value ? "primary" : "secondary"}
        onPress={() => setDraft((current) => ({ ...current, artistType: value, birthDate: value === "person" ? current.birthDate : "", formedDate: value === "group" ? current.formedDate : "", careerStartYear: value === "unknown" ? "" : current.careerStartYear }))} />)}</View>
      {draft.artistType === "person" ? field("birthDate", "Birth date", 10, "YYYY, YYYY-MM, or YYYY-MM-DD") : null}
      {draft.artistType === "group" ? field("formedDate", "Formation date", 10, "YYYY, YYYY-MM, or YYYY-MM-DD") : null}
      {draft.artistType !== "unknown" ? field("careerStartYear", "Career began", 4, "Verified year, not a birthday") : null}
      {field("sourceUrl", "Source URL", 1200, "https://")}
      <Button title={saving ? "Saving artist facts..." : "Save artist facts"} onPress={save} disabled={saving} />
      {error ? <Button title="Reload saved facts" variant="secondary" disabled={saving} onPress={() => setRequestVersion((value) => value + 1)} /> : null}
    </>}
    {note ? <Text selectable accessibilityLiveRegion="polite" style={styles.toggleSub}>{note}</Text> : null}
  </View>;
}

function ConfirmedArtistProfileEditor({
  artist,
  confirmedProfile,
  meta,
  resource,
  updateArtistProfile,
  onClose,
  accountId,
  staff = false,
  refreshMetadata,
}) {
  const [bio, setBio] = useState(confirmedProfile.bio ?? meta?.bio ?? "");
  const accountTasks = useAccountTaskScope(accountId);
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
  const [saveError, setSaveError] = useState("");

  const pickPhoto = async () => {
    if (uploadingAvatar || saving) return;
    const task = accountTasks.begin(accountId);
    if (!task) return;
    setSaveError("");
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync(profileImagePickerOptions("avatar", { platform: Platform.OS }));
    } catch (error) {
      if (task.isCurrent()) reportMediaPickerError(error, "Opening the artist profile photo library");
      task.finish();
      return;
    }
    if (!task.isCurrent() || !res || res.canceled || !res.assets?.[0]) { task.finish(); return; }
    setUploadingAvatar(true);
    try {
      const uploaded = await uploadMediaAsset(res.assets[0], "avatar", { expectedAccountId: task.accountId, signal: task.controller.signal });
      if (!task.isCurrent()) return;
      setAvatarUri(uploaded);
      setAvatarChanged(true);
    } catch {
      // Keep the previous durable photo; the helper records themed feedback.
    } finally {
      if (task.isCurrent()) setUploadingAvatar(false);
      task.finish();
    }
  };

  const pickBanner = async () => {
    if (uploadingBanner || saving) return;
    const task = accountTasks.begin(accountId);
    if (!task) return;
    setSaveError("");
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync(profileImagePickerOptions("banner", { platform: Platform.OS }));
    } catch (error) {
      if (task.isCurrent()) reportMediaPickerError(error, "Opening the artist banner photo library");
      task.finish();
      return;
    }
    if (!task.isCurrent() || !res || res.canceled || !res.assets?.[0]) { task.finish(); return; }
    setUploadingBanner(true);
    try {
      const uploaded = await uploadMediaAsset(res.assets[0], "banner", { expectedAccountId: task.accountId, signal: task.controller.signal });
      if (!task.isCurrent()) return;
      setBanner(uploaded);
      setBannerChanged(true);
    } catch {
      // Keep this editor open so the owner can retry without losing the bio.
    } finally {
      if (task.isCurrent()) setUploadingBanner(false);
      task.finish();
    }
  };

  const mediaBusy = uploadingAvatar || uploadingBanner;
  const save = async () => {
    if (!artistPageEditReady(resource) || mediaBusy || saving) return;
    const task = accountTasks.begin(accountId);
    if (!task) return;
    setSaveError("");
    setSaving(true);
    try {
      const result = await updateArtistProfile(artist.name, {
        bio: bio.trim(),
        feedEnabled,
        ...changedProfileImageFields({ avatarUri, banner, avatarChanged, bannerChanged }),
      });
      if (!task.isCurrent()) return;
      if (result?.ok === true) {
        onClose?.();
      } else {
        setSaveError(result?.error?.message
          || result?.error?.userMessage
          || "Mshpit could not save this artist page. Your changes are still here so you can try again.");
      }
    } catch (error) {
      // Preserve the selected files and written bio. The inline result makes a
      // failed save visible even when a browser suppresses transient feedback.
      if (task.isCurrent()) setSaveError(error?.message
        || "Mshpit could not save this artist page. Your changes are still here so you can try again.");
    } finally {
      if (task.isCurrent()) setSaving(false);
      task.finish();
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
        title="Edit artist page"
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
        {saveError ? (
          <View style={styles.saveError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Icon name="x" size={18} color={colors.danger} />
            <Text selectable style={styles.saveErrorText}>{saveError}</Text>
          </View>
        ) : null}
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
        <TextInput style={[styles.input, styles.multiline]} value={bio} onChangeText={setBio} placeholder="Tell fans about the artist" placeholderTextColor={colors.textFaint} multiline />
        {staff ? <ArtistBiographyEditor artist={artist} accountId={accountId} refreshMetadata={refreshMetadata} /> : null}

        <Text style={styles.label}>ARTIST POSTS</Text>
        <Pressable
          style={styles.toggleRow}
          onPress={() => setFeedEnabled((value) => !value)}
          disabled={mediaBusy || saving}
          accessibilityRole="switch"
          accessibilityLabel="Show artist posts on the public artist page"
          accessibilityHint="Choose whether fans can see short posts published from Artist HQ"
          accessibilityState={{ checked: feedEnabled, disabled: mediaBusy || saving }}
          accessibilityValue={{ text: feedEnabled ? "Shown" : "Hidden" }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>Show artist posts</Text>
            <Text style={styles.toggleSub}>{feedEnabled ? "Fans can see posts published from Artist HQ." : "Posts stay hidden until you turn this on."}</Text>
          </View>
          <View style={[styles.switch, feedEnabled && styles.switchOn]}>
            <View style={[styles.knob, feedEnabled && styles.knobOn]} />
          </View>
        </Pressable>

        <Button title={saving ? "Saving artist page..." : mediaBusy ? "Uploading photo..." : "Save artist page"} icon="check" onPress={save} disabled={!artistPageEditReady(resource) || mediaBusy || saving} style={{ marginTop: 28 }} />
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
    refreshArtistCatalogMetadata,
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
        <SheetHeader title="Edit artist page" onClose={onClose} />
        <Text style={styles.denied}>Only the verified {artist.name} account or Mshpit staff can edit this artist page.</Text>
      </View>
    );
  }

  if (!artistPageEditReady(scopedResource)) {
    const failed = scopedResource.status === "error";
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Edit artist page" onClose={onClose} />
        <View style={styles.editorGate} accessibilityLiveRegion="polite">
          {failed
            ? <Icon name="lock" size={28} color={colors.amber} />
            : <ActivityIndicator size="small" color={colors.amber} />}
          <Text style={styles.editorGateTitle}>{failed ? "Artist page unavailable" : "Loading artist page"}</Text>
          <Text selectable style={styles.editorGateText}>
            {failed
              ? scopedResource.error?.userMessage || "Mshpit could not load the latest artist page. Nothing can be changed until it loads."
              : "Mshpit is loading the latest saved artist page before you make changes."}
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
      accountId={session?.id}
      staff={session?.role === "admin"}
      refreshMetadata={refreshArtistCatalogMetadata}
    />
  );
}
const styles = StyleSheet.create({
  factsPanel: { padding: 14, gap: 10, marginTop: 18, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  factsTypes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  factsError: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  savingLock: { pointerEvents: "none", opacity: 0.82 },
  wrap: { flex: 1, backgroundColor: colors.bg },
  saveError: { flexDirection: "row", alignItems: "flex-start", gap: 9, backgroundColor: colors.danger + "14", borderWidth: 1, borderColor: colors.danger + "55", borderRadius: radius.sm, padding: 12, marginBottom: 14 },
  saveErrorText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
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
