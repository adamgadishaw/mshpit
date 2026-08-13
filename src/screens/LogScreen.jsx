import { useState, useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, Alert, AppState } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, mono, radius, font, displayFont, shadow, space } from "../theme";
import { useStore } from "../store";
import { RATING_DIMS, computeReview } from "../data";

// Tour presets: pick one to attach the show to the artist without an album/tour.
const TOUR_PRESETS = ["One-off show", "Reunion tour", "Festival set", "Anniversary tour", "Surprise show"];
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import SmartImage from "../components/SmartImage";
import Stars from "../components/Stars";
import TapStars from "../components/TapStars";
import Button from "../components/Button";
import SheetHeader from "../components/SheetHeader";
import DatePicker from "../components/DatePicker";
import { isDurableMediaUrl, reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";
import { api } from "../lib/api";
import { formatDate, initialComposerDate, toIsoDate, todayIso } from "../domain/dates.mjs";
import { shouldContinueMediaBatch } from "../domain/mediaBatchPolicy.mjs";
import {
  composerDraftFingerprint,
  composerDraftHasContent,
  composerDraftTitle,
  normalizeComposerDraft,
  shouldFlushComposerDraft,
  shouldScheduleComposerDraftPersistence,
} from "../domain/composerDraft.mjs";
import { composerCloseDecision } from "../domain/composerClosePolicy.mjs";
import { PENDING_COMPOSER_PICKER_KEY } from "../domain/composerRecovery.mjs";
import { save } from "../lib/persist";

const GROUP_COLOR = { "THE BAND": colors.amber, "THE ROOM": colors.cool, "THE NIGHT": colors.magenta };
const GROUPS = ["THE BAND", "THE ROOM", "THE NIGHT"];
const submissionId = () => `post_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

// A rounded "add to your post" action, like the Facebook/Instagram composer:
// tap to reveal that attachment's input. Shows a filled state (and count) once
// something is attached so the bar reads as intentional, not a stack of fields.
function AttachChip({ icon, label, active, count, onPress, disabled }) {
  return (
    <Pressable style={[styles.attachChip, active && styles.attachChipOn]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: !!active }} accessibilityLabel={label}>
      <Icon name={icon} size={16} color={active ? colors.amber : colors.textDim} />
      <Text style={[styles.attachChipTxt, active && styles.attachChipTxtOn]} numberOfLines={1}>{label}</Text>
      {count > 0 && <Text style={styles.attachChipCount}>{count}</Text>}
    </Pressable>
  );
}

function Stepper({ label, value, onChange, color }) {
  const step = (d) => onChange(Math.max(0, Math.min(5, Math.round((value + d) * 2) / 2)));
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.stepBtn} onPress={() => step(-0.5)} hitSlop={8}>
          <Icon name="minus" size={18} color={colors.text} />
        </Pressable>
        <Text style={[styles.stepVal, { color: value > 0 ? color : colors.textFaint }]}>{value > 0 ? value.toFixed(1) : "-"}</Text>
        <Pressable style={styles.stepBtn} onPress={() => step(0.5)} hitSlop={8}>
          <Icon name="plus" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

// A failed post used to vanish with no explanation. This turns the error into
// something that tells the person what to do: the two common causes are being
// offline and hitting the hourly post limit, and both are recoverable.
function postErrorMessage(error) {
  const code = error?.serverCode || error?.body?.code || error?.code;
  const status = Number(error?.status || error?.body?.status);
  if (code === "POST_REMOVED") return "That post was removed on another device. Close this composer and start a new post.";
  if (status === 409) return "That post changed on another device. Close this composer, reopen the latest version, and apply your changes again.";
  if (code === "RATE_LIMITED" || status === 429) return "You're posting quickly. Wait a moment and try again — your post is still here.";
  if (error?.offline || status === 0 || (!status && error?.message)) return "Couldn't reach Pit. Check your connection and try again — nothing was lost.";
  return "That didn't post. Your review is still here, give it another try.";
}

function postDims(post) {
  const stored = post?.dims && typeof post.dims === "object" ? post.dims : {};
  const value = (candidate, fallback = 0) => Number.isFinite(Number(candidate)) ? Number(candidate) : Number(fallback) || 0;
  const overall = value(post?.overall);
  const band = value(post?.band, overall);
  const room = value(post?.room, overall);
  return {
    performance: value(stored.performance, band),
    setlist: value(stored.setlist, band),
    sound: value(stored.sound, room),
    venue: value(stored.venue, room),
    crowd: value(stored.crowd, overall),
    experience: value(stored.experience, overall),
  };
}

export default function LogScreen({
  onPost,
  onCancel,
  user,
  prefill,
  editing = null,
  defaultMode = "show",
  closeGuardRef,
  composerId,
  initialDraftId,
  onDraftIdentity,
  pendingMedia,
  onPendingMediaConsumed,
}) {
  const { searchArtistsApi, searchVenues, drafts, saveDraft, deleteDraft, myPlaylists, myPlaylistsStatus, loadMyPlaylists } = useStore();
  const initialRecoveryDraftRef = useRef(!editing && initialDraftId
    ? drafts.find((draft) => draft?.id === initialDraftId) || null
    : null);
  const [draftRestoreReady, setDraftRestoreReady] = useState(!initialRecoveryDraftRef.current);
  // Two kinds of post share this composer: a full show review, or a plain
  // status update ("post whatever": text and/or photos, no artist/rating).
  const [postType, setPostType] = useState(
    editing ? (editing.kind === "status" ? "status" : "show") : (prefill?.artist ? "show" : defaultMode)
  );
  const isStatus = postType === "status";
  const [draftId, setDraftId] = useState(null);
  const [savedDraftFingerprint, setSavedDraftFingerprint] = useState(null);
  const [artist, setArtist] = useState(editing?.artist || prefill?.artist || "");
  const [venue, setVenue] = useState(editing?.venue || prefill?.venue || "");
  const [city, setCity] = useState(editing?.city || prefill?.city || "");
  const [tour, setTour] = useState(editing?.tour || "");
  // Artist autocomplete: bind the review to a REAL catalog artist so it links to
  // the artist page, instead of free text that may match nothing.
  const [artistHits, setArtistHits] = useState([]);
  const [artistPicked, setArtistPicked] = useState(!!editing?.artistKey || !!prefill?.artistKey);
  // The identity behind the name. Picking a suggestion binds the review to that
  // catalog entity; typing over it drops the binding, so free text can never
  // inherit the last artist's page. The server re-checks this before storing.
  const [artistKey, setArtistKey] = useState(editing?.artistKey || prefill?.artistKey || null);
  const artistRequestRef = useRef(0);
  useEffect(() => {
    const q = artist.trim();
    const sequence = ++artistRequestRef.current;
    const controller = new AbortController();
    if (artistPicked || q.length < 2) { setArtistHits([]); return () => controller.abort(); }
    const id = setTimeout(() => searchArtistsApi(q, { signal: controller.signal }).then((list) => {
      if (!controller.signal.aborted && sequence === artistRequestRef.current) setArtistHits((list || []).slice(0, 6));
    }), 220);
    return () => { clearTimeout(id); controller.abort(); };
  }, [artist, artistPicked]);
  const [venueHits, setVenueHits] = useState([]);
  const [venuePicked, setVenuePicked] = useState(!!editing?.venue || !!prefill?.venue);
  useEffect(() => {
    const q = venue.trim();
    if (venuePicked || q.length < 2) { setVenueHits([]); return; }
    const id = setTimeout(() => setVenueHits(searchVenues(q, 6)), 120);
    return () => clearTimeout(id);
  }, [venue, venuePicked]);
  const [dims, setDims] = useState(() => editing ? postDims(editing) : { performance: 0, setlist: 0, sound: 0, venue: 0, crowd: 0, experience: 0 });
  const [ratingsDirty, setRatingsDirty] = useState(false);
  const [review, setReview] = useState(editing?.review || "");
  const [song, setSong] = useState(editing?.song || null);
  const [songUrl, setSongUrl] = useState(editing?.song?.url || "");
  const [resolvingSong, setResolvingSong] = useState(false);
  // Share one of your playlists on a status post. The chosen playlist is snapshotted
  // server-side so the post keeps its songs even if the playlist later changes.
  const [playlist, setPlaylist] = useState(editing?.playlist || null);
  const [playlistPicker, setPlaylistPicker] = useState(false);
  // Which attachment panels are revealed. A panel auto-shows when it already has
  // content (editing a post, or after you attach something), so nothing hides.
  const [showSong, setShowSong] = useState(!!editing?.song);
  const [showPhotos, setShowPhotos] = useState((editing?.photos || []).length > 0);
  const [showPlaylist, setShowPlaylist] = useState(!!editing?.playlist);
  // Only shareable playlists (public/unlisted, with songs) can be attached.
  const shareablePlaylists = (myPlaylists || []).filter((pl) => pl?.visibility !== "private" && (pl?.tracks?.length || 0) > 0);
  const togglePlaylistPanel = () => {
    const opening = !showPlaylist;
    setShowPlaylist(opening);
    if (opening && (myPlaylistsStatus === "error" || myPlaylistsStatus === "idle")) void loadMyPlaylists?.();
  };
  const [songError, setSongError] = useState("");
  const [postError, setPostError] = useState("");
  const [tags, setTags] = useState(() => (Array.isArray(editing?.tags) ? editing.tags.slice(0, 5) : []));
  const [tagDraft, setTagDraft] = useState("");
  const commitTag = (raw) => {
    const tag = String(raw || "").replace(/[,\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);
    setTagDraft("");
    if (!tag) return;
    setTags((all) => (all.length >= 5 || all.some((t) => t.toLowerCase() === tag.toLowerCase()) ? all : [...all, tag]));
  };
  const [photos, setPhotos] = useState(() => (editing?.photos || []).filter(isDurableMediaUrl));
  const [photosPublic, setPhotosPublic] = useState(editing ? editing.photosPublic !== false : true);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [mediaError, setMediaError] = useState("");
  const uploadControllerRef = useRef(null);
  const submissionIdRef = useRef(editing?.id || submissionId());
  useEffect(() => () => uploadControllerRef.current?.abort(), []);
  const [posting, setPosting] = useState(false);
  // Show date, defaults to today so logging stays one-tap, but you can set the
  // real date of a past show. Years run from this year back to 2000, descending.
  const today = new Date();
  // Held and submitted as canonical ISO; rendered through formatDate below.
  const todayStr = todayIso(today);
  const PAST_YEARS = Array.from({ length: today.getFullYear() - 1999 }, (_, i) => today.getFullYear() - i);
  // An existing post may still hold a legacy display-format date, so normalize
  // on open: editing a show must not rewrite which performance it belongs to.
  const [date, setDate] = useState(initialComposerDate({
    editing: !!editing,
    editingDate: editing?.date,
    prefillDate: prefill?.date,
    today: todayStr,
  }));
  const [showDate, setShowDate] = useState(false);

  async function uploadSelectedAssets(assets) {
    if (uploadingPhotos || posting || !Array.isArray(assets) || !assets.length) return;
    const remaining = Math.max(0, 8 - photos.length);
    if (!remaining) return;
    const selected = assets.slice(0, remaining);
    const controller = new AbortController();
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = controller;
    setUploadingPhotos(true);
    setMediaError("");
    setUploadProgress({ current: 1, total: selected.length, completed: 0 });
    let completed = 0;
    let failed = 0;
    let cancelled = false;
    let stoppedEarly = false;
    try {
      // Upload sequentially to keep mobile memory predictable. Successful
      // objects remain available even if a later selection fails.
      for (let index = 0; index < selected.length; index++) {
        const asset = selected[index];
        setUploadProgress({ current: index + 1, total: selected.length, completed });
        try {
          const uploaded = await uploadMediaAsset(asset, "post", { signal: controller.signal });
          completed += 1;
          setPhotos((current) => [...current, uploaded].filter(isDurableMediaUrl).slice(0, 8));
          setUploadProgress({ current: Math.min(index + 2, selected.length), total: selected.length, completed });
        } catch (error) {
          if (controller.signal.aborted) { cancelled = true; break; }
          failed += 1;
          // One unsupported or oversized clip must not prevent later valid
          // photos in the same picker selection from uploading. A connection,
          // auth, rate-limit, timeout, or storage failure stops immediately.
          if (!shouldContinueMediaBatch(error)) { stoppedEarly = true; break; }
        }
      }
      if (failed && !cancelled) {
        setMediaError(stoppedEarly
          ? (completed
              ? `${completed} of ${selected.length} uploads finished. Uploading stopped after a connection or storage error; try the remaining media again.`
              : "Uploading stopped after a connection or storage error. Check your connection and try again.")
          : (completed
              ? `${completed} of ${selected.length} uploads finished. ${failed} item${failed === 1 ? "" : "s"} couldn't be added.`
              : "That media didn't upload. Try a supported file or a shorter clip."));
      }
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
        setUploadingPhotos(false);
        setUploadProgress(null);
      }
    }
  }

  const addPhoto = async () => {
    if (uploadingPhotos || posting) return;
    const remaining = Math.max(0, 8 - photos.length);
    if (!remaining) return;
    let res;
    let pickerRequestId = null;
    try {
      // SDK 56 returns original iOS videos with Passthrough by default. Asking
      // before launch avoids surprising people with the permission dialog only
      // after they already selected a concert clip.
      if (Platform.OS === "ios") {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setMediaError("Pit needs photo-library access before it can attach that concert video.");
          return;
        }
      }
      if (Platform.OS === "android" && composerId) {
        // Persist both the latest draft and exact picker owner before handing
        // control to Android's external activity. MainActivity can be destroyed
        // before launchImageLibraryAsync returns.
        const durableDraftId = composerDraftHasContent(currentDraft)
          ? persistDraftSnapshot(currentDraft)
          : draftIdRef.current;
        pickerRequestId = `picker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        save(PENDING_COMPOSER_PICKER_KEY, { composerId, draftId: durableDraftId || null, requestId: pickerRequestId });
      }
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.6, videoQuality: 1, allowsMultipleSelection: true, selectionLimit: Math.min(6, remaining) });
    } catch (error) {
      if (pickerRequestId) save(PENDING_COMPOSER_PICKER_KEY, null);
      reportMediaPickerError(error, "Opening the media library");
      return;
    }
    if (pickerRequestId) save(PENDING_COMPOSER_PICKER_KEY, null);
    if (!res || res.canceled || !res.assets?.length) return;
    await uploadSelectedAssets(res.assets);
  };

  const cancelUpload = () => {
    uploadControllerRef.current?.abort();
    setMediaError("Upload stopped. Media that already finished is still attached.");
  };

  const attachSong = async () => {
    const url = songUrl.trim();
    if (!url || resolvingSong || posting || uploadingPhotos) return;
    setResolvingSong(true);
    setSongError("");
    try {
      const result = await api(`/api/youtube/oembed?url=${encodeURIComponent(url)}`, {
        context: "Checking a YouTube link",
        silent: true,
      });
      if (!result?.song?.videoId) throw new Error("No playable YouTube video was found.");
      setSong(result.song);
      setSongUrl(result.song.url || url);
    } catch {
      setSong(null);
      setSongError("That link missed the cue. Paste a YouTube watch, Shorts, or youtu.be link.");
    } finally {
      setResolvingSong(false);
    }
  };

  const setDim = (k, v) => { setRatingsDirty(true); setDims((d) => ({ ...d, [k]: v })); };
  const computed = computeReview(dims);
  const submittedRatings = editing && !ratingsDirty
    ? {
        overall: Number(editing.overall) || computed.overall,
        band: editing.band == null ? computed.band : Number(editing.band),
        room: editing.room == null ? computed.room : Number(editing.room),
      }
    : computed;
  const canPostStatus = !!(review.trim() || photos.filter(isDurableMediaUrl).length || song?.videoId || playlist);
  const canPost = isStatus ? canPostStatus : (artist.trim() && venue.trim() && computed.overall > 0);
  const submitBusy = uploadingPhotos || resolvingSong || posting;

  const currentDraft = useMemo(() => normalizeComposerDraft({
    id: draftId,
    submissionId: submissionIdRef.current,
    postType,
    artist,
    artistKey: artistPicked ? artistKey : null,
    venue,
    city,
    tour,
    date,
    dims,
    review,
    tags,
    tagDraft,
    song,
    songUrl,
    playlist,
    photos: photos.filter(isDurableMediaUrl),
    photosPublic,
    panels: { song: showSong, photos: showPhotos, playlist: showPlaylist },
  }), [draftId, postType, artist, artistPicked, artistKey, venue, city, tour, date, dims, review, tags, tagDraft, song, songUrl, playlist, photos, photosPublic, showSong, showPhotos, showPlaylist]);
  const draftFingerprint = useMemo(() => composerDraftFingerprint(currentDraft), [currentDraft]);
  const hasContent = useMemo(() => composerDraftHasContent(currentDraft), [currentDraft]);
  const initialFingerprintRef = useRef(null);
  if (initialFingerprintRef.current === null) initialFingerprintRef.current = draftFingerprint;
  const composerDirty = draftFingerprint !== initialFingerprintRef.current;
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;
  const allowNextCloseRef = useRef(false);
  const closePromptOpenRef = useRef(false);

  const persistDraftSnapshot = (candidate = currentDraft) => {
    if (editing) return null;
    const snapshot = normalizeComposerDraft({ ...candidate, id: draftIdRef.current || candidate.id });
    if (!composerDraftHasContent(snapshot)) {
      if (draftIdRef.current) deleteDraft(draftIdRef.current);
      draftIdRef.current = null;
      setDraftId(null);
      setSavedDraftFingerprint(null);
      onDraftIdentity?.(composerId, null);
      return null;
    }
    const id = saveDraft(snapshot);
    draftIdRef.current = id;
    setDraftId(id);
    setSavedDraftFingerprint(composerDraftFingerprint(snapshot));
    onDraftIdentity?.(composerId, id);
    return id;
  };
  const flushDraftRef = useRef(null);
  flushDraftRef.current = () => persistDraftSnapshot(currentDraft);

  // Autosave both composer modes after a short quiet period. The initial prefill
  // alone does not create a draft; the first user-visible change does.
  useEffect(() => {
    if (!shouldScheduleComposerDraftPersistence({
      editing: !!editing,
      dirty: composerDirty,
      hasDraft: !!draftIdRef.current,
      hasContent,
      fingerprint: draftFingerprint,
      savedFingerprint: savedDraftFingerprint,
    })) return undefined;
    const timer = setTimeout(() => persistDraftSnapshot(currentDraft), 500);
    return () => clearTimeout(timer);
    // Fingerprints are the stable dependency; store actions intentionally are
    // omitted because the monolithic Store context recreates them every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, composerDirty, hasContent, draftFingerprint, savedDraftFingerprint]);

  // Flush a pending native autosave before the app is backgrounded. Combined
  // with persist.native.js, this survives Android/iOS process termination.
  useEffect(() => {
    if (editing) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && shouldFlushComposerDraft({ editing: !!editing, dirty: composerDirty, hasDraft: !!draftIdRef.current })) flushDraftRef.current?.();
    });
    return () => subscription.remove();
  }, [editing, composerDirty]);

  // A tab close/reload cannot show our in-app confirmation. Ask the browser only
  // while work is still unsaved or a mutation is active; fully autosaved drafts
  // can leave without an unnecessary warning.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
    const shouldProtect = submitBusy || (editing ? composerDirty : (composerDirty && hasContent && draftFingerprint !== savedDraftFingerprint));
    if (!shouldProtect) return undefined;
    const beforeUnload = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [submitBusy, editing, composerDirty, hasContent, draftFingerprint, savedDraftFingerprint]);

  const stash = () => {
    if (editing || submitBusy || !hasContent) return;
    persistDraftSnapshot(currentDraft);
    allowNextCloseRef.current = true;
    onCancel?.();
  };
  const resume = (d) => {
    const restored = normalizeComposerDraft(d);
    const restoredFingerprint = composerDraftFingerprint(restored);
    draftIdRef.current = restored.id;
    setDraftId(restored.id);
    setSavedDraftFingerprint(restoredFingerprint);
    initialFingerprintRef.current = restoredFingerprint;
    onDraftIdentity?.(composerId, restored.id);
    submissionIdRef.current = restored.submissionId || submissionIdRef.current;
    setPostType(restored.postType);
    setArtist(restored.artist); setArtistPicked(!!restored.artistKey); setArtistKey(restored.artistKey); setVenue(restored.venue); setVenuePicked(!!restored.venue); setCity(restored.city);
    setTour(restored.tour); setDate(toIsoDate(restored.date) || restored.date || todayStr); setDims(restored.dims); setReview(restored.review); setTags(restored.tags); setTagDraft(restored.tagDraft); setSong(restored.song); setSongUrl(restored.songUrl); setPlaylist(restored.playlist); setPhotos(restored.photos.filter(isDurableMediaUrl)); setPhotosPublic(restored.photosPublic);
    setShowSong(restored.panels.song); setShowPhotos(restored.panels.photos); setShowPlaylist(restored.panels.playlist);
  };

  useEffect(() => {
    const recovered = initialRecoveryDraftRef.current;
    if (!recovered) return;
    initialRecoveryDraftRef.current = null;
    resume(recovered);
    setDraftRestoreReady(true);
    // Recovery is a one-time mount action tied to the frame's durable draft id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingMediaHandledRef = useRef(null);
  useEffect(() => {
    if (!draftRestoreReady || !pendingMedia?.requestId || pendingMedia.composerId !== composerId) return;
    if (pendingMediaHandledRef.current === pendingMedia.requestId) return;
    pendingMediaHandledRef.current = pendingMedia.requestId;
    const result = pendingMedia.result;
    if (result?.code) {
      reportMediaPickerError(new Error(result.message || result.code), "Recovering the media selection");
      onPendingMediaConsumed?.(pendingMedia.requestId);
      return;
    }
    if (!result || result.canceled || !result.assets?.length) {
      onPendingMediaConsumed?.(pendingMedia.requestId);
      return;
    }
    void uploadSelectedAssets(result.assets).finally(() => onPendingMediaConsumed?.(pendingMedia.requestId));
    // The request id is the ownership boundary. Other state changes during a
    // recovered upload must not enqueue the same Android selection twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRestoreReady, pendingMedia?.requestId, composerId]);

  const discardCurrentDraft = () => {
    if (draftIdRef.current) deleteDraft(draftIdRef.current);
    draftIdRef.current = null;
    setDraftId(null);
    setSavedDraftFingerprint(null);
    onDraftIdentity?.(composerId, null);
  };

  const requestCloseRef = useRef(null);
  requestCloseRef.current = ({ proceed, cancel }) => {
    const allow = typeof proceed === "function" ? proceed : () => {};
    const stay = typeof cancel === "function" ? cancel : () => {};
    if (allowNextCloseRef.current) {
      allowNextCloseRef.current = false;
      allow();
      return;
    }
    if (closePromptOpenRef.current) { stay(); return; }
    const closeDecision = composerCloseDecision({ busy: submitBusy, editing: !!editing, dirty: composerDirty, hasContent, hasDraft: !!draftIdRef.current });
    if (closeDecision === "block") {
      stay();
      Alert.alert(
        posting ? "Posting in progress" : uploadingPhotos ? "Media is still uploading" : "Checking your video",
        posting ? "Keep Pit open until the post finishes." : "Wait for this step to finish, or cancel the upload before leaving.",
      );
      return;
    }
    if (closeDecision === "confirm-edit-discard") {
      closePromptOpenRef.current = true;
      const finish = (action) => {
        if (!closePromptOpenRef.current) return;
        closePromptOpenRef.current = false;
        action();
      };
      if (Platform.OS === "web" && typeof window !== "undefined") {
        finish(window.confirm("Discard your unsaved changes to this post?") ? allow : stay);
        return;
      }
      Alert.alert("Discard changes?", "Your edits have not been saved.", [
        { text: "Keep editing", style: "cancel", onPress: () => finish(stay) },
        { text: "Discard", style: "destructive", onPress: () => finish(allow) },
      ], { cancelable: true, onDismiss: () => finish(stay) });
      return;
    }
    if (closeDecision === "confirm-draft-close") {
      // Save before prompting so even an OS interruption while the prompt is on
      // screen cannot erase the current status or show review.
      persistDraftSnapshot(currentDraft);
      closePromptOpenRef.current = true;
      const finish = (action) => {
        if (!closePromptOpenRef.current) return;
        closePromptOpenRef.current = false;
        action();
      };
      if (Platform.OS === "web" && typeof window !== "undefined") {
        finish(window.confirm("Your draft is saved. Close this composer?") ? allow : stay);
        return;
      }
      Alert.alert("Close composer?", "Your post is saved as a draft on this device.", [
        { text: "Keep editing", style: "cancel", onPress: () => finish(stay) },
        { text: "Discard draft", style: "destructive", onPress: () => finish(() => { discardCurrentDraft(); allow(); }) },
        { text: "Save & close", onPress: () => finish(allow) },
      ], { cancelable: true, onDismiss: () => finish(stay) });
      return;
    }
    if (closeDecision === "delete-empty-draft") discardCurrentDraft();
    allow();
  };

  useEffect(() => {
    if (!closeGuardRef) return undefined;
    const guard = (callbacks) => requestCloseRef.current?.(callbacks);
    closeGuardRef.current = guard;
    return () => { if (closeGuardRef.current === guard) closeGuardRef.current = null; };
  }, [closeGuardRef]);

  const submit = async () => {
    if (!canPost || submitBusy) return;
    setPosting(true);
    setPostError("");
    try {
      const durablePhotos = photos.filter(isDurableMediaUrl);
      if (isStatus) {
        const result = await onPost?.({
          id: submissionIdRef.current,
          kind: "status",
          user: editing?.user || (user
            ? { name: user.name, handle: user.handle, initials: user.initials }
            : { name: "You", handle: "you", initials: "YOU" }),
          timeAgo: editing?.timeAgo || "now",
          review: review.trim(),
          song,
          playlist,
          playlistId: playlist?.id || null,
          photos: durablePhotos,
          media: durablePhotos.length,
          photosPublic: true,
          likes: editing?.likes || 0,
          comments: editing?.comments || 0,
        });
        if (result?.ok === false) {
          setPostError(postErrorMessage(result.error));
          return;
        }
        if (draftIdRef.current) deleteDraft(draftIdRef.current);
        draftIdRef.current = null;
        setDraftId(null);
        setSavedDraftFingerprint(null);
        onDraftIdentity?.(composerId, null);
        return;
      }
      const result = await onPost?.({
        id: submissionIdRef.current,
        user: editing?.user || (user
          ? { name: user.name, handle: user.handle, initials: user.initials }
          : { name: "You", handle: "you", initials: "YOU" }),
        timeAgo: editing?.timeAgo || "now",
        artist: artist.trim(),
        artistKey: artistPicked ? artistKey : null,
        venue: venue.trim(),
        city: city.trim(),
        tour: tour.trim() || null,
        date,
        media: durablePhotos.length,
        photos: durablePhotos,
        photosPublic,
        overall: submittedRatings.overall,
        band: submittedRatings.band || submittedRatings.overall,
        room: submittedRatings.room || submittedRatings.overall,
        dims,
        review: review.trim(),
        song,
        tags: tagDraft.trim() && tags.length < 5 && !tags.some((t) => t.toLowerCase() === tagDraft.trim().toLowerCase()) ? [...tags, tagDraft.trim()] : tags,
        setlist: editing?.setlist || [],
        likes: editing?.likes || 0,
        comments: editing?.comments || 0,
        inTourWindow: editing?.inTourWindow || false,
      });
      // Failed posts stay fully editable and retain any saved draft, and now say
      // WHY: previously a rejected post silently left the composer open with no
      // message, which read as "it didn't go through" for no visible reason.
      if (result?.ok === false) { setPostError(postErrorMessage(result.error)); return; }
      if (draftIdRef.current) deleteDraft(draftIdRef.current);
      draftIdRef.current = null;
      setDraftId(null);
      setSavedDraftFingerprint(null);
      onDraftIdentity?.(composerId, null);
    } catch (error) {
      setPostError(postErrorMessage(error));
    } finally {
      setPosting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SheetHeader title={editing ? "Edit post" : isStatus ? "New post" : "Log a show"} onClose={onCancel} leadDisabled={submitBusy} action={{ label: posting ? (editing ? "Saving..." : "Posting...") : uploadingPhotos ? "Uploading..." : resolvingSong ? "Checking..." : editing ? "Save" : "Post", onPress: submit, disabled: !canPost || submitBusy }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!!postError && <View style={styles.postErrorBox}><Icon name="flag" size={14} color={colors.danger} /><Text style={styles.postErrorTxt}>{postError}</Text></View>}
        {!editing && (
          <View style={styles.modeRow}>
            <Pressable style={[styles.modeBtn, isStatus && styles.modeBtnOn]} onPress={() => setPostType("status")} accessibilityRole="button" accessibilityState={{ selected: isStatus }} accessibilityLabel="Share a status update">
              <Icon name="edit" size={15} color={isStatus ? "#1A1206" : colors.textDim} />
              <Text style={[styles.modeTxt, isStatus && styles.modeTxtOn]}>Share something</Text>
            </Pressable>
            <Pressable style={[styles.modeBtn, !isStatus && styles.modeBtnOn]} onPress={() => setPostType("show")} accessibilityRole="button" accessibilityState={{ selected: !isStatus }} accessibilityLabel="Log a concert">
              <Icon name="star" size={15} color={!isStatus ? "#1A1206" : colors.textDim} />
              <Text style={[styles.modeTxt, !isStatus && styles.modeTxtOn]}>Log a show</Text>
            </Pressable>
          </View>
        )}

        {!editing && !draftId && drafts.length > 0 && !hasContent && (
          <View style={styles.drafts}>
            <Text style={styles.draftsLabel}>RESUME A DRAFT</Text>
            {drafts.slice(0, 5).map((d) => {
              const stored = normalizeComposerDraft(d);
              return (
                <View key={d.id} style={styles.draftRow}>
                  <Icon name={stored.postType === "status" ? "feed" : "edit"} size={14} color={colors.amber} />
                  <Pressable style={{ flex: 1 }} onPress={() => resume(d)} accessibilityRole="button" accessibilityLabel={`Resume ${composerDraftTitle(stored)}`}>
                    <Text style={styles.draftName} numberOfLines={1}>{composerDraftTitle(stored)}</Text>
                    <Text style={styles.draftSub} numberOfLines={1}>{stored.postType === "status" ? "Status update" : [stored.city, formatDate(stored.date, "")].filter(Boolean).join(" · ") || "Concert review"}</Text>
                  </Pressable>
                  <Pressable onPress={() => deleteDraft(d.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${composerDraftTitle(stored)}`}><Icon name="x" size={14} color={colors.textFaint} /></Pressable>
                </View>
              );
            })}
          </View>
        )}

        {isStatus ? (
          <View style={styles.composerCard}>
            <View style={styles.authorRow}>
              <Avatar user={user || { name: "You", initials: "YOU" }} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.authorName} numberOfLines={1}>{user?.name || "You"}</Text>
                <View style={styles.publicChip}>
                  <Icon name="feed" size={10} color={colors.textDim} />
                  <Text style={styles.publicTxt}>Public</Text>
                </View>
              </View>
            </View>
            <TextInput
              style={styles.statusBox}
              placeholder="What's on your mind? A show, weekend plans, a hot take..."
              placeholderTextColor={colors.textFaint}
              value={review}
              onChangeText={setReview}
              multiline
              autoFocus={!editing}
            />
          </View>
        ) : (
          <>
        <Text style={styles.fieldLabel}>WHO DID YOU SEE?</Text>
        <View>
          <TextInput
            style={styles.input}
            placeholder="Artist"
            placeholderTextColor={colors.textFaint}
            value={artist}
            onChangeText={(t) => { setArtist(t); setArtistPicked(false); setArtistKey(null); }}
            autoCapitalize="words"
          />
          {artistHits.length > 0 && (
            <View style={styles.hits}>
              {artistHits.map((h) => (
                <Pressable key={h.key || h.name} style={styles.hit} onPress={() => { setArtist(h.name); setArtistKey(h.key || h.norm || h.name); setArtistPicked(true); setArtistHits([]); }}>
                  <Icon name="music" size={13} color={colors.amber} />
                  <Text style={styles.hitName} numberOfLines={1}>{h.name}</Text>
                  {/* Disambiguating evidence, so two same-named acts are
                      distinguishable before one gets bound to the review. */}
                  {!!(h.genre || h.country || h.formed) && (
                    <Text style={styles.hitGenre} numberOfLines={1}>
                      {[h.genre, h.country, h.formed].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          )}
          {artistPicked && !!artist.trim() && (
            <View style={styles.linked}><Icon name="check" size={12} color={colors.good} /><Text style={styles.linkedTxt}>Linked to {artist.trim()}'s page</Text></View>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1.4 }}>
            <TextInput style={styles.input} placeholder="Venue" placeholderTextColor={colors.textFaint} value={venue} onChangeText={(text) => { setVenue(text); setVenuePicked(false); }} />
            {venueHits.length > 0 && (
              <View style={styles.hits}>
                {venueHits.map((hit) => (
                  <Pressable key={`${hit.name}|${hit.place}`} style={styles.hit} onPress={() => {
                    setVenue(hit.name);
                    setCity((hit.place || "").split(",")[0]?.trim() || "");
                    setVenuePicked(true);
                    setVenueHits([]);
                  }}>
                    <Icon name="pin" size={13} color={colors.cool} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.hitName} numberOfLines={1}>{hit.name}</Text>
                      {!!hit.place && <Text style={styles.venuePlace} numberOfLines={1}>{hit.place}</Text>}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
            {venuePicked && !!venue.trim() && (
              <View style={styles.linked}><Icon name="check" size={12} color={colors.good} /><Text style={styles.linkedTxt}>Linked to {venue.trim()}</Text></View>
            )}
          </View>
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="City" placeholderTextColor={colors.textFaint} value={city} onChangeText={setCity} />
        </View>

        <Text style={styles.fieldLabel}>TOUR OR OCCASION <Text style={styles.optional}>optional</Text></Text>
        <TextInput style={styles.input} placeholder="Tour name (or pick below)" placeholderTextColor={colors.textFaint} value={tour} onChangeText={setTour} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets} keyboardShouldPersistTaps="handled">
          {TOUR_PRESETS.map((p) => {
            const on = tour === p;
            return (
              <Pressable key={p} style={[styles.preset, on && styles.presetOn]} onPress={() => setTour(on ? "" : p)}>
                <Text style={[styles.presetTxt, on && styles.presetTxtOn]}>{p}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={[styles.fieldLabel, { marginTop: 18 }]}>WHEN?</Text>
        <Pressable style={styles.dateBtn} onPress={() => setShowDate((s) => !s)}>
          <Icon name="calendar" size={16} color={colors.amber} />
          <Text style={styles.dateTxt}>{date === todayStr ? "Today" : formatDate(date, date)}</Text>
          <Icon name={showDate ? "chevron-down" : "chevron-right"} size={16} color={colors.textDim} />
        </Pressable>
        {showDate && (
          <View style={styles.datePickerWrap}>
            <DatePicker value={date} years={PAST_YEARS} defaultYear={today.getFullYear()} onChange={setDate} />
          </View>
        )}

        {/* live weighted overall */}
        <View style={styles.overallCard}>
          <Text style={styles.overallNum}>{computed.overall ? computed.overall.toFixed(1) : "-"}</Text>
          <View>
            <Stars value={computed.overall} size={18} />
            <Text style={styles.overallSub}>weighted overall · rate the factors below</Text>
          </View>
        </View>

        {/* six factors - tap the stars, no plus/minus */}
        {GROUPS.map((g) => (
          <View key={g} style={styles.group}>
            <Text style={[styles.groupLabel, { color: GROUP_COLOR[g] }]}>{g}</Text>
            {RATING_DIMS.filter((d) => d.group === g).map((d) => (
              <View key={d.key} style={styles.factorRow}>
                <Text style={styles.factorLabel}>{d.label}</Text>
                <TapStars value={dims[d.key]} onChange={(v) => setDim(d.key, v)} size={26} gap={4} color={GROUP_COLOR[g]} />
              </View>
            ))}
          </View>
        ))}

        <Text style={[styles.fieldLabel, { marginTop: 22 }]}>YOUR REVIEW <Text style={styles.optional}>· optional, tag words below can say it for you</Text></Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="What made the night? Be honest - this is what people read."
          placeholderTextColor={colors.textFaint}
          value={review}
          onChangeText={setReview}
          multiline
        />

        {/* Tag words: post without writing a review. Up to five loud little
            descriptors that render as word-art chips on the card. */}
        <Text style={[styles.fieldLabel, { marginTop: 22 }]}>TAG WORDS <Text style={styles.optional}>· up to 5, they show with your score</Text></Text>
        {tags.length > 0 && (
          <View style={styles.tagEditRow}>
            {tags.map((t, i) => (
              <Pressable key={t + i} style={styles.tagEditChip} onPress={() => setTags((all) => all.filter((_, idx) => idx !== i))} accessibilityRole="button" accessibilityLabel={`Remove tag ${t}`}>
                <Text style={styles.tagEditTxt}>{t.toUpperCase()}</Text>
                <Icon name="x" size={11} color={colors.textDim} />
              </Pressable>
            ))}
          </View>
        )}
        {tags.length < 5 && (
          <TextInput
            style={styles.input}
            placeholder={tags.length ? "Add another (enter or comma)" : "RAW · wall of sound · sweaty (enter or comma adds one)"}
            placeholderTextColor={colors.textFaint}
            value={tagDraft}
            onChangeText={(text) => {
              if (/[,\n]/.test(text)) { commitTag(text); return; }
              setTagDraft(text);
            }}
            onSubmitEditing={() => commitTag(tagDraft)}
            onBlur={() => commitTag(tagDraft)}
            maxLength={24}
          />
        )}

          </>
        )}

        <Text style={styles.attachLabel}>ADD TO YOUR POST</Text>
        <View style={styles.attachBar}>
          <AttachChip icon="camera" label="Photo / video" active={showPhotos || photos.length > 0} count={photos.length} onPress={() => setShowPhotos((v) => !v)} disabled={submitBusy} />
          <AttachChip icon="play" label="YouTube" active={showSong || !!song?.videoId} onPress={() => setShowSong((v) => !v)} disabled={submitBusy} />
          {isStatus && <AttachChip icon="feed" label="Playlist" active={showPlaylist || !!playlist} count={playlist ? (playlist.tracks?.length || 0) : 0} onPress={togglePlaylistPanel} disabled={submitBusy} />}
        </View>

        {(showSong || song?.videoId) && (
        <View style={styles.attachPanel}>
        <Text style={styles.attachHint}>Attach a song, review, breakdown, lesson, or performance. Pit plays exactly the YouTube video you chose.</Text>
        {song?.videoId ? (
          <View style={styles.songPreview}>
            <SmartImage uri={song.thumb} style={styles.songArt} contain={false} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.songReady}>YOUTUBE ATTACHED</Text>
              <Text style={styles.songTitle} numberOfLines={2}>{song.title || "YouTube video"}</Text>
              {!!song.artist && <Text style={styles.songArtist} numberOfLines={1}>{song.artist}</Text>}
            </View>
            <Pressable onPress={() => { setSong(null); setSongUrl(""); setSongError(""); }} hitSlop={8} disabled={submitBusy} accessibilityRole="button" accessibilityLabel="Remove YouTube video">
              <Icon name="x" size={17} color={colors.textDim} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.songInputRow}>
            <TextInput
              style={[styles.input, styles.songInput]}
              placeholder="https://youtube.com/watch?v=..."
              placeholderTextColor={colors.textFaint}
              value={songUrl}
              onChangeText={(text) => { setSongUrl(text); setSongError(""); }}
              onSubmitEditing={attachSong}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
            />
            <Pressable style={[styles.songAttachBtn, (!songUrl.trim() || submitBusy) && styles.songAttachOff]} onPress={attachSong} disabled={!songUrl.trim() || submitBusy} accessibilityRole="button">
              <Icon name="music" size={15} color="#1A1206" />
              <Text style={styles.songAttachTxt}>{resolvingSong ? "Checking" : "Attach"}</Text>
            </Pressable>
          </View>
        )}
        {!!songError && <Text style={styles.songError}>{songError}</Text>}
        </View>
        )}

        {isStatus && (showPlaylist || playlist) && (
          <View style={styles.attachPanel}>
            {playlist ? (
              <View style={styles.songPreview}>
                <View style={[styles.songArt, styles.playlistArt]}><Icon name="music" size={22} color={colors.amber} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.songReady}>PLAYLIST</Text>
                  <Text style={styles.songTitle} numberOfLines={2}>{playlist.name}</Text>
                  <Text style={styles.songArtist} numberOfLines={1}>{playlist.tracks?.length || 0} {(playlist.tracks?.length || 0) === 1 ? "song" : "songs"}</Text>
                </View>
                <Pressable onPress={() => { setPlaylist(null); setPlaylistPicker(false); }} hitSlop={8} disabled={submitBusy} accessibilityRole="button" accessibilityLabel="Remove shared playlist">
                  <Icon name="x" size={17} color={colors.textDim} />
                </Pressable>
              </View>
            ) : myPlaylistsStatus === "loading" ? (
              <Text style={styles.plEmpty}>Loading your playlists...</Text>
            ) : myPlaylistsStatus === "error" ? (
              <Pressable onPress={() => void loadMyPlaylists?.()} accessibilityRole="button" accessibilityLabel="Retry loading playlists">
                <Text style={[styles.plEmpty, styles.plRetry]}>Couldn't load playlists. Tap to retry.</Text>
              </Pressable>
            ) : shareablePlaylists.length ? (
              <View style={styles.plList}>
                {shareablePlaylists.slice(0, 8).map((pl) => (
                  <Pressable key={pl.id} style={styles.plChip} onPress={() => setPlaylist(pl)} disabled={submitBusy} accessibilityRole="button" accessibilityLabel={`Share ${pl.name}`}>
                    <Icon name="music" size={13} color={colors.amber} />
                    <Text style={styles.plChipTxt} numberOfLines={1}>{pl.name}</Text>
                    <Text style={styles.plChipCount}>{pl.tracks?.length || 0}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.plEmpty}>No shareable playlists yet. Build one from an artist page or the player, then share it here.</Text>
            )}
          </View>
        )}

        {(showPhotos || photos.length > 0) && (
        <View style={styles.attachPanel}>
        <View style={styles.photoRow}>
          {photos.map((uri, i) => (
            <View key={i} style={styles.thumb}>
              {/* SmartImage renders clips as a play tile and HEIC via transcode. */}
              <SmartImage uri={uri} style={StyleSheet.absoluteFill} contain={false} />
              <Pressable style={styles.removeThumb} onPress={() => setPhotos((p) => p.filter((_, idx) => idx !== i))} disabled={submitBusy}>
                <Icon name="x" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
          {photos.length < 8 && (
            <Pressable style={styles.addThumb} onPress={addPhoto} disabled={submitBusy}>
              <Icon name="camera" size={20} color={colors.amber} />
              <Text style={styles.addThumbTxt}>{uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}` : "Add media"}</Text>
            </Pressable>
          )}
        </View>

        {uploadProgress && (
          <View style={styles.uploadStatus}>
            <Text style={styles.uploadStatusTxt}>Optimizing and uploading {uploadProgress.current} of {uploadProgress.total}</Text>
            <Pressable onPress={cancelUpload} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel media upload">
              <Text style={styles.uploadCancel}>Cancel</Text>
            </Pressable>
          </View>
        )}
        {!!mediaError && <Text style={styles.songError}>{mediaError}</Text>}

        {!isStatus && photos.length > 0 && (
          <Pressable style={styles.consent} onPress={() => setPhotosPublic((v) => !v)}>
            <View style={[styles.check, photosPublic && styles.checkOn]}>{photosPublic && <Icon name="check" size={13} color="#1A1206" />}</View>
            <Text style={styles.consentTxt}>Let my photos show on the {artist || "artist"}'s page (top ones, by likes). You can change this later.</Text>
          </Pressable>
        )}
        </View>
        )}

        <Button title={posting ? (editing ? "Saving changes..." : "Posting...") : uploadingPhotos ? "Uploading media..." : resolvingSong ? "Checking video..." : editing ? "Save changes" : isStatus ? "Post" : "Post to feed"} icon="check" onPress={submit} disabled={!canPost || submitBusy} style={{ marginTop: 28 }} />
        {!editing && hasContent && (
          <Pressable style={styles.saveDraft} onPress={stash} disabled={submitBusy}>
            <Icon name="edit" size={14} color={colors.textDim} />
            <Text style={styles.saveDraftTxt}>{draftId ? "Save draft & close" : "Save as draft"}</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: "row", gap: 8, backgroundColor: colors.bgElev, borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.lineSoft, marginBottom: 18 },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 10, borderRadius: radius.pill },
  modeBtnOn: { backgroundColor: colors.amberStrong },
  modeTxt: { color: colors.textDim, fontSize: 13.5, fontWeight: "800" },
  modeTxtOn: { color: "#1A1206" },
  // Status composer: an author card like the big social apps.
  composerCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, padding: 14, ...shadow.card },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 10 },
  authorName: { color: colors.text, fontFamily: displayFont, fontSize: 15.5, fontWeight: "800" },
  publicChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, marginTop: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  publicTxt: { color: colors.textDim, fontFamily: mono, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  statusBox: { minHeight: 120, textAlignVertical: "top", fontSize: 17, lineHeight: 24, color: colors.text, padding: 0 },
  // "Add to your post" attachment bar + reveal panels.
  attachLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginTop: 22, marginBottom: 10 },
  attachBar: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  attachChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  attachChipOn: { borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  attachChipTxt: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  attachChipTxtOn: { color: colors.text },
  attachChipCount: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "800", marginLeft: 1 },
  attachPanel: { marginTop: 12, backgroundColor: colors.bgElev, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 12 },
  attachHint: { color: colors.textFaint, fontSize: 11.5, lineHeight: 16, marginBottom: 10 },
  songInputRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  songInput: { flex: 1, marginBottom: 0, minWidth: 0 },
  songAttachBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 96, paddingHorizontal: 13, borderRadius: radius.sm, backgroundColor: colors.amberStrong },
  songAttachOff: { opacity: 0.42 },
  songAttachTxt: { color: "#1A1206", fontSize: 13, fontWeight: "900" },
  songPreview: { flexDirection: "row", alignItems: "center", gap: 11, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  songArt: { width: 82, height: 58, borderRadius: radius.sm },
  songReady: { color: colors.good, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  songTitle: { color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: "800", marginTop: 2 },
  songArtist: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  songError: { color: colors.danger, fontSize: 12.5, lineHeight: 18, marginTop: 7 },
  postErrorBox: { flexDirection: "row", alignItems: "center", gap: space(1.5), backgroundColor: colors.surface, borderColor: colors.danger, borderWidth: 1, borderRadius: radius.md, padding: space(2.5), marginTop: space(3) },
  postErrorTxt: { flex: 1, color: colors.danger, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  playlistArt: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  plRetry: { color: colors.amber, fontWeight: "800" },
  plList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  plChip: { flexDirection: "row", alignItems: "center", gap: 7, maxWidth: "100%", paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  plChipTxt: { color: colors.text, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  plChipCount: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "800" },
  plEmpty: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, fontStyle: "italic" },
  tagEditRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  tagEditChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderColor: colors.amber, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.surfaceAlt },
  tagEditTxt: { color: colors.amber, fontSize: 12, fontWeight: "900", letterSpacing: 1.2 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  cancel: { color: colors.textDim, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  post: { color: colors.amber, fontSize: 15, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 60 },
  fieldLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8 },
  optional: { color: colors.textFaint, fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  drafts: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 16 },
  draftsLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.2, fontWeight: "800", marginBottom: 8 },
  draftRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  draftName: { color: colors.text, fontSize: 13.5, fontWeight: "700" },
  draftSub: { color: colors.textDim, fontSize: 11.5, marginTop: 1 },
  saveDraft: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line },
  saveDraftTxt: { color: colors.textDim, fontSize: 14, fontWeight: "700" },
  hits: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, marginTop: -4, marginBottom: 10, overflow: "hidden" },
  hit: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  hitName: { color: colors.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  hitGenre: { color: colors.textDim, fontSize: 11, fontFamily: mono, marginLeft: "auto" },
  venuePlace: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  linked: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: -4, marginBottom: 10 },
  linkedTxt: { color: colors.good, fontSize: 11.5, fontWeight: "700" },
  presets: { flexDirection: "row", gap: 8, paddingBottom: 12, paddingTop: 2 },
  preset: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  presetOn: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  presetTxt: { color: colors.textDim, fontSize: 12.5, fontWeight: "700" },
  presetTxtOn: { color: "#fff" },
  optional: { color: colors.textFaint, fontWeight: "400", letterSpacing: 0 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 10 },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 12 },
  dateTxt: { flex: 1, color: colors.text, fontSize: 15, fontFamily: mono },
  datePickerWrap: { marginTop: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12 },
  multiline: { minHeight: 110, textAlignVertical: "top", fontSize: 16 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  thumb: { width: 76, height: 76, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  removeThumb: { position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  addThumb: { width: 76, height: 76, borderRadius: 10, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.surface },
  addThumbTxt: { color: colors.amber, fontSize: 12 },
  uploadStatus: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 10 },
  uploadStatusTxt: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  uploadCancel: { color: colors.danger, fontSize: 12.5, fontWeight: "800" },
  consent: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 12 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  consentTxt: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 19 },
  overallCard: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 16, marginTop: 22 },
  overallNum: { color: colors.gold, fontFamily: mono, fontSize: 40, fontWeight: "800", minWidth: 56 },
  overallSub: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  group: { marginTop: 18 },
  groupLabel: { fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: space(2) },
  factorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  factorLabel: { color: colors.text, fontSize: 14, flex: 1 },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  stepLabel: { color: colors.text, fontSize: 14 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 16 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  stepVal: { fontFamily: mono, fontSize: 17, fontWeight: "700", minWidth: 34, textAlign: "center" },
  bigPost: { marginTop: 28, backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  bigPostTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
});
