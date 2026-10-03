import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import Button from "../../components/Button";
import { colors, radius } from "../../theme";
import { load, save as saveLocal } from "../../lib/persist";
import { emptyNewsroomForm, MAX_NEWSROOM_ARTICLE_SOURCES, newsroomArticlePayload, newsroomDraftEnvelope, newsroomDraftStorageKey, newsroomSaveAttempt, restoreNewsroomDraft } from "../../domain/newsroomComposition.mjs";
import { loadSelfWrittenPhoto, uploadSelfWrittenPhoto } from "./newsDeskEditorMediaService";

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
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [savedPayload, setSavedPayload] = useState(retained.current?.savedPayload || null);
  const uploadController = useRef(null);
  const mounted = useRef(false);
  const attempt = useRef(retained.current?.attempt || null);
  const callback = useRef(onCompositionStateChange);
  const submission = useRef(false);
  const update = (field) => (value) => setForm((current) => ({ ...current, [field]: value }));
  const payload = newsroomArticlePayload(form);
  const snapshot = JSON.stringify(payload);
  const words = body.trim() ? body.trim().split(/\s+/u).length : 0;
  const hasContent = !!(headline.trim() || summary.trim() || body.trim() || form.photo || photoName.trim() || photoUrl.trim()
    || photoCredit.trim() || sources.some((source) => source.name.trim() || source.url.trim()) || category !== "tour");
  const dirty = hasContent && snapshot !== savedPayload;

  useEffect(() => { callback.current = onCompositionStateChange; }, [onCompositionStateChange]);
  useEffect(() => {
    callback.current?.({ dirty, busy: uploading || saving, uploading, cancelUpload: () => uploadController.current?.abort() });
  }, [dirty, uploading, saving]);
  useEffect(() => {
    const key = newsroomDraftStorageKey(accountId);
    if (key) saveLocal(key, newsroomDraftEnvelope(accountId, form, attempt.current, savedPayload));
  }, [accountId, form, savedPayload]);
  useEffect(() => {
    mounted.current = true;
    const descriptor = retained.current?.form.photo;
    if (descriptor?.assetId) {
      const controller = new AbortController();
      uploadController.current = controller;
      setUploading(true);
      loadSelfWrittenPhoto({ accountId, assetId: descriptor.assetId, signal: controller.signal })
        .then((verified) => { if (mounted.current && !controller.signal.aborted) setPhoto(verified); })
        .catch((error) => { if (mounted.current && !controller.signal.aborted) setPhotoError(error?.message || "Choose another article photo."); })
        .finally(() => { if (uploadController.current === controller) uploadController.current = null; if (mounted.current) setUploading(false); });
    }
    return () => {
      mounted.current = false;
      uploadController.current?.abort();
      callback.current?.({ dirty: false, busy: false, uploading: false, cancelUpload: null });
    };
  }, [accountId]);

  const updateSource = (index, field, value) => setForm((current) => ({ ...current,
    sources: current.sources.map((source, sourceIndex) => sourceIndex === index ? { ...source, [field]: value } : source) }));
  const sourcesReady = sources.slice(0, 3).every((source) => source.name.trim() && source.url.trim())
    && sources.slice(3).every((source) => (!source.name.trim() && !source.url.trim()) || (source.name.trim() && source.url.trim()));
  const addSource = () => setForm((current) => current.sources.length >= MAX_NEWSROOM_ARTICLE_SOURCES ? current : {
    ...current, sources: [...current.sources, { name: "", url: "" }],
  });
  const choosePhoto = async () => {
    if (uploading || busy || disabled) return;
    let result;
    try {
      const { launchComposerMediaLibrary } = await import("../../lib/composerMediaPicker.js");
      result = await launchComposerMediaLibrary({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
    } catch (error) { if (mounted.current) setPhotoError(error?.message || "The photo library could not be opened."); return; }
    if (!mounted.current || !result || result.canceled || !result.assets?.[0]) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setUploading(true);
    setPhotoError("");
    try {
      const picked = { ...result.assets[0], id: result.assets[0].id || `news-photo:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`, kind: "image", altText: headline || "News article photo" };
      const uploaded = await uploadSelfWrittenPhoto({ accountId, asset: picked, signal: controller.signal });
      if (mounted.current && !controller.signal.aborted) {
        setPhoto(uploaded);
        setForm((current) => ({ ...current, photo: { assetId: uploaded.assetId } }));
      }
    } catch (error) {
      if (mounted.current && error?.name !== "AbortError") setPhotoError(error?.message || "The photo could not be verified.");
    } finally {
      if (uploadController.current === controller) uploadController.current = null;
      if (mounted.current) setUploading(false);
    }
  };
  const save = async () => {
    if (submission.current || disabled || busy || uploading) return;
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
    <Text selectable style={styles.help}>Write the article yourself. This route does not call Anthropic, is kept separate from generated-story limits, and requires a verified photo and provenance.</Text>
    <Field label="Headline"><TextInput accessibilityLabel="Self-written news headline" style={styles.input} maxLength={300} value={headline} onChangeText={update("headline")} placeholder="A clear, specific headline" placeholderTextColor={colors.textFaint} /></Field>
    <Field label="Summary" help="The short hook shown on cards and in search previews."><TextInput accessibilityLabel="Self-written news summary" style={styles.input} maxLength={1200} value={summary} onChangeText={update("summary")} placeholder="Why this matters now" placeholderTextColor={colors.textFaint} /></Field>
    <Field label="Article" help={`${words} words. At least 500 words are required. Aim for 500–750 for routine news; histories and deep breakdowns can be 1,000 words or more.`}><TextInput accessibilityLabel="Self-written news article" style={[styles.input, styles.articleInput]} multiline maxLength={60000} value={body} onChangeText={update("body")} placeholder="Write the reported story here..." placeholderTextColor={colors.textFaint} /></Field>
    <Field label="Category"><Choice label="Article category" value={category} onChange={update("category")} options={[
      { value: "release", label: "New music" }, { value: "tour", label: "Tours" }, { value: "festival", label: "Festivals" },
      { value: "lineup", label: "Lineups" }, { value: "awards", label: "Awards" }, { value: "charts", label: "Charts" },
      { value: "legal", label: "Legal" }, { value: "death", label: "Memorial" },
    ]} /></Field>
    <View style={styles.categoryBlock}>
      <Text style={styles.fieldLabel}>Article sources</Text>
      <Text style={styles.help}>Three independent configured music publishers are required. Photo attribution is recorded separately and never counts here.</Text>
      {sources.map((source, index) => <View key={`article-source-${index + 1}`} style={styles.sourceBlock}>
        <Text style={styles.sourceLabel}>Source {index + 1}</Text>
        <TextInput accessibilityLabel={`Self-written article source ${index + 1} name`} style={styles.input} maxLength={160} value={source.name} onChangeText={(value) => updateSource(index, "name", value)} placeholder="Configured publisher name" placeholderTextColor={colors.textFaint} />
        <TextInput accessibilityLabel={`Self-written article source ${index + 1} URL`} style={styles.input} maxLength={2048} value={source.url} onChangeText={(value) => updateSource(index, "url", value)} placeholder="https://publisher.example/report" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
      </View>)}
      {sources.length < MAX_NEWSROOM_ARTICLE_SOURCES
        ? <Button small title="Add another source" variant="secondary" accessibilityLabel="Add another article source" disabled={disabled || busy || uploading} onPress={addSource} />
        : <Text style={styles.help}>Up to {MAX_NEWSROOM_ARTICLE_SOURCES} article sources.</Text>}
    </View>
    <View style={styles.categoryBlock}>
      <Text style={styles.fieldLabel}>Selected article photo</Text>
      {photo?.uri ? <ExpoImage source={{ uri: photo.uri }} style={styles.editorPhoto} contentFit="cover" accessible={false} /> : null}
      <Button small title={uploading ? "Verifying photo" : "Choose photo"} variant="secondary" disabled={uploading || busy || disabled} onPress={choosePhoto} accessibilityLabel="Choose and upload an article photo" />
      <TextInput accessibilityLabel="Photo source name" style={styles.input} maxLength={160} value={photoName} onChangeText={update("photoName")} placeholder="Photo source or creator" placeholderTextColor={colors.textFaint} />
      <TextInput accessibilityLabel="Photo source URL" style={styles.input} maxLength={2048} value={photoUrl} onChangeText={update("photoUrl")} placeholder="https://example.com/photo-rights" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
      <TextInput accessibilityLabel="Photo credit" style={styles.input} maxLength={240} value={photoCredit} onChangeText={update("photoCredit")} placeholder="Optional credit or license" placeholderTextColor={colors.textFaint} />
      {photoError ? <Text selectable style={styles.error}>{photoError}</Text> : null}
    </View>
    <Button small title="Save self-written draft" disabled={disabled || uploading || words < 500 || !photo?.assetId || !headline.trim() || !summary.trim() || !sourcesReady || !photoName.trim() || !photoUrl.trim()} onPress={save} accessibilityLabel="Save self-written news draft" />
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
