import { Suspense, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, Platform, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import { useIOSProfileEditor } from "../hooks/useIOSProfileEditor";
import { useAccountTaskScope } from "../hooks/useAccountTaskScope";
import { useProfileImageUpload } from "../hooks/useProfileImageUpload";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import LocationPicker from "../components/LocationPicker";
import { lazyWithRetry } from "../lib/lazyWithRetry";

// Loaded only when someone opens the artist picker from their profile.
const PickArtistsScreen = lazyWithRetry(() => import("./PickArtistsScreen"), "PickArtistsScreen");
import Button from "../components/Button";
import SheetHeader from "../components/SheetHeader";
import { isDurableMediaUrl, reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";
import {
  profileImagePickerOptions,
  profileImageSelectionHint,
} from "../domain/profileImagePolicy.mjs";
import {
  PROFILE_GENRE_MAX,
  profileGenreOptions,
  profileGenreSelection,
} from "../domain/genrePreferences.mjs";
import { cleanHandle, isHandle, isName } from "../domain/validation.mjs";
import { PROFILE_ACCENT_OPTIONS, PROFILE_FAVORITE_SHOWS_MAX, PROFILE_PRONOUNS_MAX, pinnableShow, profileAccentColor, toggleFavoriteShow } from "../domain/profileAccents.mjs";
import { formatDate } from "../domain/dates.mjs";
import { useProfileHistory } from "../features/profileHistory/useProfileHistory";
import { createEditProfileCloseGuard } from "./editProfileCloseGuard.mjs";
import { changedProfileDraftFields } from "../domain/profileEditDraft.mjs";

import { accountFormError } from "../domain/accountFormError.mjs";

const AVATAR_IMAGE_HINT = profileImageSelectionHint("avatar", { platform:Platform.OS });
const BANNER_IMAGE_HINT = profileImageSelectionHint("banner", { platform:Platform.OS });

export default function EditProfileScreen({ onClose, closeGuardRef, isCurrentRoute }) {
  const { session, updateProfile, locationCenter, chatAuthEpoch } = useStore();
  const scrollRef = useRef(null);
  const accountTasks = useAccountTaskScope(session?.id);
  const { uploadProfileImage, imageCropDialog } = useProfileImageUpload();
  const uploadSelectedImage = (asset, purpose, task) => uploadProfileImage(asset, purpose, {
    signal:task.controller.signal,
    upload:(selected, { signal }) => uploadMediaAsset(selected, purpose, { expectedAccountId:task.accountId, signal }),
  });
  const [name, setName] = useState(session?.name || "");
  const [handle, setHandle] = useState(session?.handle || "");
  const [bio, setBio] = useState(session?.bio || "");
  const [avatarUri, setAvatarUri] = useState(isDurableMediaUrl(session?.avatarUri) ? session.avatarUri : null);
  const [banner, setBanner] = useState(isDurableMediaUrl(session?.banner) ? session.banner : null);
  const [genres, setGenres] = useState(session?.genres || []);
  const [genreError, setGenreError] = useState("");
  const [home, setHome] = useState(session?.home || null);
  const [pickingCity, setPickingCity] = useState(false);
  const [pickingArtists, setPickingArtists] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => { if (saveError) scrollRef.current?.scrollTo?.({ y: 0, animated: true }); }, [saveError]);
  const [mediaError, setMediaError] = useState("");
  // Make it yours: pronouns, an accent colour and up to four favorite shows.
  const [pronouns, setPronouns] = useState(session?.pronouns || "");
  const [accent, setAccent] = useState(session?.accent || null);
  const [favoriteShows, setFavoriteShows] = useState(() => (Array.isArray(session?.favoriteShows) ? session.favoriteShows : []));
  const [originalDraft] = useState(() => ({ name: name.trim(), handle, bio: bio.trim(), avatarUri, banner,
    genres, home, pronouns: pronouns.trim() || null, accent: accent || null, favoriteShows }));
  const patch = changedProfileDraftFields(originalDraft, {
    name: name.trim(), handle, bio: bio.trim(), avatarUri, banner, genres, home,
    pronouns: pronouns.trim() || null, accent: accent || null, favoriteShows,
  });
  const nameInvalid = Object.hasOwn(patch, "name") && !isName(name);
  const nameError = "Use a name with letters or numbers and basic punctuation (no underscores or emoji).";
  const handleChanged = Object.hasOwn(patch, "handle");
  const handleInvalid = handleChanged && !isHandle(handle);
  const history = useProfileHistory({ accountId: session?.id, targetId: session?.id, enabled: !!session?.id });
  const myShows = (Array.isArray(history.posts) ? history.posts : []).filter(pinnableShow);
  const historyLoading = ["idle", "loading", "refreshing"].includes(history.status);

  const iosEditor = useIOSProfileEditor({ accountId: session?.id, authEpoch: chatAuthEpoch,
    picker: pickingCity || pickingArtists, isCurrentRoute });
  const edit = action => iosEditor ? iosEditor.edit(action) : action;
  const locked = !!iosEditor?.locked;
  const editorCloseRef = useRef(null);
  const draft = { name, handle, bio, avatarUri, banner, genres, home, pronouns, accent, favoriteShows };
  if (Platform.OS === "ios" && !editorCloseRef.current) {
    editorCloseRef.current = createEditProfileCloseGuard({ accountId: session?.id, draft, alert: (...args) => Alert.alert(...args) });
  }
  const editorClose = editorCloseRef.current;
  editorClose?.update({ accountId: session?.id, draft, busy: locked || saving || uploadingAvatar || uploadingBanner,
    dismissPicker: pickingCity ? () => setPickingCity(false) : pickingArtists ? () => setPickingArtists(false) : null });
  useEffect(() => {
    if (!editorClose) return undefined;
    editorClose.mount();
    const guard = editorClose.guard;
    if (closeGuardRef) closeGuardRef.current = guard;
    return () => {
      editorClose.dispose();
      if (closeGuardRef?.current === guard) closeGuardRef.current = null;
    };
  }, [editorClose, closeGuardRef]);
  const requestClose = editorClose ? () => editorClose.close(onClose) : onClose;

  if (pickingCity) {
    return (
      <LocationPicker
        onClose={edit(() => setPickingCity(false))}
        onSelect={edit((place) => {
          setHome(locationCenter(place));
          setPickingCity(false);
        })}
      />
    );
  }

  if (pickingArtists) {
    return (
      <Suspense fallback={null}>
        <PickArtistsScreen
          showTheme={false}
          onDone={edit(() => setPickingArtists(false))}
          onSkip={edit(() => setPickingArtists(false))}
        />
      </Suspense>
    );
  }

  const pickPhotoTask = async (command) => {
    if (uploadingAvatar || saving) return;
    const task = accountTasks.begin(session?.id);
    if (!task) return;
    setMediaError("");
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync(profileImagePickerOptions("avatar", { platform: Platform.OS }));
    } catch (error) {
      if (task.isCurrent() && (!command || command.isCurrent())) {
        reportMediaPickerError(error, "Opening the profile photo library");
        setMediaError("The photo library could not be opened. Try again or choose another photo.");
      }
      task.finish();
      return;
    }
    if (!(task.isCurrent() && (!command || command.isCurrent())) || !res || res.canceled || !res.assets?.[0]) { task.finish(); return; }
    setUploadingAvatar(true);
    try {
      const uploaded = await uploadSelectedImage(res.assets[0], "avatar", task);
      if (task.isCurrent() && (!command || command.isCurrent()) && uploaded) setAvatarUri(uploaded);
    } catch (error) {
      // Keep the draft photo and a persistent error beside its controls, even
      // when the transport rejects before publishing a global diagnostic.
      if (task.isCurrent() && (!command || command.isCurrent())) setMediaError(accountFormError(error, "Your profile photo could not be uploaded. Choose another photo and try again."));
    } finally {
      if (task.isCurrent() && (!command || command.isCurrent())) setUploadingAvatar(false);
      task.finish();
    }
  };
  const pickBannerTask = async (command) => {
    if (uploadingBanner || saving) return;
    const task = accountTasks.begin(session?.id);
    if (!task) return;
    setMediaError("");
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync(profileImagePickerOptions("banner", { platform: Platform.OS }));
    } catch (error) {
      if (task.isCurrent() && (!command || command.isCurrent())) {
        reportMediaPickerError(error, "Opening the banner photo library");
        setMediaError("The photo library could not be opened. Try again or choose another photo.");
      }
      task.finish();
      return;
    }
    if (!(task.isCurrent() && (!command || command.isCurrent())) || !res || res.canceled || !res.assets?.[0]) { task.finish(); return; }
    setUploadingBanner(true);
    try {
      const uploaded = await uploadSelectedImage(res.assets[0], "banner", task);
      if (task.isCurrent() && (!command || command.isCurrent()) && uploaded) setBanner(uploaded);
    } catch (error) {
      // Keep the editor open with its previous banner when upload fails.
      if (task.isCurrent() && (!command || command.isCurrent())) setMediaError(accountFormError(error, "Your profile banner could not be uploaded. Choose another photo and try again."));
    } finally {
      if (task.isCurrent() && (!command || command.isCurrent())) setUploadingBanner(false);
      task.finish();
    }
  };

  const pickPhoto = () => iosEditor ? iosEditor.run(command => editorClose.runBusy(() => pickPhotoTask(command)), { media: true }) : pickPhotoTask();
  const pickBanner = () => iosEditor ? iosEditor.run(command => editorClose.runBusy(() => pickBannerTask(command)), { media: true }) : pickBannerTask();

  const genreOptions = profileGenreOptions(genres);
  const genreSelection = profileGenreSelection(genres);
  const genresInvalid = Object.hasOwn(patch, "genres") && !genreSelection.valid;
  const toggleGenre = (genre) => setGenres((current) => {
    if (current.includes(genre)) {
      setGenreError("");
      return current.filter((value) => value !== genre);
    }
    if (current.length >= PROFILE_GENRE_MAX) {
      setGenreError("Choose up to 3 music genres.");
      return current;
    }
    setGenreError("");
    return [...current, genre];
  });

  const mediaBusy = uploadingAvatar || uploadingBanner;
  const saveTask = async (command) => {
    if (mediaBusy || saving) return;
    if (nameInvalid) { setSaveError(nameError); return; }
    if (handleInvalid) {
      setSaveError("Use 3–20 letters, numbers, or underscores for your @username.");
      return;
    }
    if (genresInvalid) {
      setGenreError(genreSelection.error);
      return;
    }
    const task = accountTasks.begin(session?.id);
    if (!task) return;
    setSaving(true);
    setSaveError("");
    try {
      const result = await Promise.resolve(updateProfile({
        ...patch,
        ...(Object.hasOwn(patch, "genres") ? { genres: genreSelection.genres } : {}),
        // Pins whose review is gone are dropped rather than failing the save.
        ...(Object.hasOwn(patch, "favoriteShows") ? { favoriteShows: history.status === "ready" && !history.nextCursor
          ? favoriteShows.filter((id) => myShows.some((post) => post.id === id)) : favoriteShows } : {}),
      }, { expectedAccountId: task.accountId, signal: task.controller.signal }));
      if (!(task.isCurrent() && (!command || command.isCurrent()))) return;
      if (result?.ok !== false) {
        if (command) command.confirm(() => editorClose.saved(onClose));
        else onClose?.();
      }
      else setSaveError(accountFormError(result?.error));
    } catch (error) {
      if (task.isCurrent() && (!command || command.isCurrent())) setSaveError(accountFormError(error));
    } finally {
      if (task.isCurrent() && (!command || command.isCurrent())) setSaving(false);
      task.finish();
    }
  };
  const save = () => iosEditor ? iosEditor.run(command => editorClose.runBusy(() => saveTask(command))) : saveTask();

  const preview = { ...session, name, avatarUri, initials: (name.trim() || "?").slice(0, 2).toUpperCase() };

  return (
    <View style={styles.wrap}>
      {imageCropDialog}
      <SheetHeader title="Edit your profile" onClose={requestClose} action={{ label: saving ? "Saving..." : mediaBusy ? (Platform.OS === "web" ? "Preparing..." : "Uploading...") : "Save", onPress: save, disabled: iosEditor?.confirmed || locked || mediaBusy || saving || genresInvalid || handleInvalid || nameInvalid }} />

      <ScrollView ref={scrollRef} style={saving ? styles.savingLock : null} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        {...(Platform.OS === "ios" ? { automaticallyAdjustKeyboardInsets: true, keyboardDismissMode: "interactive" } : {})}>
        {!!saveError && <Text style={styles.saveError} accessibilityRole="alert" accessibilityLiveRegion="assertive">{saveError}</Text>}
        <Text style={styles.profileScope}>This is the profile people see for your personal account. Artist page, promotion, and show tools are in Artist HQ.</Text>
        <Pressable {...(iosEditor ? { disabled: locked } : {})}
          style={styles.bannerEdit}
          onPress={pickBanner}
          disabled={locked || uploadingBanner || saving}
          accessibilityRole="button"
          accessibilityLabel={banner ? "Change profile banner" : "Add a profile banner"}
          accessibilityHint={BANNER_IMAGE_HINT}
        >
          {banner ? <Image source={{ uri: banner }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.bannerOverlay}>
            <Icon name="camera" size={18} color={colors.text} />
            <View>
              <Text style={styles.bannerEditTxt}>{uploadingBanner ? (Platform.OS === "web" ? "Preparing..." : "Uploading...") : banner ? "Change banner" : "Add a banner"}</Text>
              <Text style={styles.bannerFormat}>{BANNER_IMAGE_HINT}</Text>
            </View>
          </View>
        </Pressable>

        <View style={styles.avatarWrap}>
          <Avatar user={preview} size={96} />
          <Pressable {...(iosEditor ? { disabled: locked } : {})}
            style={styles.cameraBtn}
            onPress={pickPhoto}
            disabled={locked || uploadingAvatar || saving}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            accessibilityHint={AVATAR_IMAGE_HINT}
          >
            <Icon name="camera" size={16} color="#1A1206" />
          </Pressable>
        </View>
        <Pressable {...(iosEditor ? { disabled: locked } : {})}
          onPress={pickPhoto}
          disabled={locked || uploadingAvatar || saving}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          accessibilityHint={AVATAR_IMAGE_HINT}
        >
          <Text style={styles.changePhoto}>{uploadingAvatar ? (Platform.OS === "web" ? "Preparing photo..." : "Uploading photo...") : "Change photo"}</Text>
        </Pressable>
        <Text style={styles.avatarFormat}>{AVATAR_IMAGE_HINT}</Text>
        {!!mediaError && <Text style={styles.saveError} accessibilityRole="alert" accessibilityLiveRegion="assertive">{mediaError}</Text>}

        <Text style={styles.label}>NAME</Text>
        <TextInput {...(iosEditor ? { editable: !locked } : {})} style={styles.input} value={name} onChangeText={edit((value) => { setName(value); setSaveError(""); })} placeholder="Your name" placeholderTextColor={colors.textFaint} maxLength={40}
          {...(Platform.OS === "ios" ? { accessibilityLabel: "Name" } : {})} />
        {nameInvalid && <Text style={styles.genreError} accessibilityRole="alert">{nameError}</Text>}

        <Text style={styles.label}>USERNAME</Text>
        <View style={[styles.handleRow, handleInvalid && styles.handleRowBad, handleChanged && !handleInvalid && styles.handleRowGood]}>
          <Text style={styles.at}>@</Text>
          <TextInput {...(iosEditor ? { editable: !locked } : {})}
            style={styles.handleInput}
            value={handle}
            {...(Platform.OS === "ios" ? { accessibilityLabel: "Username" } : {})}
            onChangeText={edit((value) => { setHandle(cleanHandle(value)); setSaveError(""); })}
            placeholder="username"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
          {handleChanged && !handleInvalid && (
            <Text style={[styles.handleStatus, styles.good]}>ready to save</Text>
          )}
        </View>
        <Text style={styles.handleHint}>
          {handleInvalid ? "Use 3–20 letters, numbers, or underscores." : "This is your public @username across Mshpit. The server confirms it when you save."}
        </Text>

        <Text style={styles.label}>HOME CITY · OPTIONAL</Text>
        <Pressable {...(iosEditor ? { disabled: locked } : {})} style={styles.cityPick} onPress={edit(() => setPickingCity(true))}
          {...(Platform.OS === "ios" ? { accessibilityRole: "button", accessibilityLabel: "Home city", accessibilityValue: { text: home?.city || "Not selected" } } : {})}>
          <Icon name="pin" size={16} color={colors.amber} />
          <Text style={[styles.cityTxt, !home && styles.cityPlaceholder]}>{home?.city || "Pick your city"}</Text>
          <Icon name="chevron-right" size={16} color={colors.textDim} />
        </Pressable>

        <Text style={styles.label}>BIO · OPTIONAL</Text>
        <TextInput {...(iosEditor ? { editable: !locked } : {})} style={[styles.input, styles.multiline]} value={bio} onChangeText={edit(setBio)} placeholder="Tell people about yourself" placeholderTextColor={colors.textFaint} multiline maxLength={240}
          {...(Platform.OS === "ios" ? { accessibilityLabel: "Bio" } : {})} />

        <Text style={styles.label}>FAVORITE ARTISTS · OPTIONAL</Text>
        <Pressable {...(iosEditor ? { disabled: locked } : {})} style={styles.artistsBtn} onPress={edit(() => setPickingArtists(true))}
          {...(Platform.OS === "ios" ? { accessibilityRole: "button", accessibilityLabel: "Favorite artists", accessibilityValue: { text: `${session?.favoriteArtists?.length || 0} selected` }, accessibilityHint: "Choose artists for your feed" } : {})}>
          <Icon name="music" size={16} color={colors.amber} />
          <Text style={styles.artistsBtnTxt}>
            {session?.favoriteArtists?.length ? `${session.favoriteArtists.length} selected · used for your feed` : "Pick favorite artists for your feed"}
          </Text>
          <Icon name="chevron-right" size={16} color={colors.textDim} />
        </Pressable>

        <View style={styles.genreHeading}>
          <Text style={styles.label}>MUSIC GENRES</Text>
          <Text style={styles.genreCount}>{genres.length}/3 selected</Text>
        </View>
        <Text style={styles.genreHint}>Choose 1 to 3. These choices tune your artist, show, and feed recommendations.</Text>
        <View style={styles.chips} accessibilityLabel="Music genres">
          {genreOptions.map((g) => {
            const on = genres.includes(g);
            return (
              <Pressable {...(iosEditor ? { disabled: locked } : {})} key={g} style={[styles.chip, on && styles.chipOn]} onPress={edit(() => toggleGenre(g))} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{g}</Text>
              </Pressable>
            );
          })}
        </View>
        {!genres.length && !genresInvalid && <Text style={styles.genreHint}>No music choices yet. You can add them now or save your other changes first.</Text>}
        {!!(genreError || genresInvalid) && <Text style={styles.genreError} accessibilityRole="alert" accessibilityLiveRegion="assertive">{genreError || genreSelection.error}</Text>}

        <Text style={styles.sectionTitle} accessibilityRole="header">Make it yours</Text>
        <Text style={styles.genreHint}>Everything here is optional and shows on your public profile.</Text>

        <Text style={styles.label}>PRONOUNS</Text>
        <TextInput {...(iosEditor ? { editable: !locked } : {})} style={styles.input} value={pronouns} onChangeText={edit(setPronouns)} placeholder="e.g. she/her, he/him, they/them" placeholderTextColor={colors.textFaint}
          maxLength={PROFILE_PRONOUNS_MAX} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Pronouns, optional" />

        <Text style={styles.label}>ACCENT COLOR</Text>
        <View style={[styles.accentPreview, { backgroundColor: profileAccentColor(accent) || colors.surfaceAlt }]} accessible={false}>
          {banner ? <Image source={{ uri: banner }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={[styles.accentPreviewStripe, { backgroundColor: profileAccentColor(accent) || colors.line }]} />
        </View>
        <View style={styles.accentRow} accessibilityRole="radiogroup" accessibilityLabel="Profile accent color">
          <Pressable {...(iosEditor ? { disabled: locked } : {})} style={[styles.accentSwatch, styles.accentNone, !accent && styles.accentOn]} onPress={edit(() => setAccent(null))}
            accessibilityRole="radio" accessibilityState={{ checked: !accent }} accessibilityLabel="No accent color">
            <Icon name="x" size={14} color={colors.textDim} />
          </Pressable>
          {PROFILE_ACCENT_OPTIONS.map((option) => (
            <Pressable {...(iosEditor ? { disabled: locked } : {})} key={option.id} style={[styles.accentSwatch, { backgroundColor: option.color }, accent === option.id && styles.accentOn]} onPress={edit(() => setAccent(option.id))}
              accessibilityRole="radio" accessibilityState={{ checked: accent === option.id }} accessibilityLabel={`${option.label} accent`}>
              {accent === option.id ? <Icon name="check" size={15} color="#1A1206" /> : null}
            </Pressable>
          ))}
        </View>

        <View style={styles.genreHeading}>
          <Text style={styles.label}>FAVORITE SHOWS</Text>
          <Text style={styles.genreCount}>{favoriteShows.length}/{PROFILE_FAVORITE_SHOWS_MAX} pinned</Text>
        </View>
        <Text style={styles.genreHint}>Pin up to four of your reviews to the top of your profile, in the order you pick them.</Text>
        {historyLoading && !myShows.length ? <Text style={styles.genreHint}>Loading your reviews...</Text> : null}
        {!historyLoading && !myShows.length ? <Text style={styles.genreHint}>Review a show and it can be pinned here.</Text> : null}
        <View style={styles.showList}>
          {myShows.slice(0, 30).map((post) => {
            const order = favoriteShows.indexOf(post.id);
            const on = order >= 0;
            const full = !on && favoriteShows.length >= PROFILE_FAVORITE_SHOWS_MAX;
            return (
              <Pressable {...(iosEditor ? { disabled: locked } : {})} key={post.id} style={[styles.showRow, on && styles.showRowOn, full && styles.showRowFull]} onPress={edit(() => setFavoriteShows((current) => toggleFavoriteShow(current, post.id)))}
                disabled={locked || full} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: locked || full }}
                accessibilityLabel={`${on ? `Pinned ${order + 1}. ` : ""}${post.artist || post.onlineTitle}${post.venue ? ` at ${post.venue}` : ""}`}>
                <View style={[styles.showPin, on && styles.showPinOn]}><Text style={[styles.showPinText, on && styles.showPinTextOn]}>{on ? order + 1 : ""}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.showArtist} numberOfLines={1}>{post.artist || post.onlineTitle}</Text>
                  <Text style={styles.showMeta} numberOfLines={1}>{[post.venue || post.city, post.date ? formatDate(post.date, post.date) : ""].filter(Boolean).join(" · ")}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Button title={saving ? "Saving profile..." : mediaBusy ? "Uploading photo..." : "Save profile"} icon="check" onPress={save} disabled={iosEditor?.confirmed || locked || mediaBusy || saving || genresInvalid || handleInvalid || nameInvalid} style={{ marginTop: 28 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  savingLock: { pointerEvents: "none", opacity: 0.82 },
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  cancel: { color: colors.textDim, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  save: { color: colors.amber, fontSize: 15, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48, alignItems: "stretch" },
  profileScope: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  bannerEdit: { ...(Platform.OS === "ios" ? { aspectRatio: 3 } : { height: 96 }), borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  bannerOverlay: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(11,14,22,0.4)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  bannerEditTxt: { color: colors.text, fontSize: 13, fontWeight: "600" },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 10, marginTop: -2 },
  miniLabel: { fontSize: 9, letterSpacing: 1.5, fontWeight: "800", marginBottom: 6 },
  bannerFormat: { color: colors.textDim, fontSize: 10, lineHeight: 14, marginTop: 2 },
  avatarWrap: { alignSelf: "center", marginTop: 12 },
  cameraBtn: { position: "absolute", right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.bg },
  changePhoto: { color: colors.amber, fontSize: 13, textAlign: "center", marginTop: 10 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8, marginTop: 20 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  avatarFormat: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 4, textAlign: "center" },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  handleRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14 },
  handleRowGood: { borderColor: colors.good },
  handleRowBad: { borderColor: colors.danger },
  at: { color: colors.textDim, fontSize: 16, fontWeight: "700", marginRight: 2 },
  handleInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  handleStatus: { fontSize: 12, fontWeight: "700" },
  good: { color: colors.good },
  bad: { color: colors.danger },
  handleHint: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  cityPick: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 13 },
  cityTxt: { flex: 1, color: colors.text, fontSize: 15 },
  cityPlaceholder: { color: colors.textFaint },
  songField: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 13 },
  songFieldTxt: { flex: 1, color: colors.text, fontSize: 14 },
  songFieldEmpty: { color: colors.textFaint },
  artistsBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 13 },
  artistsBtnTxt: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "600" },
  genreHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  genreCount: { color: colors.amber, fontSize: 11.5, fontWeight: "700", marginBottom: 8, marginTop: 20 },
  genreHint: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: -2, marginBottom: 10 },
  genreError: { color: colors.danger, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  saveError: { color: colors.danger, fontSize: 12.5, lineHeight: 18, marginTop: 16, textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  chipTxt: { color: colors.textDim, fontSize: 13 },
  chipTxtOn: { color: colors.amber, fontWeight: "700" },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 30, marginBottom: 4 },
  accentPreview: { height: 56, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line, justifyContent: "flex-end", marginBottom: 10 },
  accentPreviewStripe: { height: 6 },
  accentRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  accentSwatch: { width: 38, height: 38, borderRadius: 19, ...(Platform.OS === "ios" ? { width: 44, height: 44, borderRadius: 22 } : {}), alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  accentNone: { backgroundColor: colors.surface, borderColor: colors.line },
  accentOn: { borderColor: colors.text },
  showList: { gap: 8 },
  showRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 10 },
  showRowOn: { borderColor: colors.amber },
  showRowFull: { opacity: 0.5 },
  showPin: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  showPinOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  showPinText: { color: colors.textDim, fontSize: 12, fontWeight: "900" },
  showPinTextOn: { color: "#1A1206" },
  showArtist: { color: colors.text, fontSize: 14, fontWeight: "800" },
  showMeta: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 28 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
});
