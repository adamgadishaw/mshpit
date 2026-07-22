import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, mono, radius, font, displayFont, shadow } from "../theme";
import { useStore } from "../store";
import { newId, RATING_DIMS, computeReview } from "../data";

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
import { formatDate, toIsoDate, todayIso } from "../domain/dates.mjs";

const GROUP_COLOR = { "THE BAND": colors.amber, "THE ROOM": colors.cool, "THE NIGHT": colors.magenta };
const GROUPS = ["THE BAND", "THE ROOM", "THE NIGHT"];

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

export default function LogScreen({ onPost, onCancel, user, prefill, editing = null, defaultMode = "show" }) {
  const { searchArtistsApi, searchVenues, drafts, saveDraft, deleteDraft, myPlaylists, loadMyPlaylists } = useStore();
  // Two kinds of post share this composer: a full show review, or a plain
  // status update ("post whatever": text and/or photos, no artist/rating).
  const [postType, setPostType] = useState(
    editing ? (editing.kind === "status" ? "status" : "show") : (prefill?.artist ? "show" : defaultMode)
  );
  const isStatus = postType === "status";
  const [draftId, setDraftId] = useState(null);
  const [artist, setArtist] = useState(editing?.artist || prefill?.artist || "");
  const [venue, setVenue] = useState(editing?.venue || prefill?.venue || "");
  const [city, setCity] = useState(editing?.city || prefill?.city || "");
  const [tour, setTour] = useState(editing?.tour || "");
  // Artist autocomplete: bind the review to a REAL catalog artist so it links to
  // the artist page, instead of free text that may match nothing.
  const [artistHits, setArtistHits] = useState([]);
  const [artistPicked, setArtistPicked] = useState(!!editing?.artist || !!prefill?.artist);
  // The identity behind the name. Picking a suggestion binds the review to that
  // catalog entity; typing over it drops the binding, so free text can never
  // inherit the last artist's page. The server re-checks this before storing.
  const [artistKey, setArtistKey] = useState(editing?.artistKey || null);
  useEffect(() => {
    const q = artist.trim();
    if (artistPicked || q.length < 2) { setArtistHits([]); return; }
    const id = setTimeout(() => searchArtistsApi(q).then((list) => setArtistHits((list || []).slice(0, 6))), 220);
    return () => clearTimeout(id);
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
  useEffect(() => { loadMyPlaylists?.(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const [songError, setSongError] = useState("");
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
  const [posting, setPosting] = useState(false);
  // Show date, defaults to today so logging stays one-tap, but you can set the
  // real date of a past show. Years run from this year back to 2000, descending.
  const today = new Date();
  // Held and submitted as canonical ISO; rendered through formatDate below.
  const todayStr = todayIso(today);
  const PAST_YEARS = Array.from({ length: today.getFullYear() - 1999 }, (_, i) => today.getFullYear() - i);
  // An existing post may still hold a legacy display-format date, so normalize
  // on open: editing a show must not rewrite which performance it belongs to.
  const [date, setDate] = useState(toIsoDate(editing?.date) || editing?.date || todayStr);
  const [showDate, setShowDate] = useState(false);

  const addPhoto = async () => {
    if (uploadingPhotos || posting) return;
    const remaining = Math.max(0, 8 - photos.length);
    if (!remaining) return;
    let res;
    try {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.6, videoQuality: 1, allowsMultipleSelection: true, selectionLimit: Math.min(6, remaining) });
    } catch (error) {
      reportMediaPickerError(error, "Opening the media library");
      return;
    }
    if (!res || res.canceled || !res.assets?.length) return;
    setUploadingPhotos(true);
    const uploaded = [];
    try {
      // Upload sequentially to keep mobile memory predictable. Successful
      // objects remain available even if a later selection fails.
      for (const asset of res.assets.slice(0, remaining)) {
        try {
          uploaded.push(await uploadMediaAsset(asset, "post"));
        } catch {
          break;
        }
      }
    } finally {
      if (uploaded.length) setPhotos((current) => [...current, ...uploaded].filter(isDurableMediaUrl).slice(0, 8));
      setUploadingPhotos(false);
    }
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

  const stash = () => {
    if (editing) return;
    if (submitBusy) return;
    const id = saveDraft({ id: draftId, artist, artistKey, venue, city, tour, date, dims, review, tags, song, photos: photos.filter(isDurableMediaUrl) });
    setDraftId(id);
    onCancel?.();
  };
  const resume = (d) => {
    setDraftId(d.id);
    setArtist(d.artist || ""); setArtistPicked(!!d.artist); setArtistKey(d.artistKey || null); setVenue(d.venue || ""); setVenuePicked(!!d.venue); setCity(d.city || "");
    setTour(d.tour || ""); setDate(toIsoDate(d.date) || d.date || todayStr); setDims(d.dims || dims); setReview(d.review || ""); setTags(Array.isArray(d.tags) ? d.tags.slice(0, 5) : []); setSong(d.song || null); setSongUrl(d.song?.url || ""); setPhotos((d.photos || []).filter(isDurableMediaUrl));
  };
  const hasContent = artist.trim() || venue.trim() || review.trim() || photos.length || song?.videoId;

  const submit = async () => {
    if (!canPost || submitBusy) return;
    setPosting(true);
    try {
      const durablePhotos = photos.filter(isDurableMediaUrl);
      if (isStatus) {
        const result = await onPost?.({
          id: editing?.id || newId(),
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
        if (result?.ok !== false && draftId) deleteDraft(draftId);
        return;
      }
      const result = await onPost?.({
        id: editing?.id || newId(),
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
      // Failed posts stay fully editable and retain any saved draft.
      if (result?.ok !== false && draftId) deleteDraft(draftId);
    } catch {
      // The store/API layer presents the themed failure; do not clear the form.
    } finally {
      setPosting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SheetHeader title={editing ? "Edit post" : isStatus ? "New post" : "Log a show"} onClose={onCancel} action={{ label: posting ? (editing ? "Saving..." : "Posting...") : uploadingPhotos ? "Uploading..." : resolvingSong ? "Checking..." : editing ? "Save" : "Post", onPress: submit, disabled: !canPost || submitBusy }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
        {!editing && !draftId && drafts.length > 0 && !hasContent && (
          <View style={styles.drafts}>
            <Text style={styles.draftsLabel}>RESUME A DRAFT</Text>
            {drafts.slice(0, 5).map((d) => (
              <Pressable key={d.id} style={styles.draftRow} onPress={() => resume(d)}>
                <Icon name="edit" size={14} color={colors.amber} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.draftName} numberOfLines={1}>{d.artist || "Untitled"}{d.venue ? ` · ${d.venue}` : ""}</Text>
                  {!!d.review && <Text style={styles.draftSub} numberOfLines={1}>{d.review}</Text>}
                </View>
                <Pressable onPress={() => deleteDraft(d.id)} hitSlop={8}><Icon name="x" size={14} color={colors.textFaint} /></Pressable>
              </Pressable>
            ))}
          </View>
        )}
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
            <DatePicker years={PAST_YEARS} defaultYear={today.getFullYear()} onChange={setDate} />
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
          {isStatus && <AttachChip icon="feed" label="Playlist" active={showPlaylist || !!playlist} count={playlist ? (playlist.tracks?.length || 0) : 0} onPress={() => setShowPlaylist((v) => !v)} disabled={submitBusy} />}
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
              <Text style={styles.addThumbTxt}>{uploadingPhotos ? "Uploading" : "Add media"}</Text>
            </Pressable>
          )}
        </View>

        {!isStatus && photos.length > 0 && (
          <Pressable style={styles.consent} onPress={() => setPhotosPublic((v) => !v)}>
            <View style={[styles.check, photosPublic && styles.checkOn]}>{photosPublic && <Icon name="check" size={13} color="#1A1206" />}</View>
            <Text style={styles.consentTxt}>Let my photos show on the {artist || "artist"}'s page (top ones, by likes). You can change this later.</Text>
          </Pressable>
        )}
        </View>
        )}

        <Button title={posting ? (editing ? "Saving changes..." : "Posting...") : uploadingPhotos ? "Uploading media..." : resolvingSong ? "Checking video..." : editing ? "Save changes" : isStatus ? "Post" : "Post to feed"} icon="check" onPress={submit} disabled={!canPost || submitBusy} style={{ marginTop: 28 }} />
        {!editing && !isStatus && hasContent && (
          <Pressable style={styles.saveDraft} onPress={stash} disabled={submitBusy}>
            <Icon name="edit" size={14} color={colors.textDim} />
            <Text style={styles.saveDraftTxt}>{draftId ? "Update draft" : "Save as draft"}</Text>
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
  playlistArt: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
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
  consent: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 12 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  consentTxt: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 19 },
  overallCard: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 16, marginTop: 22 },
  overallNum: { color: colors.gold, fontFamily: mono, fontSize: 40, fontWeight: "800", minWidth: 56 },
  overallSub: { color: colors.textFaint, fontSize: 12, marginTop: 6 },
  group: { marginTop: 18 },
  groupLabel: { fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: 10 },
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
