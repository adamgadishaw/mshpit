import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import Button from "../../components/Button";
import { colors, radius } from "../../theme";
import { load, save as saveLocal } from "../../lib/persist";
import { emptyNewsroomForm, MAX_NEWSROOM_ARTICLE_SOURCES, newsroomArticlePayload, newsroomDraftEnvelope, newsroomDraftStorageKey, newsroomSaveAttempt, restoreNewsroomDraft } from "../../domain/newsroomComposition.mjs";
import { loadSelfWrittenMedia, uploadSelfWrittenMedia } from "./newsDeskEditorMediaService";
import NewsroomImportPanel from "./NewsroomImportPanel";
import NewsArticleVideo from "../../components/news/NewsArticleVideo";

function Field({ label, help, children }) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
    {help ? <Text style={styles.help}>{help}</Text> : null}
  </View>;
}

function Choice({ options, value, onChange, label }) {
  return <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
    {options.map((option) => <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.choice, value === option.value && styles.choiceOn]}
      accessibilityRole="radio" accessibilityState={{ checked: value === option.value }} accessibilityLabel={option.label}>
      <Text style={[styles.choiceText, value === option.value && styles.choiceTextOn]}>{option.label}</Text>
    </Pressable>)}
  </View>;
}

const newSaveKey = () => `self-written-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export default function SelfWrittenNewsComposer({ accountId, busy, saving = false, disabled, onSubmit, onCompositionStateChange }) {
  const retained = useRef(restoreNewsroomDraft(accountId, load(newsroomDraftStorageKey(accountId), null)));
  const [form, setForm] = useState(() => retained.current?.form || emptyNewsroomForm());
  const { headline, summary, body, category, sources, photoName, photoUrl, photoCredit } = form;
  const [photo, setPhoto] = useState(null);
  const [video, setVideo] = useState(null);
  const [videoError, setVideoError] = useState("");
  const [importing, setImporting] = useState(false);
  const [mediaStage, setMediaStage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [savedPayload, setSavedPayload] = useState(retained.current?.savedPayload || null);
  const uploadController = useRef(null);
  const importWork = useRef(null);
  const originals = useRef({});
  const mounted = useRef(false);
  const attempt = useRef(retained.current?.attempt || null);
  const callback = useRef(onCompositionStateChange);
  const submission = useRef(false);
  const update = (field) => (value) => setForm((current) => ({ ...current, [field]: value }));
  const payload = newsroomArticlePayload(form);
  const snapshot = JSON.stringify(payload);
  const words = body.trim() ? body.trim().split(/\s+/u).length : 0;
  const hasContent = !!(headline.trim() || summary.trim() || body.trim() || form.photo || photoName.trim() || photoUrl.trim()
    || photoCredit.trim() || form.video || form.videoName || form.videoUrl || form.videoCredit
    || sources.some((source) => source.name.trim() || source.url.trim()) || category !== "tour");
  const dirty = hasContent && snapshot !== savedPayload;

  useEffect(() => { callback.current = onCompositionStateChange; }, [onCompositionStateChange]);
  useEffect(() => {
    callback.current?.({ dirty, busy: uploading || saving || importing, uploading: uploading || importing,
      cancelUpload: () => { uploadController.current?.abort(); importWork.current?.cancel?.(); } });
  }, [dirty, uploading, saving, importing]);
  useEffect(() => {
    const key = newsroomDraftStorageKey(accountId);
    if (key) saveLocal(key, newsroomDraftEnvelope(accountId, form, attempt.current, savedPayload));
  }, [accountId, form, savedPayload]);
  useEffect(() => {
    mounted.current = true;
    for (const slot of ["photo", "video"]) {
      if (retained.current?.form[slot]?.pending) (slot === "photo" ? setPhotoError : setVideoError)("Choose the original file again to finish this upload. Your article text is kept.");
    }
    const descriptors = ["photo", "video"].filter((slot) => retained.current?.form[slot]?.assetId);
    if (descriptors.length) {
      const controller = new AbortController();
      uploadController.current = controller;
      setUploading(true);
      void (async () => {
        for (const slot of descriptors) {
          if (controller.signal.aborted) break;
          try {
            const verified = await loadSelfWrittenMedia({ accountId, assetId: retained.current.form[slot].assetId,
              kind: slot === "video" ? "video" : "image", signal: controller.signal,
              onStage: (stage) => { if (mounted.current && !controller.signal.aborted) setMediaStage(stage); } });
            if (mounted.current && !controller.signal.aborted) (slot === "video" ? setVideo : setPhoto)(verified);
          } catch (error) {
            if (mounted.current && !controller.signal.aborted) (slot === "video" ? setVideoError : setPhotoError)(error?.message || "Choose the original file again.");
          }
        }
        if (mounted.current && controller.signal.aborted) {
          for (const slot of descriptors) (slot === "video" ? setVideoError : setPhotoError)("Verification paused. Retry verification to finish restoring this media.");
        }
        if (uploadController.current === controller) uploadController.current = null;
        if (mounted.current) setUploading(false);
      })();
    }
    return () => {
      mounted.current = false;
      uploadController.current?.abort();
      importWork.current?.cancel?.();
      originals.current = {};
      callback.current?.({ dirty: false, busy: false, uploading: false, cancelUpload: null });
    };
  }, [accountId]);

  const updateSource = (index, field, value) => setForm((current) => ({ ...current,
    sources: current.sources.map((source, sourceIndex) => sourceIndex === index ? { ...source, [field]: value } : source) }));
  const sourcesReady = sources.some((source) => source.name.trim() && source.url.trim())
    && sources.every((source) => (!source.name.trim() && !source.url.trim()) || (source.name.trim() && source.url.trim()));
  const addSource = () => setForm((current) => current.sources.length >= MAX_NEWSROOM_ARTICLE_SOURCES ? current : {
    ...current, sources: [...current.sources, { name: "", url: "" }],
  });
  const beginMedia = () => {
    if (uploadController.current || importing || busy || disabled || submission.current) return null;
    const controller = new AbortController();
    uploadController.current = controller;
    setUploading(true); setMediaStage("preparing-source");
    return controller;
  };
  const finishMedia = (controller) => {
    if (uploadController.current === controller) uploadController.current = null;
    if (mounted.current) setUploading(false);
  };
  const uploadOne = async (slot, picked, controller) => {
    const setError = slot === "photo" ? setPhotoError : setVideoError;
    const setMedia = slot === "photo" ? setPhoto : setVideo;
    setError(""); setMedia(null);
    originals.current[slot] = picked;
    setForm((current) => ({ ...current, [slot]: picked.assetId ? { assetId: picked.assetId } : { pending: true } }));
    const kind = slot === "photo" ? "image" : "video";
    let localUrl;
    try {
      if (picked.file) localUrl = URL.createObjectURL(picked.file);
      const uploaded = await uploadSelfWrittenMedia({ accountId, asset: { ...picked, uri: localUrl || picked.uri }, kind,
        signal: controller.signal, onStage: (stage) => { if (mounted.current && !controller.signal.aborted) setMediaStage(stage); },
        onRemoteDraft: (remote) => {
          if (!mounted.current || controller.signal.aborted) return;
          if (remote.assetId) {
            originals.current[slot] = { ...originals.current[slot], assetId: remote.assetId };
            setForm((current) => ({ ...current, [slot]: { assetId: remote.assetId } }));
          }
        } });
      if (mounted.current && !controller.signal.aborted) {
        setMedia(uploaded); delete originals.current[slot];
        setForm((current) => ({ ...current, [slot]: { assetId: uploaded.assetId } }));
      }
    } catch (error) {
      if (mounted.current) setError(error?.name === "AbortError" ? "Upload paused. Retry verification or choose the original file again."
        : error?.message || "The media could not be verified. Your article is kept.");
    } finally { if (localUrl) URL.revokeObjectURL(localUrl); }
  };
  const chooseMedia = async (slot) => {
    const controller = beginMedia();
    if (!controller) return;
    try {
      const { launchComposerMediaLibrary } = await import("../../lib/composerMediaPicker.js");
      if (controller.signal.aborted) return;
      const result = await launchComposerMediaLibrary({ mediaTypes: [slot === "photo" ? "images" : "videos"], allowsEditing: false, quality: 1 });
      if (!mounted.current || controller.signal.aborted || result?.canceled || !result?.assets?.[0]) return;
      await uploadOne(slot, { ...result.assets[0], id: newSaveKey(), altText: headline || `Article ${slot}` }, controller);
    } catch (error) { if (mounted.current && !controller.signal.aborted) (slot === "photo" ? setPhotoError : setVideoError)(error?.message || "The media library could not be opened."); }
    finally { finishMedia(controller); }
  };
  const retryMedia = async (slot) => {
    const controller = beginMedia();
    if (!controller) return;
    try {
      const picked = originals.current[slot] || (form[slot]?.assetId ? { assetId: form[slot].assetId, id: `news-media:${form[slot].assetId}` } : null);
      if (picked) await uploadOne(slot, picked, controller);
    } finally { finishMedia(controller); }
  };
  const applyImport = ({ form: imported, media }) => {
    const controller = beginMedia();
    if (!controller) return;
    const queued = {};
    try {
      for (const slot of ["photo", "video"]) {
        const item = media[slot];
        if (item) queued[slot] = { file: item.file || new File([item.bytes], item.name, { type: item.type }),
          fileName: item.name, id: newSaveKey(), altText: imported?.headline || headline };
      }
    } catch {
      setPhotoError("The selected files could not be opened. Choose them again."); finishMedia(controller); return;
    }
    if (imported) {
      setForm({ ...emptyNewsroomForm(), ...imported }); setPhoto(null); setVideo(null);
      setSavedPayload(null); attempt.current = null; originals.current = {};
      setPhotoError(""); setVideoError("");
    }
    // Retain the entire selection before the first upload, including media
    // queued behind the photo. Refresh can then request any missing originals.
    Object.assign(originals.current, queued);
    setForm((current) => ({ ...current, ...Object.fromEntries(Object.keys(queued).map((slot) => [slot, { pending: true }])) }));
    for (const slot of Object.keys(queued)) {
      (slot === "video" ? setVideo : setPhoto)(null);
      (slot === "video" ? setVideoError : setPhotoError)("Upload queued. Retry verification if you pause before it starts.");
    }
    void (async () => {
      for (const slot of ["photo", "video"]) {
        if (!queued[slot] || controller.signal.aborted) continue;
        await uploadOne(slot, queued[slot], controller);
      }
    })().catch(() => { if (mounted.current) setPhotoError("The upload stopped. Your article and selected media are kept; retry verification."); })
      .finally(() => finishMedia(controller));
  };
  const save = async () => {
    if (submission.current || disabled || busy || uploadController.current || importing
        || !photo?.assetId || photo.assetId !== form.photo?.assetId || (form.video && (!video?.assetId || video.assetId !== form.video.assetId))) return;
    const submitted = newsroomArticlePayload(form);
    const next = newsroomSaveAttempt(attempt.current, submitted, newSaveKey);
    attempt.current = next;
    // Persist intent before the request, so an uncertain save can be resumed
    // after navigation/refresh without inventing a duplicate receipt key.
    saveLocal(newsroomDraftStorageKey(accountId), newsroomDraftEnvelope(accountId, form, next, savedPayload));
    submission.current = true;
    try {
      const result = await onSubmit({ ...submitted, idempotencyKey: next.key });
      if (mounted.current && result?.ok) setSavedPayload(next.payload);
    } finally { submission.current = false; }
  };
  return <View style={styles.card} testID="self-written-news-composer">
    <Text style={styles.step}>SELF-WRITTEN ARTICLE</Text>
    <Text selectable style={styles.help}>Import your files or write below. Review the draft, then publish when you are ready.</Text>
    <NewsroomImportPanel dirty={dirty} disabled={disabled || busy || uploading || saving} onApply={applyImport}
      onWork={(work) => { importWork.current = work; if (mounted.current) setImporting(work.busy); }} />
    {uploading ? <View style={styles.field}>
      <Text accessibilityLiveRegion="polite" style={styles.help}>{mediaStage === "uploading-source" ? "Uploading article media…" : "Preparing and verifying article media…"}</Text>
      <Button small title="Pause upload" variant="secondary" onPress={() => uploadController.current?.abort()} />
    </View> : null}
    <Field label="Headline"><TextInput accessibilityLabel="Self-written news headline" style={styles.input} maxLength={300} value={headline} onChangeText={update("headline")} placeholder="A clear, specific headline" placeholderTextColor={colors.textFaint} /></Field>
    <Field label="Summary" help="The short hook shown on cards and in search previews."><TextInput accessibilityLabel="Self-written news summary" style={styles.input} maxLength={1200} value={summary} onChangeText={update("summary")} placeholder="Why this matters now" placeholderTextColor={colors.textFaint} /></Field>
    <Field label="Article" help={`${words} words. Report the facts without padding. Attribute quotes and reporting to their sources.`}><TextInput accessibilityLabel="Self-written news article" style={[styles.input, styles.articleInput]} multiline maxLength={60000} value={body} onChangeText={update("body")} placeholder="Write the reported story here..." placeholderTextColor={colors.textFaint} /></Field>
    <Field label="Category"><Choice label="Article category" value={category} onChange={update("category")} options={[
      { value: "release", label: "New music" }, { value: "tour", label: "Tours" }, { value: "festival", label: "Festivals" },
      { value: "lineup", label: "Lineups" }, { value: "awards", label: "Awards" }, { value: "charts", label: "Charts" },
      { value: "legal", label: "Legal" }, { value: "death", label: "Memorial" },
    ]} /></Field>
    <View style={styles.categoryBlock}>
      <Text style={styles.fieldLabel}>Article sources</Text>
      <Text style={styles.help}>Cite sources that directly support the story, including official statements and independent reporting where relevant. Name each source accurately. Photo attribution is separate.</Text>
      {sources.map((source, index) => <View key={`article-source-${index + 1}`} style={styles.sourceBlock}>
        <Text style={styles.sourceLabel}>Source {index + 1}</Text>
        <TextInput accessibilityLabel={`Self-written article source ${index + 1} name`} style={styles.input} maxLength={160} value={source.name} onChangeText={(value) => updateSource(index, "name", value)} placeholder="Source or organization name" placeholderTextColor={colors.textFaint} />
        <TextInput accessibilityLabel={`Self-written article source ${index + 1} URL`} style={styles.input} maxLength={2048} value={source.url} onChangeText={(value) => updateSource(index, "url", value)} placeholder="https://source.example/report" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
      </View>)}
      {sources.length < MAX_NEWSROOM_ARTICLE_SOURCES
        ? <Button small title="Add another source" variant="secondary" accessibilityLabel="Add another article source" disabled={disabled || busy || uploading} onPress={addSource} />
        : <Text style={styles.help}>Up to {MAX_NEWSROOM_ARTICLE_SOURCES} article sources.</Text>}
    </View>
    <View style={styles.categoryBlock}>
      <Text style={styles.fieldLabel}>Selected article photo</Text>
      {photo?.uri ? <ExpoImage source={{ uri: photo.uri }} style={styles.editorPhoto} contentFit="cover" accessible={false} /> : null}
      <Button small title="Choose photo" variant="secondary" disabled={uploading || importing || busy || disabled} onPress={() => chooseMedia("photo")} accessibilityLabel="Choose and upload an article photo" />
      <TextInput accessibilityLabel="Photo source name" style={styles.input} maxLength={160} value={photoName} onChangeText={update("photoName")} placeholder="Photo source or creator" placeholderTextColor={colors.textFaint} />
      <TextInput accessibilityLabel="Photo source URL" style={styles.input} maxLength={2048} value={photoUrl} onChangeText={update("photoUrl")} placeholder="https://example.com/photo-rights" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
      <TextInput accessibilityLabel="Photo credit" style={styles.input} maxLength={240} value={photoCredit} onChangeText={update("photoCredit")} placeholder="Optional credit or license" placeholderTextColor={colors.textFaint} />
      {photoError ? <Text selectable style={styles.error}>{photoError}</Text> : null}
      {photoError && (form.photo?.assetId || originals.current.photo) ? <Button small title="Retry photo verification" variant="secondary" disabled={uploading || importing || busy || disabled} onPress={() => retryMedia("photo")} /> : null}
    </View>
    <View style={styles.categoryBlock}>
      <Text style={styles.fieldLabel}>Article video (optional)</Text>
      {video ? <NewsArticleVideo uri={video.uri} posterUri={video.posterUri} /> : null}
      <Button small title="Choose video" variant="secondary" disabled={uploading || importing || busy || disabled} onPress={() => chooseMedia("video")} />
      <TextInput accessibilityLabel="Video source name" style={styles.input} maxLength={160} value={form.videoName || ""} onChangeText={update("videoName")} placeholder="Video source or creator" placeholderTextColor={colors.textFaint} />
      <TextInput accessibilityLabel="Video source URL" style={styles.input} maxLength={2048} value={form.videoUrl || ""} onChangeText={update("videoUrl")} placeholder="https://example.com/video-rights" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
      <TextInput accessibilityLabel="Video credit" style={styles.input} maxLength={240} value={form.videoCredit || ""} onChangeText={update("videoCredit")} placeholder="Optional credit or license" placeholderTextColor={colors.textFaint} />
      {videoError ? <Text selectable style={styles.error}>{videoError}</Text> : null}
      {videoError && (form.video?.assetId || originals.current.video) ? <Button small title="Retry video verification" variant="secondary" disabled={uploading || importing || busy || disabled} onPress={() => retryMedia("video")} /> : null}
      {form.video || originals.current.video ? <Button small title="Remove article video" variant="secondary" disabled={uploading || importing || busy || disabled}
        onPress={() => { setVideo(null); setVideoError(""); delete originals.current.video; setForm((current) => ({ ...current, video: null })); }} /> : null}
    </View>
    <Button small title="Save self-written draft" disabled={disabled || uploading || importing || !body.trim() || !photo?.assetId || photo.assetId !== form.photo?.assetId || !headline.trim() || !summary.trim() || !sourcesReady || !photoName.trim() || !photoUrl.trim()
      || !!originals.current.video || (form.video && (!video?.assetId || video.assetId !== form.video.assetId || !form.videoName.trim() || !form.videoUrl.trim()))} onPress={save} accessibilityLabel="Save self-written news draft" />
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 14, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface },
  field: { gap: 6 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "800" },
  help: { color: colors.textFaint, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  step: { color: colors.amber, fontSize: 11, lineHeight: 16, fontWeight: "900", letterSpacing: 1 },
  input: { color: colors.text, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, maxWidth: 560 },
  articleInput: { minHeight: 180, textAlignVertical: "top", maxWidth: 760 },
  categoryBlock: { gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  sourceBlock: { gap: 6, paddingTop: 8 },
  sourceLabel: { color: colors.textDim, fontSize: 12, fontWeight: "800" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 6 },
  choiceOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  choiceText: { color: colors.textDim, fontSize: 13, fontWeight: "800" },
  choiceTextOn: { color: colors.bg },
  editorPhoto: { width: 180, height: 110, borderRadius: radius.sm, backgroundColor: colors.bgElev },
});
