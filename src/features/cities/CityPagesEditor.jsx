import { useCallback, useEffect, useRef, useState } from "react";
import CityPagesConsole from "../../components/moderation/CityPagesConsole";
import { isLoadCancellation } from "../../domain/loadState.mjs";
import { readCityCopy, readCityDirectory, readCityGuide, saveCityCopy, saveCityGuide } from "./cityApi.mjs";
import useCityResource from "./useCityResource";

export default function CityPagesEditor({ accountId }) {
  const [section, setSection] = useState("city");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [wording, setWording] = useState(null);
  const [saveState, setSaveState] = useState({ saving: false, error: "", notice: "" });
  const saving = useRef(null);
  const cityScope = selected ? `${selected.countryCode}:${selected.citySlug}` : "none";
  const loadDirectory = useCallback((signal) => readCityDirectory({ query, limit: 12, admin: true, accountId, signal }), [query, accountId]);
  const directory = useCityResource(`admin-cities:${accountId}:${query}`, loadDirectory, { delay: 240 });
  const loadCity = useCallback((signal) => readCityGuide(selected, { admin: true, accountId, signal }), [selected, accountId]);
  const guide = useCityResource(`admin-city:${accountId}:${cityScope}`, loadCity, { enabled: !!selected });
  const loadCopy = useCallback((signal) => readCityCopy({ admin: true, accountId, signal }), [accountId]);
  const copyResource = useCityResource(`admin-city-copy:${accountId}`, loadCopy);
  useEffect(() => {
    if (guide.data) setDraft({ scope: cityScope, value: guide.data.editorial, original: guide.data.editorial, revision: guide.data.revision });
  }, [guide.data, cityScope]);
  useEffect(() => {
    if (copyResource.data) setWording({ value: copyResource.data.copy, original: copyResource.data.copy, revision: copyResource.data.revision });
  }, [copyResource.data]);
  useEffect(() => () => saving.current?.abort(), [accountId]);
  const activeDraft = draft?.scope === cityScope ? draft : null;
  const target = section === "city" ? activeDraft : wording;
  const dirty = !!target && JSON.stringify(target.value) !== JSON.stringify(target.original);
  const changeTarget = (action) => {
    if (saving.current) return;
    if (dirty) { setSaveState({ saving: false, error: "", notice: "Save or discard your changes before opening another editor." }); return; }
    setSaveState({ saving: false, error: "", notice: "" });
    action();
  };
  const save = async () => {
    if (!target || saving.current || !dirty) return;
    const controller = new AbortController();
    saving.current = controller;
    setSaveState({ saving: true, error: "", notice: "" });
    try {
      const result = section === "city"
        ? await saveCityGuide(selected, { editorial: target.value, revision: target.revision }, { signal: controller.signal, accountId })
        : await saveCityCopy({ copy: target.value, revision: target.revision }, { signal: controller.signal, accountId });
      if (controller.signal.aborted) return;
      if (section === "city") setDraft({ scope: cityScope, value: result.editorial, original: result.editorial, revision: result.revision });
      else setWording({ value: result.copy, original: result.copy, revision: result.revision });
      setSaveState({ saving: false, error: "", notice: "Saved. The page now uses this content." });
    } catch (error) {
      if (!isLoadCancellation(error, controller.signal)) setSaveState({ saving: false, error: error?.message || "Changes could not be saved.", notice: "Your draft is still here." });
    } finally { if (saving.current === controller) saving.current = null; }
  };
  return <CityPagesConsole section={section} onSection={(value) => changeTarget(() => setSection(value))} query={query} onQuery={setQuery} cities={directory.data?.cities || []} selected={selected} onSelect={(value) => changeTarget(() => setSelected(value))} editorial={activeDraft?.value} onEditorial={(value) => setDraft((current) => ({ ...current, value }))} copy={wording?.value} onCopy={(value) => setWording((current) => ({ ...current, value }))} loading={section === "city" ? !!selected && guide.status === "loading" : copyResource.status === "loading"} saving={saveState.saving} dirty={dirty} error={saveState.error || (section === "city" ? guide.error?.message || directory.error?.message : copyResource.error?.message) || ""} notice={saveState.notice} onSave={save} onDiscard={() => {
    if (section === "city") setDraft((current) => ({ ...current, value: current.original }));
    else setWording((current) => ({ ...current, value: current.original }));
    setSaveState({ saving: false, error: "", notice: "Changes discarded." });
  }} onReload={() => { guide.reload(); copyResource.reload(); directory.reload(); setSaveState({ saving: false, error: "", notice: "" }); }} />;
}
