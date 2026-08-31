import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
import { isDurableMediaUrl, reportMediaPickerError } from "../lib/mediaUpload";
import { api } from "../lib/api";
import { formatDate, initialComposerDate, toIsoDate, todayIso } from "../domain/dates.mjs";
import { mediaDisplayKind, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
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
import { postMediaPickerOptions } from "../domain/mediaPickerOptions.mjs";
import { MEDIA_POST_MAX_ATTACHMENTS } from "../domain/mediaUploadPolicy.mjs";
import {
  DEFAULT_MEDIA_PUBLISHING_CAPABILITIES,
  mediaPublishingAvailabilityCopy,
} from "../domain/mediaPublishingCapabilities.mjs";
import {
  mediaPublishingPreflightMessage,
  mediaPublishingPreflightSelection,
} from "../domain/mediaPublishingPreflight.mjs";
import { createMediaTransferProgressPublisher, mediaUploadProgressCopy } from "../domain/mediaTransferProgress.mjs";
import { hasLandingCompatibleImage } from "../domain/landingShowcase.mjs";
import { remove, save } from "../lib/persist";
import { uploadOriginalMediaAsset } from "../lib/mediaAssetUpload";
import { retireMediaAssetDrafts } from "../lib/mediaAssetDraftCleanup.mjs";
import { loadMediaPublishingCapabilities } from "../lib/mediaPublishingHealth";
import {
  recoverMediaDraftAssets,
  releaseMediaDraftAsset,
  releaseMediaDraftAssets,
} from "../lib/mediaDraftStaging";
import {
  mediaAssetIdsMatchingPhotos,
  mediaProjectPublishedMedia,
  mediaProjectFromPost,
  mediaProjectFromPicker,
  mediaProjectRequiresLegacyUpload,
  normalizeMediaProject,
  normalizeMediaProjectAsset,
  originalMediaProjectAsset,
  reconcileMediaProjectSelection,
  removeMediaProjectAsset,
} from "../domain/mediaProject.mjs";
import {
  ARTIST_CAMPAIGN_TREATMENTS,
  DEFAULT_ARTIST_CAMPAIGN_TREATMENT,
  normalizeArtistCampaign,
} from "../domain/artistCampaignPost.mjs";
import { MAX_POST_TAGGED_PEOPLE, normalizeTaggedPeople } from "../domain/postFriendTags.mjs";
import { COMPOSER_ARTIST_SEARCH_LIMIT } from "../features/artistSearch/artistSearchApi.mjs";

const GROUP_COLOR = { "THE BAND": colors.amber, "THE ROOM": colors.cool, "THE NIGHT": colors.magenta };
const GROUPS = ["THE BAND", "THE ROOM", "THE NIGHT"];
const submissionId = () => `post_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function sameMediaPublishingCapabilities(left, right) {
  return left?.photos === right?.photos
    && left?.videos === right?.videos
    && JSON.stringify(left?.sourceTypes || []) === JSON.stringify(right?.sourceTypes || []);
}

function mediaProjectForPost(post) {
  return mediaProjectFromPost(post);
}

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
  const { searchArtistsApi, attachArtistSuggestionApi, searchVenues, searchPeople, drafts, saveDraft, deleteDraft } = useStore();
  const initialRecoveryDraftRef = useRef(!editing && initialDraftId
    ? drafts.find((draft) => draft?.id === initialDraftId) || null
    : null);
  const [draftRestoreReady, setDraftRestoreReady] = useState(!initialRecoveryDraftRef.current);
  // A memorial memory uses the lightweight status composer while retaining one
  // server-verified artist identity and never opening the rating controls.
  const [postType, setPostType] = useState(
    editing ? (editing.kind === "status" ? "status" : "show")
      : defaultMode === "memory" && prefill?.artist ? "memory"
        : prefill?.artist ? "show" : defaultMode === "campaign" ? "status" : defaultMode
  );
  const isMemorialMemory = postType === "memory";
  const isStatus = postType === "status" || isMemorialMemory;
  const artistCampaignAllowed = user?.role === "artist" && !!String(user?.artistName || "").trim();
  const [campaign, setCampaign] = useState(() => {
    const existing = editing?.kind === "status" ? normalizeArtistCampaign(editing?.campaign) : null;
    if (existing) return existing;
    if (!editing && defaultMode === "campaign" && artistCampaignAllowed) {
      return { version: 1, treatment: DEFAULT_ARTIST_CAMPAIGN_TREATMENT };
    }
    return null;
  });
  const isCampaign = isStatus && !!campaign;
  const [draftId, setDraftId] = useState(null);
  const [savedDraftFingerprint, setSavedDraftFingerprint] = useState(null);
  const [artist, setArtist] = useState(editing?.artist || prefill?.artist || "");
  const [venue, setVenue] = useState(editing?.venue || prefill?.venue || "");
  const [city, setCity] = useState(editing?.city || prefill?.city || "");
  const [tour, setTour] = useState(editing?.tour || prefill?.tour || "");
  const officialEventName = !editing && typeof prefill?.officialEventName === "string"
    ? prefill.officialEventName.trim()
    : "";
  // Artist autocomplete: bind the review to a REAL catalog artist so it links to
  // the artist page, instead of free text that may match nothing.
  const [artistHits, setArtistHits] = useState([]);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistAttaching, setArtistAttaching] = useState(false);
  const [artistError, setArtistError] = useState("");
  const [artistPicked, setArtistPicked] = useState(!!editing?.artistKey || !!prefill?.artistKey);
  // The identity behind the name. Picking a suggestion binds the review to that
  // catalog entity; typing over it drops the binding, so free text can never
  // inherit the last artist's page. The server re-checks this before storing.
  const [artistKey, setArtistKey] = useState(editing?.artistKey || prefill?.artistKey || null);
  const artistRequestRef = useRef(0);
  const artistAttachRef = useRef({ sequence: 0, controller: null });
  useEffect(() => {
    const q = artist.trim();
    const sequence = ++artistRequestRef.current;
    const controller = new AbortController();
    if (artistPicked || artistAttaching || q.length < 2) {
      setArtistHits([]);
      setArtistLoading(false);
      setArtistError("");
      return () => controller.abort();
    }
    setArtistLoading(true);
    setArtistError("");
    const id = setTimeout(() => searchArtistsApi(q, {
      signal: controller.signal,
      throwOnError: true,
      limit: COMPOSER_ARTIST_SEARCH_LIMIT,
      remoteFallback: true,
    }).then((list) => {
      if (!controller.signal.aborted && sequence === artistRequestRef.current) {
        setArtistHits((list || []).slice(0, COMPOSER_ARTIST_SEARCH_LIMIT));
      }
    }).catch((error) => {
      if (!controller.signal.aborted && error?.name !== "AbortError" && sequence === artistRequestRef.current) {
        setArtistHits([]);
        setArtistError("Artist search could not update. Check your connection and try again.");
      }
    }).finally(() => {
      if (!controller.signal.aborted && sequence === artistRequestRef.current) setArtistLoading(false);
    }), 320);
    return () => { clearTimeout(id); controller.abort(); };
  }, [artist, artistAttaching, artistPicked]);
  useEffect(() => () => artistAttachRef.current.controller?.abort(), []);

  const changeArtistText = (value) => {
    artistAttachRef.current.controller?.abort();
    artistAttachRef.current = { sequence: artistAttachRef.current.sequence + 1, controller: null };
    setArtistAttaching(false);
    setArtist(value);
    setArtistPicked(false);
    setArtistKey(null);
    setArtistError("");
  };

  const chooseArtist = async (candidate) => {
    artistAttachRef.current.controller?.abort();
    const sequence = artistAttachRef.current.sequence + 1;
    const name = String(candidate?.name || "").trim();
    setArtist(name);
    setArtistHits([]);
    setArtistError("");
    if (!candidate?.transient) {
      artistAttachRef.current = { sequence, controller: null };
      setArtistKey(candidate?.key || candidate?.norm || name);
      setArtistPicked(true);
      setArtistAttaching(false);
      return;
    }

    const controller = new AbortController();
    artistAttachRef.current = { sequence, controller };
    setArtistKey(null);
    setArtistPicked(false);
    setArtistAttaching(true);
    try {
      const attached = await attachArtistSuggestionApi(candidate, { signal: controller.signal });
      if (controller.signal.aborted || artistAttachRef.current.sequence !== sequence || !attached) return;
      setArtist(attached.name);
      setArtistKey(attached.key || attached.norm || attached.name);
      setArtistPicked(true);
    } catch (error) {
      if (!controller.signal.aborted && artistAttachRef.current.sequence === sequence && error?.name !== "AbortError") {
        setArtistError("That artist could not be attached yet. Search again, or post without linking an artist page.");
      }
    } finally {
      if (!controller.signal.aborted && artistAttachRef.current.sequence === sequence) {
        artistAttachRef.current = { sequence, controller: null };
        setArtistAttaching(false);
      }
    }
  };
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
  const [preservedPlaylist, setPreservedPlaylist] = useState(editing?.playlist || null);
  const [resolvingSong, setResolvingSong] = useState(false);
  // Which attachment panels are revealed. A panel auto-shows when it already has
  // content (editing a post, or after you attach something), so nothing hides.
  const [showSong, setShowSong] = useState(!!editing?.song);
  const [showPhotos, setShowPhotos] = useState((editing?.photos || []).length > 0);
  const [taggedPeople, setTaggedPeople] = useState(() => normalizeTaggedPeople(editing?.taggedPeople));
  const [showPeople, setShowPeople] = useState(() => normalizeTaggedPeople(editing?.taggedPeople).length > 0);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleHits, setPeopleHits] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const peopleRequestRef = useRef(0);
  useEffect(() => {
    const query = peopleQuery.trim();
    const sequence = ++peopleRequestRef.current;
    const controller = new AbortController();
    if (!showPeople || query.length < 2 || taggedPeople.length >= MAX_POST_TAGGED_PEOPLE) {
      setPeopleHits([]);
      setPeopleLoading(false);
      setPeopleError("");
      return () => controller.abort();
    }
    setPeopleLoading(true);
    setPeopleError("");
    const timer = setTimeout(() => {
      void searchPeople(query, {
        signal: controller.signal,
        throwOnError: true,
        postTagEligibleOnly: true,
        postId: editing?.id || null,
      })
        .then((found) => {
          if (controller.signal.aborted || sequence !== peopleRequestRef.current) return;
          const selected = new Set(taggedPeople.map((person) => person.id));
          setPeopleHits(normalizeTaggedPeople(found)
            .filter((person) => person.id !== user?.id && !selected.has(person.id))
            .slice(0, 6));
        })
        .catch(() => {
          if (!controller.signal.aborted && sequence === peopleRequestRef.current) {
            setPeopleHits([]);
            setPeopleError("Couldn't search for friends. Try again.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && sequence === peopleRequestRef.current) setPeopleLoading(false);
        });
    }, 240);
    return () => { clearTimeout(timer); controller.abort(); };
    // Store actions are recreated by the legacy Context facade; the query and
    // selection are the stable inputs, and each request is abortable/latest-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPeople, peopleQuery, taggedPeople, user?.id, editing?.id]);
  const chooseTaggedPerson = (person) => {
    const normalized = normalizeTaggedPeople([person])[0];
    if (!normalized) return;
    setTaggedPeople((current) => current.length >= MAX_POST_TAGGED_PEOPLE || current.some((item) => item.id === normalized.id)
      ? current
      : [...current, normalized]);
    setPeopleQuery("");
    setPeopleHits([]);
    setPeopleError("");
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
  const [mediaProject, setMediaProject] = useState(() => mediaProjectForPost(editing));
  const [pendingMediaAssets, setPendingMediaAssets] = useState([]);
  const [photosPublic, setPhotosPublic] = useState(editing ? editing.photosPublic !== false : true);
  const [landingShowcase, setLandingShowcase] = useState(editing?.landingShowcase === true && hasLandingCompatibleImage(editing?.photos));
  const hasLandingCompatiblePhoto = useMemo(() => hasLandingCompatibleImage(photos), [photos]);
  useEffect(() => {
    if (!hasLandingCompatiblePhoto) setLandingShowcase(false);
  }, [hasLandingCompatiblePhoto]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [mediaError, setMediaError] = useState("");
  const [mediaPublishingCapabilities, setMediaPublishingCapabilities] = useState(DEFAULT_MEDIA_PUBLISHING_CAPABILITIES);
  const [mediaPublishingCapabilitiesLoaded, setMediaPublishingCapabilitiesLoaded] = useState(false);
  const [mediaPublishingCapabilitiesRefreshing, setMediaPublishingCapabilitiesRefreshing] = useState(false);
  const mediaPublishingCapabilitiesRequestRef = useRef(null);
  const uploadControllerRef = useRef(null);
  const uploadOperationRef = useRef(null);
  const remoteDraftAssetIdsRef = useRef(new Map());
  const submissionIdRef = useRef(editing?.id || submissionId());
  useEffect(() => () => {
    uploadControllerRef.current?.abort();
    uploadOperationRef.current = null;
  }, []);

  async function retireRemoteDrafts(localIds = null) {
    const selected = localIds ? new Set(localIds) : null;
    const entries = [...remoteDraftAssetIdsRef.current.entries()]
      .filter(([localId]) => !selected || selected.has(localId));
    if (!entries.length) return { retired: [], pending: [] };
    const result = await retireMediaAssetDrafts({
      assetIds: entries.map(([, assetId]) => assetId),
      apiCall: api,
    });
    const retired = new Set(result.retired);
    const retiredByLocalId = new Map();
    for (const [localId, assetId] of entries) {
      // Do not erase a newer retry that may have replaced this mapping while
      // the DELETE was in flight. Clear the persisted remote identity only
      // when both the ref and pending draft still point at the retired asset.
      if (retired.has(assetId) && remoteDraftAssetIdsRef.current.get(localId) === assetId) {
        remoteDraftAssetIdsRef.current.delete(localId);
        retiredByLocalId.set(localId, assetId);
      }
    }
    if (retiredByLocalId.size) {
      setPendingMediaAssets((current) => current.map((asset, index) => (
        retiredByLocalId.get(asset.id) === asset.assetId
          ? normalizeMediaProjectAsset({ ...asset, assetId: null }, index)
          : asset
      )));
    }
    return result;
  }
  const refreshMediaPublishingCapabilities = useCallback(({ force = false, background = true } = {}) => {
    const currentRequest = mediaPublishingCapabilitiesRequestRef.current;
    if (currentRequest?.promise) {
      if (!background && !currentRequest.showRefreshing) {
        currentRequest.showRefreshing = true;
        setMediaPublishingCapabilitiesRefreshing(true);
      }
      // A forced upload-boundary check must not inherit a result that may have
      // come from the short cache. Finish that consumer, then negotiate fresh.
      if (force && !currentRequest.force) {
        return currentRequest.promise.then(() => (
          currentRequest.controller.signal.aborted
            ? { ok: false }
            : refreshMediaPublishingCapabilities({ force: true, background })
        ));
      }
      return currentRequest.promise;
    }
    const controller = new AbortController();
    const request = { controller, force, showRefreshing: !background, promise: null };
    if (request.showRefreshing) setMediaPublishingCapabilitiesRefreshing(true);
    const promise = (async () => {
      try {
        const capabilities = await loadMediaPublishingCapabilities({
          apiCall: api,
          signal: controller.signal,
          force,
        });
        if (controller.signal.aborted) return { ok: false };
        setMediaPublishingCapabilities((current) => (
          sameMediaPublishingCapabilities(current, capabilities) ? current : capabilities
        ));
        setMediaPublishingCapabilitiesLoaded(true);
        return { ok: true, capabilities };
      } catch {
        // Preserve the last authoritative result. On a first-load network
        // failure this remains the legacy-safe default: photos on, videos off.
        return { ok: false };
      } finally {
        if (mediaPublishingCapabilitiesRequestRef.current === request) {
          mediaPublishingCapabilitiesRequestRef.current = null;
          if (!controller.signal.aborted) {
            if (request.showRefreshing) setMediaPublishingCapabilitiesRefreshing(false);
          }
        }
      }
    })();
    request.promise = promise;
    mediaPublishingCapabilitiesRequestRef.current = request;
    return promise;
  }, []);
  useEffect(() => {
    void refreshMediaPublishingCapabilities({ background: true });
    return () => {
      mediaPublishingCapabilitiesRequestRef.current?.controller.abort();
      mediaPublishingCapabilitiesRequestRef.current = null;
    };
  }, [refreshMediaPublishingCapabilities]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshMediaPublishingCapabilities({ background: true });
    });
    return () => subscription.remove();
  }, [refreshMediaPublishingCapabilities]);
  const mediaAvailabilityCopy = mediaPublishingCapabilitiesLoaded
    ? mediaPublishingAvailabilityCopy(mediaPublishingCapabilities)
    : "";
  // Availability changes the status message, never the local composer affordance.
  // People can always choose and retain either kind while the API decides when
  // the private upload may proceed.
  const mediaAttachmentLabel = "Photo / video";
  const mediaAddLabel = "Add media";
  const toggleMediaPanel = () => {
    if (!showPhotos) void refreshMediaPublishingCapabilities({ background: true });
    setShowPhotos((visible) => !visible);
  };
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

  async function uploadOriginalMedia(selectedAssets) {
    const selected = (Array.isArray(selectedAssets) ? selectedAssets : [])
      .slice(0, MEDIA_POST_MAX_ATTACHMENTS)
      .map((asset, index) => originalMediaProjectAsset(asset, index));
    if (!selected.length || uploadOperationRef.current || uploadingPhotos || posting) return { ok: false, skipped: true };
    // The authenticated upload route is the authoritative admission check. The
    // composer already refreshes advisory availability on open, panel intent,
    // foreground, and explicit retry; do not start another health request in
    // parallel with the actual upload.
    const controller = new AbortController();
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = controller;
    const operation = { controller, token: Symbol("media-upload") };
    uploadOperationRef.current = operation;
    const ownsOperation = () => uploadOperationRef.current === operation;
    const operationIsActive = () => ownsOperation() && !controller.signal.aborted;
    const progressPublisher = createMediaTransferProgressPublisher({
      publish: (value) => { if (operationIsActive()) setUploadProgress(value); },
    });
    setUploadingPhotos(true);
    setMediaError("");
    progressPublisher.publish({ current: 1, total: selected.length, completed: 0, stage: "preparing" }, { immediate: true });
    const completedAssets = [];
    // A URL-only historical post cannot safely mix attachment identity models
    // in one PATCH. New additions fail closed until the legacy attachments are
    // removed; every accepted upload uses stable IDs and verified derivatives.
    const legacyCompatibility = mediaProjectRequiresLegacyUpload(mediaProject, photos);
    try {
      if (legacyCompatibility) {
        throw new Error("This older post cannot safely mix new media with URL-only attachments. Remove all old media first, or publish the new media in a separate post.");
      }
      for (let index = 0; index < selected.length; index++) {
        const asset = selected[index];
        progressPublisher.publish({ current: index + 1, total: selected.length, completed: completedAssets.length, stage: "preparing" }, { immediate: true });
        let ready;
        ready = await uploadOriginalMediaAsset({
          asset,
          signal: controller.signal,
          onStage: (stage) => {
            if (!operationIsActive()) return;
            progressPublisher.publish({
              current: index + 1,
              total: selected.length,
              completed: completedAssets.length,
              stage,
              fraction: stage === "ready" ? 1 : 0,
            }, { immediate: true });
          },
          onProgress: (progress) => {
            if (!operationIsActive()) return;
            progressPublisher.publish({
              current: index + 1,
              total: selected.length,
              completed: completedAssets.length,
              stage: progress.stage,
              bytesSent: progress.bytesSent,
              totalBytes: progress.totalBytes,
              fraction: progress.fraction,
            });
          },
          onRemoteDraft: ({ assetId, sourceUploaded }) => {
            if (operationIsActive() && assetId) {
              remoteDraftAssetIdsRef.current.set(asset.id, assetId);
              if (sourceUploaded !== true) return;
              // Keep the opaque server identity in the recoverable upload
              // draft once its PUT succeeds. A retry can then GET/finalize the
              // same private source, while a failed partial PUT still mints a
              // fresh upload capability instead of trusting incomplete bytes.
              setPendingMediaAssets((current) => current.map((candidate, candidateIndex) => (
                candidate.id === asset.id
                  ? originalMediaProjectAsset({ ...candidate, assetId }, candidateIndex)
                  : candidate
              )));
            }
          },
        });
        if (!operationIsActive()) return { ok: false, stale: true };
        remoteDraftAssetIdsRef.current.delete(asset.id);
        completedAssets.push(ready);
        // Commit each verified asset immediately. If a later item fails, a
        // retry resumes with only the unfinished selections instead of
        // orphaning completed uploads or uploading them twice.
        const committedProject = reconcileMediaProjectSelection(
          mediaProject,
          selected.slice(0, completedAssets.length),
          completedAssets,
        );
        setMediaProject(committedProject);
        setPhotos(mediaProjectPublishedMedia(committedProject).map((item) => item.url));
        setPendingMediaAssets((current) => current.filter((item) => item.id !== asset.id));
        // The verified owner source is now recoverable from the server. Remove
        // only PIT's private staged copy; the helper refuses arbitrary paths.
        await releaseMediaDraftAsset(asset);
      }
      return { ok: true };
    } catch (error) {
      const message = controller.signal.aborted
        ? "Media upload stopped. Finished items are attached; the remaining originals are ready to retry."
        : (error?.message || "Mshpit could not upload that item. Finished items are attached, and the remaining originals are ready to retry.");
      if (ownsOperation()) setMediaError(message);
      return { ok: false, error };
    } finally {
      progressPublisher.cancel();
      if (ownsOperation()) {
        uploadOperationRef.current = null;
        if (uploadControllerRef.current === controller) uploadControllerRef.current = null;
        setUploadingPhotos(false);
        setUploadProgress(null);
      }
    }
  }

  async function stageSelectedAssets(assets) {
    if (uploadOperationRef.current || uploadingPhotos || posting || !Array.isArray(assets) || !assets.length) return;
    const remaining = Math.max(0, MEDIA_POST_MAX_ATTACHMENTS - photos.length - pendingMediaAssets.length);
    if (!remaining) return;
    const candidateAssets = mediaProjectFromPicker(
      assets.slice(0, remaining),
      `${submissionIdRef.current}:${Date.now().toString(36)}`,
      // Preserve every selected type, including a Live Photo motion pair. The
      // authenticated media endpoint remains the authoritative byte, codec and
      // poster-verification boundary.
      { allowLivePhotoVideo: true },
    ).assets.map((asset, index) => originalMediaProjectAsset(asset, index));
    const preflight = mediaPublishingPreflightSelection(candidateAssets, { platform: Platform.OS });
    const selected = preflight.accepted;
    const notices = [];
    if (preflight.rejected.length) notices.push(mediaPublishingPreflightMessage(preflight.rejected));
    setMediaError(notices.join(" "));
    if (!selected.length) return;
    if (mediaProjectRequiresLegacyUpload(mediaProject, photos)) {
      setMediaError("This older post still uses legacy attachments. Remove all of its existing media before adding a new photo or clip, or publish the new media in a separate post.");
      return;
    }
    // ImagePicker already returns a readable local asset. Queue it in memory
    // before the first await, then upload that original directly instead of
    // copying a potentially huge album into PIT's document directory first.
    // Older drafts with durableLocalUri remain recoverable through the retry
    // path below; only new selections skip the duplicate native copy.
    if (!notices.length) setMediaError("");
    setPendingMediaAssets((current) => normalizeMediaProject({ assets: [...current, ...selected] }).assets);
    await uploadOriginalMedia(selected);
  }

  const addPhoto = async () => {
    if (uploadOperationRef.current || uploadingPhotos || posting) return;
    // The picker is a local draft boundary, not a service-health boundary.
    // Always let people choose either media type and keep this call inside the
    // original web user gesture. The authenticated API remains authoritative.
    const pickerCapabilities = { photos: true, videos: true };
    void refreshMediaPublishingCapabilities({ background: true });
    if (mediaProjectRequiresLegacyUpload(mediaProject, photos)) {
      setMediaError("Remove all existing media from this older post before adding a new photo or clip. This prevents an unsafe mix of legacy URLs and verified PIT media.");
      return;
    }
    const remaining = Math.max(0, MEDIA_POST_MAX_ATTACHMENTS - photos.length - pendingMediaAssets.length);
    if (!remaining) return;
    let res;
    let pickerRequestId = null;
    try {
      // SDK 56 requires library permission to return an original iOS video via
      // Passthrough. Ask before opening Photos so the prompt never appears only
      // after someone has already made a selection.
      if (Platform.OS === "ios") {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission?.granted) {
          Alert.alert("Photo library access is needed", "Allow Mshpit to access your library so you can attach original photos and videos.");
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
      res = await ImagePicker.launchImageLibraryAsync(postMediaPickerOptions({
        platform: Platform.OS,
        remaining,
        iosPassthroughPreset: ImagePicker.VideoExportPreset.Passthrough,
        iosCurrentRepresentation: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
        allowPhotos: pickerCapabilities.photos,
        allowVideos: pickerCapabilities.videos,
      }));
    } catch (error) {
      if (pickerRequestId) remove(PENDING_COMPOSER_PICKER_KEY);
      reportMediaPickerError(error, "Opening the media library");
      return;
    }
    if (pickerRequestId) remove(PENDING_COMPOSER_PICKER_KEY);
    if (!res || res.canceled || !res.assets?.length) {
      return;
    }
    await stageSelectedAssets(res.assets);
  };

  const cancelUpload = async () => {
    uploadControllerRef.current?.abort();
    setMediaError("Upload stopped. Your original photos and videos are still here so you can try again.");
    await retireRemoteDrafts();
  };

  const removeAttachedMedia = (index) => {
    const removedUrl = photos[index];
    const matching = mediaProject.assets.find((asset) => asset.sourceUrl === removedUrl);
    setPhotos((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      if (!hasLandingCompatibleImage(next)) setLandingShowcase(false);
      return next;
    });
    if (matching) {
      if (campaign?.backgroundAssetId === matching.assetId) {
        setCampaign((current) => current ? { ...current, backgroundAssetId: undefined } : current);
      }
      setMediaProject((current) => removeMediaProjectAsset(current, matching.id));
    }
  };

  const retryPendingMedia = async () => {
    if (!pendingMediaAssets.length || uploadOperationRef.current || submitBusy) return;
    setMediaError("");
    try {
      // New picker assets upload directly while this composer is alive. Only
      // legacy app-owned draft copies need filesystem recovery; a remote asset
      // id can resume from the server without reading the local source again.
      const staged = pendingMediaAssets.filter((asset) => asset.durableLocalUri && !asset.assetId);
      const recoverableStaged = await recoverMediaDraftAssets(staged);
      if (recoverableStaged.length !== staged.length) {
        throw new Error("A selected photo or video is no longer available on this device. Choose it again before continuing.");
      }
      const recoveredIds = new Set(recoverableStaged.map((asset) => asset.id));
      const originals = pendingMediaAssets
        .filter((asset) => asset.assetId || !asset.durableLocalUri || recoveredIds.has(asset.id))
        .map((asset, index) => originalMediaProjectAsset(asset, index));
      setPendingMediaAssets(originals);
      await uploadOriginalMedia(originals);
    } catch (error) {
      setMediaError(error?.message || "Mshpit could not recover the original files. Choose them again and retry.");
    }
  };

  const removePendingMedia = (id) => {
    const target = pendingMediaAssets.find((asset) => asset.id === id);
    setPendingMediaAssets((current) => current.filter((asset) => asset.id !== id));
    void retireRemoteDrafts([id]);
    void releaseMediaDraftAsset(target);
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
      setSongError("That YouTube link isn't supported. Paste a YouTube watch, Shorts, or youtu.be link.");
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
  const canPostStatus = !!(review.trim() || photos.filter(isDurableMediaUrl).length || song?.videoId);
  const canPostBase = isStatus ? canPostStatus : (artist.trim() && venue.trim() && computed.overall > 0);
  const canPost = !!canPostBase && pendingMediaAssets.length === 0;
  const submitBusy = uploadingPhotos || resolvingSong || posting || artistAttaching;

  const draftMediaProject = useMemo(() => normalizeMediaProject({
    assets: [
      ...mediaProject.assets.filter((saved) => !pendingMediaAssets.some((staged) => staged.id === saved.id
        || (staged.assetId && staged.assetId === saved.assetId)
        || (staged.sourceUrl && staged.sourceUrl === saved.sourceUrl))),
      ...pendingMediaAssets,
    ],
  }), [mediaProject, pendingMediaAssets]);
  const currentDraft = useMemo(() => normalizeComposerDraft({
    id: draftId,
    submissionId: submissionIdRef.current,
    postType,
    campaign: isStatus ? campaign : null,
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
    taggedPeople,
    song,
    songUrl,
    playlist: preservedPlaylist,
    photos: photos.filter(isDurableMediaUrl),
    mediaProject: draftMediaProject,
    photosPublic,
    landingShowcase: photosPublic && landingShowcase && hasLandingCompatiblePhoto,
    panels: { song: showSong, photos: showPhotos, people: showPeople },
  }), [draftId, postType, isStatus, campaign, artist, artistPicked, artistKey, venue, city, tour, date, dims, review, tags, tagDraft, taggedPeople, song, songUrl, preservedPlaylist, photos, draftMediaProject, photosPublic, landingShowcase, hasLandingCompatiblePhoto, showSong, showPhotos, showPeople]);
  const draftFingerprint = useMemo(() => composerDraftFingerprint(currentDraft), [currentDraft]);
  const hasContent = useMemo(() => composerDraftHasContent(currentDraft), [currentDraft]);
  const hasPendingMedia = pendingMediaAssets.length > 0;
  const hasUnpersistablePendingMedia = pendingMediaAssets.some((asset) => !asset.sourceUrl && !asset.durableLocalUri);
  const initialFingerprintRef = useRef(null);
  if (initialFingerprintRef.current === null) initialFingerprintRef.current = draftFingerprint;
  const composerDirty = draftFingerprint !== initialFingerprintRef.current;
  const effectiveComposerDirty = composerDirty || hasPendingMedia;
  const effectiveHasContent = hasContent || hasPendingMedia;
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
      if (state !== "active" && shouldFlushComposerDraft({ editing: !!editing, dirty: effectiveComposerDirty, hasDraft: !!draftIdRef.current })) flushDraftRef.current?.();
    });
    return () => subscription.remove();
  }, [editing, effectiveComposerDirty]);

  // A tab close/reload cannot show our in-app confirmation. Ask the browser only
  // while work is still unsaved or a mutation is active; fully autosaved drafts
  // can leave without an unnecessary warning.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
    const shouldProtect = submitBusy
      || hasPendingMedia
      || (editing ? effectiveComposerDirty : (effectiveComposerDirty && effectiveHasContent && draftFingerprint !== savedDraftFingerprint));
    if (!shouldProtect) return undefined;
    const beforeUnload = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [submitBusy, editing, effectiveComposerDirty, effectiveHasContent, hasPendingMedia, draftFingerprint, savedDraftFingerprint]);

  const stash = () => {
    if (editing || submitBusy || !effectiveHasContent) return;
    if (hasUnpersistablePendingMedia) {
      Alert.alert("Media is waiting to upload", "This browser cannot keep selected photo or video files after a restart. Retry the upload or remove the waiting items before saving this draft.");
      return;
    }
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
    setCampaign(restored.campaign);
    setArtist(restored.artist); setArtistPicked(!!restored.artistKey); setArtistKey(restored.artistKey); setVenue(restored.venue); setVenuePicked(!!restored.venue); setCity(restored.city);
    const restoredPhotos = restored.photos.filter(isDurableMediaUrl);
    const restoredProject = normalizeMediaProject(restored.mediaProject);
    const restoredPending = restoredProject.assets
      .filter((asset) => asset.status !== "ready" && (asset.durableLocalUri || asset.assetId))
      .map((asset, index) => originalMediaProjectAsset(asset, index));
    const restoredReady = restoredProject.assets.filter((asset) => !!asset.sourceUrl && !restoredPending.some((pending) => pending.id === asset.id));
    setTour(restored.tour); setDate(toIsoDate(restored.date) || restored.date || todayStr); setDims(restored.dims); setReview(restored.review); setTags(restored.tags); setTagDraft(restored.tagDraft); setTaggedPeople(restored.taggedPeople); setSong(restored.song); setSongUrl(restored.songUrl); setPreservedPlaylist(restored.playlist); setPhotos(restoredPhotos); setMediaProject(normalizeMediaProject({ assets: restoredReady })); setPendingMediaAssets(restoredPending); setPhotosPublic(restored.photosPublic); setLandingShowcase(restored.landingShowcase && hasLandingCompatibleImage(restoredPhotos));
    if (restoredPending.length) {
      void recoverMediaDraftAssets(restoredPending).then((recoverable) => {
        setPendingMediaAssets(recoverable.map((asset, index) => originalMediaProjectAsset(asset, index)));
        if (recoverable.length < restoredPending.length) setMediaError("One selected photo or video is no longer available on this device. The rest of your draft is safe; choose that item again.");
      });
    }
    setShowSong(restored.panels.song); setShowPhotos(restored.panels.photos); setShowPeople(restored.panels.people || restored.taggedPeople.length > 0);
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
    void stageSelectedAssets(result.assets).finally(() => onPendingMediaConsumed?.(pendingMedia.requestId));
    // The request id is the ownership boundary. Other state changes during a
    // recovered upload must not enqueue the same Android selection twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRestoreReady, pendingMedia?.requestId, composerId]);

  const discardCurrentDraft = () => {
    void retireRemoteDrafts();
    void releaseMediaDraftAssets(pendingMediaAssets);
    setPendingMediaAssets([]);
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
    if (hasUnpersistablePendingMedia) {
      stay();
      Alert.alert(
        "Selected media is still waiting",
        "Retry the upload or remove the waiting photos and videos before closing. This browser cannot keep those selected files after a restart.",
      );
      return;
    }
    const closeDecision = composerCloseDecision({ busy: submitBusy, editing: !!editing, dirty: effectiveComposerDirty, hasContent: effectiveHasContent, hasDraft: !!draftIdRef.current });
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
      const stableMediaAssetIds = mediaAssetIdsMatchingPhotos(mediaProject, durablePhotos);
      const publishedMedia = mediaProjectPublishedMedia(mediaProject)
        .filter((item) => durablePhotos.includes(item.url));
      if (isStatus) {
        const result = await onPost?.({
          id: submissionIdRef.current,
          kind: isMemorialMemory ? "memory" : "status",
          ...(isMemorialMemory ? { artist: artist.trim(), artistKey } : {}),
          user: editing?.user || (user
            ? { name: user.name, handle: user.handle, initials: user.initials }
            : { name: "You", handle: "you", initials: "YOU" }),
          timeAgo: editing?.timeAgo || "now",
          review: review.trim(),
          taggedPeople,
          song,
          photos: durablePhotos,
          ...(stableMediaAssetIds ? { mediaAssetIds: stableMediaAssetIds } : {}),
          media: publishedMedia,
          photosPublic: true,
          campaign: isCampaign ? campaign : null,
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
        media: publishedMedia,
        photos: durablePhotos,
        ...(stableMediaAssetIds ? { mediaAssetIds: stableMediaAssetIds } : {}),
        photosPublic,
        landingShowcase: photosPublic && landingShowcase && hasLandingCompatibleImage(durablePhotos),
        overall: submittedRatings.overall,
        band: submittedRatings.band || submittedRatings.overall,
        room: submittedRatings.room || submittedRatings.overall,
        dims,
        review: review.trim(),
        taggedPeople,
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
      <SheetHeader title={editing ? (isCampaign ? "Edit featured post" : "Edit post") : isMemorialMemory ? "Share a fan memory" : isCampaign ? "New featured post" : isStatus ? "New post" : "Log a show"} onClose={onCancel} leadDisabled={submitBusy} action={{ label: posting ? (editing ? "Saving..." : "Posting...") : uploadingPhotos ? "Uploading..." : resolvingSong ? "Checking..." : editing ? "Save" : "Post", onPress: submit, disabled: !canPost || submitBusy }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!!postError && <View style={styles.postErrorBox}><Icon name="flag" size={14} color={colors.danger} /><Text style={styles.postErrorTxt}>{postError}</Text></View>}
        {!editing && !isMemorialMemory && (
          <View style={styles.modeRow}>
            <Pressable style={[styles.modeBtn, isStatus && !isCampaign && styles.modeBtnOn]} onPress={() => { setPostType("status"); setCampaign(null); }} accessibilityRole="button" accessibilityState={{ selected: isStatus && !isCampaign }} accessibilityLabel="Create a regular post">
              <Icon name="edit" size={15} color={isStatus && !isCampaign ? "#1A1206" : colors.textDim} />
              <Text style={[styles.modeTxt, isStatus && !isCampaign && styles.modeTxtOn]}>Share</Text>
            </Pressable>
            {artistCampaignAllowed && (
              <Pressable style={[styles.modeBtn, isCampaign && styles.modeBtnOn]} onPress={() => { setPostType("status"); setCampaign((current) => current || { version: 1, treatment: DEFAULT_ARTIST_CAMPAIGN_TREATMENT }); }} accessibilityRole="button" accessibilityState={{ selected: isCampaign }} accessibilityLabel="Create a featured artist post">
                <Icon name="star" size={15} color={isCampaign ? "#1A1206" : colors.textDim} />
                <Text style={[styles.modeTxt, isCampaign && styles.modeTxtOn]}>Featured</Text>
              </Pressable>
            )}
            <Pressable style={[styles.modeBtn, !isStatus && styles.modeBtnOn]} onPress={() => { setPostType("show"); setCampaign(null); }} accessibilityRole="button" accessibilityState={{ selected: !isStatus }} accessibilityLabel="Log a concert">
              <Icon name="star" size={15} color={!isStatus ? "#1A1206" : colors.textDim} />
              <Text style={[styles.modeTxt, !isStatus && styles.modeTxtOn]}>Log show</Text>
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
                    <Text style={styles.draftSub} numberOfLines={1}>{stored.postType === "status" ? "Post" : [stored.city, formatDate(stored.date, "")].filter(Boolean).join(" · ") || "Concert review"}</Text>
                  </Pressable>
                  <Pressable onPress={() => deleteDraft(d.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${composerDraftTitle(stored)}`}><Icon name="x" size={14} color={colors.textFaint} /></Pressable>
                </View>
              );
            })}
          </View>
        )}

        {isStatus ? (
          <>
          {isMemorialMemory ? (
            <View style={styles.memorialMemoryNotice} accessible accessibilityLabel={`Fan memory for ${artist}. No rating will be added.`}>
              <Icon name="dove" size={19} color={colors.gold} strokeWidth={1.6} />
              <View style={{ flex: 1 }}>
                <Text style={styles.memorialMemoryTitle}>A fan memory for {artist}</Text>
                <Text style={styles.memorialMemoryText}>Share words, photos, or video. This stays a social post and never becomes a live rating.</Text>
              </View>
            </View>
          ) : null}
          <View style={[styles.composerCard, isCampaign && styles.campaignComposerCard]}>
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
              placeholder={isMemorialMemory ? `What do you remember about ${artist}?` : "Write about music, a show, or what you plan to see next..."}
              placeholderTextColor={colors.textFaint}
              value={review}
              onChangeText={setReview}
              multiline
              autoFocus={!editing}
            />
          </View>
          {isCampaign && (
            <View style={[styles.campaignStudio, { borderColor: ARTIST_CAMPAIGN_TREATMENTS[campaign.treatment]?.accentColor || colors.amber }]}>
              <View style={styles.campaignStudioHead}>
                <View style={styles.campaignStudioIcon}><Icon name="star" size={18} color={colors.amber} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.campaignStudioKicker}>FEATURED ARTIST POST</Text>
                  <Text style={styles.campaignStudioTitle}>Choose a background for this post</Text>
                </View>
                <Pressable style={styles.campaignClearButton} onPress={() => setCampaign(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change to a regular post">
                  <Text style={styles.campaignClear}>Use regular post</Text>
                </Pressable>
              </View>
              <Text style={styles.campaignStudioCopy}>Choose a background style. You can also use one attached image. Text and buttons stay on a solid panel so they are easy to read.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.campaignTreatments} keyboardShouldPersistTaps="handled">
                {Object.values(ARTIST_CAMPAIGN_TREATMENTS).map((treatment) => {
                  const selected = campaign.treatment === treatment.id;
                  return (
                    <Pressable
                      key={treatment.id}
                      onPress={() => setCampaign((current) => ({ ...(current || { version: 1 }), version: 1, treatment: treatment.id }))}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${treatment.label} featured post background`}
                      style={[styles.campaignTreatment, { backgroundColor: treatment.backgroundColor, borderColor: selected ? treatment.accentColor : colors.line }]}
                    >
                      <View style={[styles.campaignTreatmentDot, { backgroundColor: treatment.accentColor }]} />
                      <Text style={[styles.campaignTreatmentText, { color: treatment.textColor }]}>{treatment.label}</Text>
                      {selected && <Icon name="check" size={12} color={treatment.accentColor} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.campaignCanvasState}>
                <Icon name={campaign.backgroundAssetId ? "check" : "photo"} size={14} color={campaign.backgroundAssetId ? colors.good : colors.textDim} />
                <Text style={styles.campaignCanvasText}>{campaign.backgroundAssetId ? "An attached image is being used as the background." : "Attach an image below, then choose Use as background."}</Text>
                {!!campaign.backgroundAssetId && (
                  <Pressable style={styles.campaignClearButton} onPress={() => setCampaign((current) => current ? { ...current, backgroundAssetId: undefined } : current)} accessibilityRole="button" accessibilityLabel="Remove featured post background image">
                    <Text style={styles.campaignClear}>Clear</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
          </>
        ) : (
          <>
        <Text style={styles.fieldLabel}>WHO DID YOU SEE?</Text>
        <View>
          <TextInput
            style={styles.input}
            placeholder="Artist"
            placeholderTextColor={colors.textFaint}
            value={artist}
            onChangeText={changeArtistText}
            autoCapitalize="words"
            accessibilityLabel="Artist"
            accessibilityState={{ busy: artistLoading || artistAttaching }}
          />
          {artistHits.length > 0 && (
            <View style={styles.hits}>
              {artistHits.map((h) => (
                <Pressable key={h.key || h.name} style={styles.hit} onPress={() => { void chooseArtist(h); }}>
                  <Icon name="music" size={13} color={colors.amber} />
                  <Text style={styles.hitName} numberOfLines={1}>{h.name}</Text>
                  {/* Disambiguating evidence, so two same-named acts are
                      distinguishable before one gets bound to the review. */}
                  {!!(h.genre || h.country || h.formed) && (
                    <Text style={styles.hitGenre} numberOfLines={1}>
                      {[h.genre, h.country, h.formed].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                  {h.transient && !(h.genre || h.country || h.formed) && (
                    <Text style={styles.hitGenre} numberOfLines={1}>Found in the full artist directory</Text>
                  )}
                </Pressable>
              ))}
            </View>
          )}
          {artistLoading && <Text style={styles.lookupStatus} accessibilityLiveRegion="polite">Searching artists...</Text>}
          {artistAttaching && <Text style={styles.lookupStatus} accessibilityLiveRegion="polite">Adding this artist to the post...</Text>}
          {!!artistError && <Text style={styles.lookupError} accessibilityLiveRegion="assertive">{artistError}</Text>}
          {artistPicked && !!artist.trim() && (
            <View style={styles.linked}><Icon name="check" size={12} color={colors.good} /><Text style={styles.linkedTxt}>{artist.trim()} added to this post</Text></View>
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
              <View style={styles.linked}><Icon name="check" size={12} color={colors.good} /><Text style={styles.linkedTxt}>Venue selected: {venue.trim()}</Text></View>
            )}
          </View>
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="City" placeholderTextColor={colors.textFaint} value={city} onChangeText={setCity} />
        </View>

        {officialEventName ? (
          <View style={styles.officialEventCard} accessible accessibilityRole="text" accessibilityLabel={`Event listing name: ${officialEventName}`}>
            <View style={styles.officialEventIcon}><Icon name="ticket" size={16} color={colors.amber} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.officialEventKicker}>EVENT LISTING NAME</Text>
              <Text style={styles.officialEventTitle}>{officialEventName}</Text>
              <Text style={styles.officialEventNote}>This name comes from the ticket provider. A tour name is filled in only when the listing clearly includes one.</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.fieldLabel}>TOUR OR SPECIAL EVENT <Text style={styles.optional}>optional</Text></Text>
        <TextInput style={styles.input} placeholder="e.g. CHROMAKOPIA Tour, OVO Fest" placeholderTextColor={colors.textFaint} value={tour} onChangeText={setTour} maxLength={80} accessibilityLabel="Tour or special event name" />
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
            <Text style={styles.overallSub}>overall score · based on the ratings below</Text>
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

        <Text style={[styles.fieldLabel, { marginTop: 22 }]}>YOUR REVIEW <Text style={styles.optional}>· optional, use quick tags if you do not want to write</Text></Text>
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
        <Text style={[styles.fieldLabel, { marginTop: 22 }]}>QUICK TAGS <Text style={styles.optional}>· up to 5, shown with your rating</Text></Text>
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
            placeholder={tags.length ? "Add another (press Enter or comma)" : "High energy, loud, emotional (press Enter or comma)"}
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
          <AttachChip icon="camera" label={mediaAttachmentLabel} active={showPhotos || photos.length > 0 || pendingMediaAssets.length > 0} count={photos.length + pendingMediaAssets.length} onPress={toggleMediaPanel} disabled={submitBusy} />
          <AttachChip icon="play" label="YouTube" active={showSong || !!song?.videoId} onPress={() => setShowSong((v) => !v)} disabled={submitBusy} />
          <AttachChip icon="you" label="Friends" active={showPeople || taggedPeople.length > 0} count={taggedPeople.length} onPress={() => setShowPeople((v) => !v)} disabled={submitBusy} />
        </View>
        {(showPeople || taggedPeople.length > 0) && (
          <View style={styles.attachPanel}>
            <Text style={styles.attachHint}>You can tag friends who follow you back. Their names link to their Mshpit profiles, and they can remove their tag at any time.</Text>
            {!!taggedPeople.length && (
              <View style={styles.peopleSelected}>
                {taggedPeople.map((person) => (
                  <Pressable
                    key={person.id}
                    style={styles.personChip}
                    onPress={() => setTaggedPeople((current) => current.filter((item) => item.id !== person.id))}
                    disabled={submitBusy}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${person.name} from tagged people`}
                  >
                    <Avatar user={person} size={24} />
                    <Text style={styles.personChipText} numberOfLines={1}>@{person.handle || person.name}</Text>
                    <Icon name="x" size={13} color={colors.textDim} />
                  </Pressable>
                ))}
              </View>
            )}
            {taggedPeople.length < MAX_POST_TAGGED_PEOPLE ? (
              <>
                <TextInput
                  style={[styles.input, styles.peopleInput]}
                  placeholder="Search your friends"
                  placeholderTextColor={colors.textFaint}
                  value={peopleQuery}
                  onChangeText={setPeopleQuery}
                  editable={!submitBusy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Search friends to tag"
                />
                <View accessibilityRole="status" accessibilityLiveRegion="polite">
                  {peopleLoading && <Text style={styles.peopleState}>Searching friends...</Text>}
                  {!!peopleError && <Text style={styles.songError}>{peopleError}</Text>}
                  {!peopleLoading && !peopleError && peopleQuery.trim().length >= 2 && peopleHits.length === 0 && <Text style={styles.peopleState}>No matching friends found.</Text>}
                </View>
                {!!peopleHits.length && (
                  <View style={styles.peopleResults}>
                    {peopleHits.map((person) => (
                      <Pressable
                        key={person.id}
                        style={styles.personResult}
                        onPress={() => chooseTaggedPerson(person)}
                        disabled={submitBusy}
                        accessibilityRole="button"
                        accessibilityLabel={`Tag ${person.name}`}
                      >
                        <Avatar user={person} size={34} />
                        <View style={styles.personResultCopy}>
                          <Text style={styles.personResultName} numberOfLines={1}>{person.name}</Text>
                          <Text style={styles.personResultHandle} numberOfLines={1}>@{person.handle}</Text>
                        </View>
                        <Icon name="plus" size={17} color={colors.amber} />
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.peopleState}>All {MAX_POST_TAGGED_PEOPLE} spots are filled.</Text>
            )}
          </View>
        )}
        {!!mediaAvailabilityCopy && (
          <View style={styles.mediaCapabilityNotice} accessibilityRole="note">
            <Icon name="camera" size={16} color={colors.amber} />
            <View style={styles.mediaCapabilityNoticeBody}>
              <Text style={styles.mediaCapabilityNoticeText}>{mediaAvailabilityCopy}</Text>
              <Pressable
                style={styles.mediaCapabilityRetry}
                onPress={() => void refreshMediaPublishingCapabilities({ force: true, background: false })}
                disabled={mediaPublishingCapabilitiesRefreshing}
                accessibilityRole="button"
                accessibilityLabel="Check media upload availability again"
                accessibilityState={{ busy: mediaPublishingCapabilitiesRefreshing, disabled: mediaPublishingCapabilitiesRefreshing }}
              >
                <Text style={styles.mediaCapabilityRetryText}>{mediaPublishingCapabilitiesRefreshing ? "Checking..." : "Check again"}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {(showSong || song?.videoId) && (
        <View style={styles.attachPanel}>
        <Text style={styles.attachHint}>Add a YouTube link to a song, review, interview, lesson, or performance. People can watch the exact video you choose.</Text>
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

        {(showPhotos || photos.length > 0 || pendingMediaAssets.length > 0) && (
        <View style={styles.attachPanel}>
        {pendingMediaAssets.length > 0 ? (
          <View style={styles.pendingMedia}>
            <Icon name={uploadingPhotos ? "clock" : "camera"} size={16} color={colors.amber} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pendingMediaTitle}>{uploadingPhotos ? "Uploading your originals" : "Ready to try again"}</Text>
              <Text style={styles.pendingMediaCopy}>{pendingMediaAssets.length} selected {pendingMediaAssets.length === 1 ? "item will" : "items will"} upload without filters or edits.</Text>
            </View>
            {!uploadingPhotos && (
              <Pressable style={styles.pendingMediaRetry} onPress={retryPendingMedia} disabled={submitBusy} accessibilityRole="button" accessibilityLabel="Retry uploading selected photos and videos">
                <Text style={styles.pendingMediaRetryText}>Retry</Text>
              </Pressable>
            )}
          </View>
        ) : null}
        <View style={styles.photoRow}>
          {photos.map((uri, i) => {
            const descriptor = mediaProject.assets.find((asset) => asset.sourceUrl === uri);
            const backgroundAssetId = descriptor?.assetId || null;
            const canBeCampaignBackground = isCampaign && !!backgroundAssetId && mediaDisplayKind(descriptor || uri) === "image";
            const isCampaignBackground = canBeCampaignBackground && campaign?.backgroundAssetId === backgroundAssetId;
            return (
            <View key={`${uri}:${i}`} style={[styles.thumb, isCampaignBackground && styles.campaignThumbSelected]}>
              {/* SmartImage renders clips as a play tile and HEIC via transcode. */}
              <SmartImage uri={uri} posterUri={mediaPosterUri(descriptor)} mediaKind={mediaDisplayKind(descriptor || uri)} style={StyleSheet.absoluteFill} contain={false} accessibilityLabel={descriptor?.altText || `Media ${i + 1}`} />
              {canBeCampaignBackground && (
                <Pressable
                  style={[styles.useBackground, isCampaignBackground && styles.useBackgroundSelected]}
                  onPress={() => setCampaign((current) => current ? { ...current, backgroundAssetId: isCampaignBackground ? undefined : backgroundAssetId } : current)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isCampaignBackground }}
                  accessibilityLabel={isCampaignBackground ? `Remove media ${i + 1} as featured post background` : `Use media ${i + 1} as featured post background`}
                >
                  <Icon name={isCampaignBackground ? "check" : "photo"} size={10} color="#fff" />
                  <Text style={styles.useBackgroundText}>{isCampaignBackground ? "BACKGROUND" : "USE AS BACKGROUND"}</Text>
                </Pressable>
              )}
              <Pressable style={styles.removeThumb} onPress={() => removeAttachedMedia(i)} disabled={submitBusy} accessibilityRole="button" accessibilityLabel={`Remove media ${i + 1}`}>
                <Icon name="x" size={12} color="#fff" />
              </Pressable>
            </View>
          );})}
          {pendingMediaAssets.map((asset, index) => (
            <View key={asset.id} style={[styles.thumb, styles.pendingThumb]}>
              <SmartImage
                uri={asset.uri || asset.durableLocalUri}
                posterUri={mediaPosterUri(asset)}
                mediaKind={mediaDisplayKind(asset)}
                style={StyleSheet.absoluteFill}
                contain={false}
                accessibilityLabel={asset.altText || `Selected media ${photos.length + index + 1}`}
              />
              <View style={styles.pendingThumbBadge}><Text style={styles.pendingThumbBadgeText}>WAITING</Text></View>
              <Pressable style={styles.removeThumb} onPress={() => removePendingMedia(asset.id)} disabled={submitBusy} accessibilityRole="button" accessibilityLabel={`Remove selected media ${photos.length + index + 1}`}>
                <Icon name="x" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
          {photos.length + pendingMediaAssets.length < MEDIA_POST_MAX_ATTACHMENTS && (
            <Pressable style={styles.addThumb} onPress={addPhoto} disabled={submitBusy} accessibilityRole="button" accessibilityLabel={mediaAddLabel}>
              <Icon name="camera" size={20} color={colors.amber} />
              <Text style={styles.addThumbTxt}>{uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}` : mediaAddLabel}</Text>
            </Pressable>
          )}
        </View>

        {uploadProgress && (
          <View style={styles.uploadStatus}>
            <View
              style={styles.uploadStatusCopy}
              accessibilityRole="progressbar"
              accessibilityLabel={mediaUploadProgressCopy(uploadProgress)}
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(Math.min(1, Math.max(0, Number(uploadProgress.fraction) || 0)) * 100),
                text: mediaUploadProgressCopy(uploadProgress),
              }}
            >
              <Text style={styles.uploadStatusTxt}>{mediaUploadProgressCopy(uploadProgress)}</Text>
              <View style={styles.uploadProgressTrack}>
                <View style={[styles.uploadProgressFill, { width: `${Math.min(1, Math.max(0, Number(uploadProgress.fraction) || 0)) * 100}%` }]} />
              </View>
            </View>
            <Pressable style={styles.uploadCancelButton} onPress={cancelUpload} accessibilityRole="button" accessibilityLabel="Cancel media upload">
              <Text style={styles.uploadCancel}>Cancel</Text>
            </Pressable>
          </View>
        )}
        {!!mediaError && <Text style={styles.songError}>{mediaError}</Text>}

        {!isStatus && photos.length > 0 && (
          <Pressable
            style={styles.consent}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: photosPublic }}
            accessibilityLabel={`Share my photos on ${artist || "the artist"}'s public page`}
            accessibilityHint="Turning this off also removes permission to feature a photo in Mshpit community highlights."
            onPress={() => setPhotosPublic((value) => {
            const next = !value;
            if (!next) setLandingShowcase(false);
            return next;
          })}>
            <View style={[styles.check, photosPublic && styles.checkOn]}>{photosPublic && <Icon name="check" size={13} color="#1A1206" />}</View>
            <Text style={styles.consentTxt}>Show these photos on {artist || "the artist"}'s public page. The most-liked photos may appear first. You can change this later.</Text>
          </Pressable>
        )}
        {!isStatus && hasLandingCompatiblePhoto && (
          <Pressable
            style={styles.consent}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: landingShowcase }}
            accessibilityLabel="Feature one public artist-page photo in Mshpit community highlights and on the homepage"
            accessibilityHint="The spotlight credits your handle and the concert's artist and venue. Photos are eligible after email confirmation and safety checks. You can turn this off later."
            onPress={() => setLandingShowcase((value) => {
            const next = !value;
            if (next) setPhotosPublic(true);
            return next;
          })}>
            <View style={[styles.check, landingShowcase && styles.checkOn]}>{landingShowcase && <Icon name="check" size={13} color="#1A1206" />}</View>
            <Text style={styles.consentTxt}>Allow one of these public photos to appear in Mshpit community highlights or on the homepage. This also turns on public artist-page sharing. Mshpit will email you first, run safety checks, and credit your handle, the artist, and the venue.</Text>
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
  campaignComposerCard: { borderColor: colors.amber, boxShadow: "0 0 0 1px rgba(242,166,90,0.12), 0 14px 34px rgba(0,0,0,0.24)" },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 10 },
  authorName: { color: colors.text, fontFamily: displayFont, fontSize: 15.5, fontWeight: "800" },
  publicChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, marginTop: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  publicTxt: { color: colors.textDim, fontFamily: mono, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  statusBox: { minHeight: 120, textAlignVertical: "top", fontSize: 17, lineHeight: 24, color: colors.text, padding: 0 },
  memorialMemoryNotice: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 12, padding: 13, borderRadius: radius.md, borderWidth: 1, borderColor: `${colors.gold}66`, backgroundColor: `${colors.gold}0D` },
  memorialMemoryTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  memorialMemoryText: { color: colors.textDim, fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  campaignStudio: { marginTop: 12, padding: 14, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, backgroundColor: colors.bgElev, ...shadow.card },
  campaignStudioHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  campaignStudioIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(242,166,90,0.12)", borderWidth: 1, borderColor: "rgba(242,166,90,0.34)" },
  campaignStudioKicker: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  campaignStudioTitle: { color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "900", marginTop: 2 },
  campaignStudioCopy: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 11 },
  campaignClear: { color: colors.amber, fontSize: 11.5, fontWeight: "800" },
  campaignClearButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  campaignTreatments: { gap: 9, paddingVertical: 13 },
  campaignTreatment: { minHeight: 46, minWidth: 132, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5 },
  campaignTreatmentDot: { width: 10, height: 10, borderRadius: 5 },
  campaignTreatmentText: { flex: 1, fontFamily: displayFont, fontSize: 12.5, fontWeight: "900" },
  campaignCanvasState: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  campaignCanvasText: { flex: 1, color: colors.textDim, fontSize: 11.5, lineHeight: 16 },
  // "Add to your post" attachment bar + reveal panels.
  attachLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginTop: 22, marginBottom: 10 },
  attachBar: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  attachChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  attachChipOn: { borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  attachChipTxt: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  attachChipTxtOn: { color: colors.text },
  attachChipCount: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "800", marginLeft: 1 },
  mediaCapabilityNotice: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 10, padding: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  mediaCapabilityNoticeBody: { flex: 1, alignItems: "flex-start" },
  mediaCapabilityNoticeText: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  mediaCapabilityRetry: { minHeight: 44, justifyContent: "center", marginTop: 2, paddingRight: 12 },
  mediaCapabilityRetryText: { color: colors.amber, fontSize: 12, fontWeight: "900" },
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
  peopleSelected: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  personChip: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface },
  personChipText: { maxWidth: 180, color: colors.text, fontSize: 12.5, fontWeight: "800" },
  peopleInput: { marginBottom: 0 },
  peopleState: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 8 },
  peopleResults: { marginTop: 8, overflow: "hidden", borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface },
  personResult: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  personResultCopy: { flex: 1, minWidth: 0 },
  personResultName: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  personResultHandle: { color: colors.textDim, fontFamily: mono, fontSize: 10.5, marginTop: 2 },
  tagEditRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  tagEditChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderColor: colors.amber, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.surfaceAlt },
  tagEditTxt: { color: colors.amber, fontSize: 12, fontWeight: "900", letterSpacing: 1.2 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  cancel: { color: colors.textDim, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  post: { color: colors.amber, fontSize: 15, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 60 },
  fieldLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8 },
  officialEventCard: { minHeight: 76, flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, marginBottom: 14, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(242,166,90,0.34)", backgroundColor: "rgba(242,166,90,0.07)" },
  officialEventIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  officialEventKicker: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  officialEventTitle: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900", marginTop: 3 },
  officialEventNote: { color: colors.textDim, fontSize: 11, lineHeight: 15, marginTop: 4 },
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
  lookupStatus: { color: colors.textDim, fontSize: 11.5, marginTop: -2, marginBottom: 10 },
  lookupError: { color: colors.danger, fontSize: 11.5, lineHeight: 16, marginTop: -2, marginBottom: 10 },
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
  pendingMedia: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12, padding: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: "rgba(242,166,90,0.08)" },
  pendingMediaTitle: { color: colors.text, fontFamily: displayFont, fontSize: 13, fontWeight: "900" },
  pendingMediaCopy: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  pendingMediaRetry: { minHeight: 44, minWidth: 58, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: colors.amberStrong },
  pendingMediaRetryText: { color: "#1A1206", fontSize: 12, fontWeight: "900" },
  thumb: { width: 76, height: 76, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  pendingThumb: { opacity: 0.8, borderColor: colors.amber },
  pendingThumbBadge: { position: "absolute", left: 3, bottom: 3, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 5, backgroundColor: "rgba(7,9,15,0.84)" },
  pendingThumbBadgeText: { color: "#fff", fontFamily: mono, fontSize: 7.5, fontWeight: "900", letterSpacing: 0.6 },
  campaignThumbSelected: { borderWidth: 2, borderColor: colors.amber },
  removeThumb: { position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  useBackground: { position: "absolute", left: 3, right: 3, bottom: 3, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 5, borderRadius: 7, backgroundColor: "rgba(7,9,15,0.84)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" },
  useBackgroundSelected: { backgroundColor: "rgba(155,96,24,0.94)", borderColor: colors.amber },
  useBackgroundText: { color: "#fff", fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 0.45 },
  addThumb: { width: 76, height: 76, borderRadius: 10, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.surface },
  addThumbTxt: { color: colors.amber, fontSize: 12 },
  uploadStatus: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 10 },
  uploadStatusCopy: { flex: 1, gap: 6 },
  uploadStatusTxt: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  uploadProgressTrack: { height: 4, overflow: "hidden", borderRadius: 2, backgroundColor: colors.lineSoft },
  uploadProgressFill: { height: "100%", borderRadius: 2, backgroundColor: colors.amber },
  uploadCancelButton: { minWidth: 58, minHeight: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
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
