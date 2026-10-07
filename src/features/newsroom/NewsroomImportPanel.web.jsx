import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Button from "../../components/Button";
import { colors } from "../../theme";
import { readNewsroomImport } from "../../lib/newsroomImportClient.mjs";

export default function NewsroomImportPanel({ disabled, dirty, onApply, onWork }) {
  const picker = useRef(null), flight = useRef(null), callback = useRef(onWork);
  const [pending, setPending] = useState(null), [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false), [photoUrl, setPhotoUrl] = useState(null);
  callback.current = onWork;
  useEffect(() => () => { flight.current?.abort(); callback.current?.({ busy: false, cancel: null }); }, []);
  const article = pending?.articles?.[index];
  const media = article?.media || pending?.media || {};
  useEffect(() => {
    const photo = media.photo;
    if (!photo) { setPhotoUrl(null); return undefined; }
    const url = URL.createObjectURL(photo.file || new Blob([photo.bytes], { type: photo.type }));
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [media.photo]);
  const read = async (files) => {
    if (disabled || flight.current || !files.length) return;
    const controller = new AbortController();
    flight.current = controller; setBusy(true); setError(""); setConfirm(false);
    callback.current?.({ busy: true, cancel: () => controller.abort() });
    try {
      const result = await readNewsroomImport(Array.from(files), { signal: controller.signal });
      if (!controller.signal.aborted) { setPending(result); setIndex(0); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason.message || "The file could not be read."); }
    finally {
      if (flight.current === controller) {
        flight.current = null; setBusy(false); callback.current?.({ busy: false, cancel: null });
      }
    }
  };
  const use = (confirmed = false) => {
    if (disabled || busy || !pending) return;
    if (!confirmed && dirty) { setConfirm(true); return; }
    onApply({ form: article?.form || null, media });
    setConfirm(false); setPending(null);
  };
  return <View style={{ gap: 10 }}>
    <div role="region" aria-label="Import article files" onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); void read(event.dataTransfer.files); }}
      style={{ border: `1px dashed ${colors.line}`, borderRadius: 12, padding: 16, color: colors.text }}>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>Start with your files</Text>
      <Text style={{ color: colors.textDim, fontSize: 13, marginVertical: 8 }}>Drop an article package, DOCX, text PDF or TXT here. You can add a JPG, PNG or WebP cover and one MOV or MP4 video.</Text>
      <input ref={picker} type="file" multiple aria-label="Choose article files" style={{ display: "none" }}
        accept=".zip,.docx,.pdf,.txt,.jpg,.jpeg,.png,.webp,.mov,.mp4"
        onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; void read(files); }} />
      <Button small title={busy ? "Reading files…" : "Choose files"} disabled={disabled || busy} onPress={() => picker.current?.click()} />
      {busy ? <Button small title="Cancel import" variant="secondary" onPress={() => flight.current?.abort()} /> : null}
    </div>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
    {pending ? <View style={{ gap: 10 }} testID="newsroom-import-preview">
      <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: "800" }}>Review your import</Text>
      {pending.articles.length > 1 ? <select aria-label="Article to import" value={index} disabled={disabled}
        onChange={(event) => { setIndex(Number(event.target.value)); setConfirm(false); }}
        style={{ maxWidth: "100%", padding: 10, background: colors.bgElev, color: colors.text }}>
        {pending.articles.map((item, i) => <option key={item.id} value={i}>{item.form.headline}</option>)}
      </select> : null}
      {article ? <>
        <Text selectable style={{ color: colors.text, fontWeight: "800" }}>{article.form.headline || "Add a headline in the editor"}</Text>
        {article.form.summary ? <Text selectable style={{ color: colors.text }}>{article.form.summary}</Text> : null}
        <div style={{ maxHeight: 240, overflowY: "auto", whiteSpace: "pre-wrap", color: colors.textDim }}>{article.form.body}</div>
        <Text style={{ color: colors.textDim }}>Article sources: {article.form.sources.filter((source) => source.url).map((source) => source.name).join(", ") || "Add sources in the editor"}</Text>
        {article.warnings.map((warning) => <Text key={warning} style={{ color: colors.amber }}>{warning}</Text>)}
      </> : <Text style={{ color: colors.textDim }}>Add this media to the article you are editing.</Text>}
      {photoUrl ? <img src={photoUrl} alt="Imported article cover preview" style={{ maxWidth: "100%", maxHeight: 180, objectFit: "contain", alignSelf: "flex-start" }} /> : null}
      {media.photo ? <Text style={{ color: colors.textDim }}>Cover: {media.photo.name}</Text> : null}
      {media.video ? <Text style={{ color: colors.textDim }}>Video: {media.video.name}. The verified version will be available to preview after upload.</Text> : null}
      <Text style={{ color: colors.textDim }}>Nothing is published by importing. Review the editor fields, save the draft, then use Publish now when ready.</Text>
      {confirm ? <View accessibilityRole="alert" style={{ gap: 8 }}>
        <Text style={{ color: colors.amber }}>You have unsaved work. {article ? "Replace the current article?" : "Replace its selected media?"} Saved drafts stay in the Newsroom.</Text>
        <Button small title="Replace unsaved work" disabled={disabled} onPress={() => use(true)} />
        <Button small title="Keep my current draft" variant="secondary" onPress={() => setConfirm(false)} />
      </View> : <Button small title={article ? "Use this article" : "Use this media"} disabled={disabled || busy} onPress={() => use()} />}
      <Button small title="Close import preview" variant="secondary" disabled={disabled || busy} onPress={() => { setPending(null); setConfirm(false); }} />
    </View> : null}
  </View>;
}
