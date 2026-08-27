import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  ARTIST_MEMORIAL_LIMITS,
  ARTIST_MEMORIAL_SPOTLIGHT_DAYS,
  ARTIST_MEMORIAL_STATUSES,
  parseArtistMemorialAdminPayload,
} from "../../domain/artistMemorial.mjs";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../../theme";
import Button from "../Button";
import Icon from "../Icon";
import {
  artistMemorialConsoleOperationOwned,
  artistMemorialConsoleOwnsScope,
  normalizeArtistMemorialConsoleScope,
} from "./artistMemorialConsoleScope.mjs";
import {
  createArtistMemorialDraft,
  isMemorialDraftCandidate,
  memorialDraftCandidates,
} from "./artistMemorialDraft.mjs";

const EMPTY_FORM = Object.freeze({
  artistKey: "",
  status: "draft",
  deathDate: "",
  summary: "",
  thankYou: "",
  accomplishmentsText: "",
  sourceUrl: "",
  sourceTitle: "",
  restartSpotlight: false,
});

const STATUS_LABELS = { draft: "Draft", published: "Published" };

function errorMessage(value) {
  if (typeof value === "string") return value;
  return value?.message || value?.userMessage || "";
}

function dateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) return "Not yet saved";
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "Saved previously";
  }
}

function formFromMemorial(memorial) {
  return {
    artistKey: String(memorial?.artistKey || ""),
    status: ARTIST_MEMORIAL_STATUSES.includes(memorial?.status) ? memorial.status : "draft",
    deathDate: String(memorial?.deathDate || ""),
    summary: String(memorial?.summary || ""),
    thankYou: String(memorial?.thankYou || ""),
    accomplishmentsText: Array.isArray(memorial?.accomplishments) ? memorial.accomplishments.join("\n") : "",
    sourceUrl: String(memorial?.sourceUrl || ""),
    sourceTitle: String(memorial?.sourceTitle || ""),
    restartSpotlight: false,
  };
}

function FormField({ label, hint, multiline = false, style, ...inputProps }) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.amber}
        style={[styles.input, multiline && styles.inputMultiline]}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
      />
    </View>
  );
}

function Choice({ label, selected, onPress, disabled = false }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={({ pressed, focused }) => [
        styles.choice,
        selected && styles.choiceSelected,
        pressed && !disabled && styles.pressed,
        focused && focusRing,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function ConfirmationControl({ checked, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel="This page represents the deceased individual, not a band or group"
      accessibilityState={{ checked, disabled }}
      style={({ pressed, focused }) => [
        styles.confirmation,
        checked && styles.confirmationChecked,
        pressed && !disabled && styles.pressed,
        focused && focusRing,
        disabled && styles.disabled,
      ]}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Icon name="check" size={16} color="#1A1206" strokeWidth={2.6} /> : null}
      </View>
      <View style={styles.confirmationCopy}>
        <Text style={styles.confirmationTitle}>This page represents the deceased individual, not a band or group.</Text>
        <Text style={styles.confirmationHint}>Required every time you save. This confirmation is checked by the server but is never stored on the memorial.</Text>
      </View>
    </Pressable>
  );
}

function RestartControl({ checked, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={`Restart the ${ARTIST_MEMORIAL_SPOTLIGHT_DAYS}-day memorial spotlight`}
      accessibilityState={{ checked, disabled }}
      style={({ pressed, focused }) => [styles.restart, pressed && !disabled && styles.pressed, focused && focusRing, disabled && styles.disabled]}
    >
      <View style={[styles.switchTrack, checked && styles.switchTrackOn]}>
        <View style={[styles.switchThumb, checked && styles.switchThumbOn]} />
      </View>
      <View style={styles.restartCopy}>
        <Text style={styles.restartTitle}>Restart the {ARTIST_MEMORIAL_SPOTLIGHT_DAYS}-day spotlight</Text>
        <Text style={styles.restartHint}>Use this only for a deliberate renewed tribute. Normal edits never reset the spotlight.</Text>
      </View>
    </Pressable>
  );
}

function MemorialRow({ memorial, selected, onEdit }) {
  const published = memorial.status === "published";
  return (
    <View style={[styles.row, selected && styles.rowSelected]}>
      <View style={styles.rowCopy}>
        <View style={styles.rowTopline}>
          <Text selectable style={styles.rowName}>{memorial.artistName || memorial.artistKey}</Text>
          <Text style={[styles.statusBadge, published ? styles.statusPublished : styles.statusDraft]}>
            {published ? "PUBLISHED" : "DRAFT"}
          </Text>
        </View>
        <Text selectable style={styles.rowKey}>{memorial.artistKey}</Text>
        <Text style={styles.rowMeta}>Death date {memorial.deathDate} - Updated {dateTime(memorial.updatedAt)}</Text>
        {memorial.spotlightActive ? <Text style={styles.spotlightMeta}>{ARTIST_MEMORIAL_SPOTLIGHT_DAYS}-day spotlight is active</Text> : null}
      </View>
      <Button title="Edit" variant="secondary" icon="edit" small onPress={onEdit} accessibilityLabel={`Edit memorial for ${memorial.artistName || memorial.artistKey}`} />
    </View>
  );
}

export default function ArtistMemorialConsole({
  memorials = [],
  loading = false,
  saving = false,
  error = "",
  onRefresh,
  onSearchArtists,
  onResolveArtist,
  onSave,
  onSaved,
  sessionScope,
}) {
  const currentScope = normalizeArtistMemorialConsoleScope(sessionScope);
  const [ownerScope, setOwnerScope] = useState(currentScope);
  const [selectedKey, setSelectedKey] = useState(null);
  const [catalogArtist, setCatalogArtist] = useState(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupState, setLookupState] = useState({ scope: currentScope, query: "", status: "idle", results: [], error: "" });
  const [resolveState, setResolveState] = useState({ scope: currentScope, query: "", status: "idle", error: "" });
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM }));
  const [confirmedIndividual, setConfirmedIndividual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");
  const [success, setSuccess] = useState("");
  const operationId = useRef(0);
  const lookupSequence = useRef(0);
  const resolveSequence = useRef(0);
  const resolveController = useRef(null);
  const artistSearchRef = useRef(onSearchArtists);
  const artistResolveRef = useRef(onResolveArtist);
  const scopeRef = useRef(currentScope);
  artistSearchRef.current = onSearchArtists;
  artistResolveRef.current = onResolveArtist;
  scopeRef.current = currentScope;
  const rows = useMemo(() => Array.isArray(memorials) ? memorials.filter((item) => item?.artistKey) : [], [memorials]);
  const ownsSession = artistMemorialConsoleOwnsScope(ownerScope, currentScope);
  const resolving = resolveState.scope === currentScope && resolveState.status === "loading";
  const busy = loading || saving || submitting || resolving || !ownsSession;

  useEffect(() => () => {
    resolveSequence.current += 1;
    resolveController.current?.abort();
    resolveController.current = null;
  }, []);

  useEffect(() => {
    const sequence = lookupSequence.current + 1;
    lookupSequence.current = sequence;
    const query = lookupQuery.trim();
    if (!ownsSession || selectedKey || catalogArtist || query.length < 2 || typeof artistSearchRef.current !== "function") {
      setLookupState({ scope: currentScope, query, status: "idle", results: [], error: "" });
      return undefined;
    }
    const controller = new AbortController();
    setLookupState({ scope: currentScope, query, status: "pending", results: [], error: "" });
    const timer = setTimeout(async () => {
      setLookupState((current) => current.scope === currentScope && current.query === query
        ? { ...current, status: "loading" }
        : current);
      try {
        const results = await artistSearchRef.current(query, { signal: controller.signal, throwOnError: true });
        if (controller.signal.aborted || lookupSequence.current !== sequence || scopeRef.current !== currentScope) return;
        setLookupState({
          scope: currentScope,
          query,
          status: "ready",
          results: memorialDraftCandidates(results),
          error: "",
        });
      } catch (lookupError) {
        if (controller.signal.aborted || lookupSequence.current !== sequence || scopeRef.current !== currentScope) return;
        setLookupState({
          scope: currentScope,
          query,
          status: "error",
          results: [],
          error: errorMessage(lookupError) || "The artist catalog could not be searched.",
        });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [catalogArtist, currentScope, lookupQuery, ownsSession, selectedKey]);

  useEffect(() => {
    if (ownerScope === currentScope) return;
    operationId.current += 1;
    lookupSequence.current += 1;
    resolveSequence.current += 1;
    resolveController.current?.abort();
    resolveController.current = null;
    setOwnerScope(currentScope);
    setSelectedKey(null);
    setCatalogArtist(null);
    setLookupQuery("");
    setLookupState({ scope: currentScope, query: "", status: "idle", results: [], error: "" });
    setResolveState({ scope: currentScope, query: "", status: "idle", error: "" });
    setForm({ ...EMPTY_FORM });
    setConfirmedIndividual(false);
    setSubmitting(false);
    setLocalError("");
    setSuccess("");
  }, [currentScope, ownerScope]);

  useEffect(() => {
    if (loading) setConfirmedIndividual(false);
  }, [loading]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setLocalError("");
    setSuccess("");
  };

  const startNew = () => {
    resolveSequence.current += 1;
    resolveController.current?.abort();
    resolveController.current = null;
    setSelectedKey(null);
    setCatalogArtist(null);
    setLookupQuery("");
    setLookupState({ scope: currentScope, query: "", status: "idle", results: [], error: "" });
    setResolveState({ scope: currentScope, query: "", status: "idle", error: "" });
    setForm({ ...EMPTY_FORM });
    setConfirmedIndividual(false);
    setLocalError("");
    setSuccess("");
  };

  const select = (memorial) => {
    resolveSequence.current += 1;
    resolveController.current?.abort();
    resolveController.current = null;
    setSelectedKey(memorial.artistKey);
    setCatalogArtist(null);
    setLookupQuery("");
    setLookupState({ scope: currentScope, query: "", status: "idle", results: [], error: "" });
    setResolveState({ scope: currentScope, query: "", status: "idle", error: "" });
    setForm(formFromMemorial(memorial));
    setConfirmedIndividual(false);
    setLocalError("");
    setSuccess("");
  };

  const chooseCatalogArtist = (artist) => {
    const key = typeof artist?.key === "string" ? artist.key.trim() : "";
    if (!key || key.length > 180 || !isMemorialDraftCandidate(artist)) {
      setLocalError("That artist needs an exact MusicBrainz-backed Pit identity before a memorial can be drafted.");
      return;
    }
    lookupSequence.current += 1;
    setCatalogArtist(artist);
    setLookupQuery(artist.name);
    setLookupState({ scope: currentScope, query: artist.name, status: "chosen", results: [], error: "" });
    setForm((current) => createArtistMemorialDraft({ artistKey: key, artist, existingForm: current }));
    setConfirmedIndividual(false);
    setLocalError("");
    setSuccess("Safe draft copy added from Pit's catalog. Add the death date and a trusted public source, then verify every field before saving.");
  };

  const changeCatalogArtist = () => {
    lookupSequence.current += 1;
    resolveSequence.current += 1;
    resolveController.current?.abort();
    resolveController.current = null;
    setCatalogArtist(null);
    setLookupQuery("");
    setLookupState({ scope: currentScope, query: "", status: "idle", results: [], error: "" });
    setResolveState({ scope: currentScope, query: "", status: "idle", error: "" });
    setForm({ ...EMPTY_FORM });
    setConfirmedIndividual(false);
    setLocalError("");
    setSuccess("");
  };

  const resolveExactArtist = async () => {
    if (!ownsSession || selectedKey || catalogArtist || typeof artistResolveRef.current !== "function") return;
    const query = lookupQuery.trim();
    if (query.length < 2) {
      setLocalError("Enter the artist's full stage name before finding an exact identity.");
      return;
    }

    resolveSequence.current += 1;
    const sequence = resolveSequence.current;
    resolveController.current?.abort();
    const controller = new AbortController();
    resolveController.current = controller;
    const operationScope = currentScope;
    setResolveState({ scope: operationScope, query, status: "loading", error: "" });
    setLocalError("");
    setSuccess("");
    try {
      const artist = await artistResolveRef.current(query, { signal: controller.signal });
      if (controller.signal.aborted || resolveSequence.current !== sequence || scopeRef.current !== operationScope) return;
      if (!isMemorialDraftCandidate(artist)) {
        throw new TypeError("Pit could not confirm a valid MusicBrainz identity for that artist. Check the full stage name and try again.");
      }
      chooseCatalogArtist(artist);
      setResolveState({ scope: operationScope, query, status: "ready", error: "" });
    } catch (resolveError) {
      if (controller.signal.aborted || resolveSequence.current !== sequence || scopeRef.current !== operationScope) return;
      setResolveState({
        scope: operationScope,
        query,
        status: "error",
        error: errorMessage(resolveError) || "Pit could not verify an exact artist identity.",
      });
    } finally {
      if (resolveController.current === controller) resolveController.current = null;
    }
  };

  const submit = async () => {
    if (!ownsSession) return;
    if (!selectedKey && !isMemorialDraftCandidate(catalogArtist)) {
      setLocalError("Choose an exact MusicBrainz-backed artist before saving this memorial.");
      return;
    }
    const key = form.artistKey.trim();
    if (!key || key.length > 180) {
      setLocalError("Choose the exact artist from Pit before saving this memorial.");
      return;
    }
    const parsed = parseArtistMemorialAdminPayload({
      status: form.status,
      deathDate: form.deathDate,
      summary: form.summary,
      thankYou: form.thankYou,
      accomplishments: form.accomplishmentsText.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean),
      sourceUrl: form.sourceUrl,
      sourceTitle: form.sourceTitle,
      confirmedIndividual,
      restartSpotlight: form.restartSpotlight,
    });
    if (!parsed.valid) {
      setLocalError(parsed.message);
      return;
    }
    if (typeof onSave !== "function") {
      setLocalError("Memorial saving is not connected yet.");
      return;
    }

    setSubmitting(true);
    setLocalError("");
    setSuccess("");
    const operation = operationId.current + 1;
    operationId.current = operation;
    const operationScope = currentScope;
    try {
      const saved = await onSave({
        artistKey: key,
        ...parsed.payload,
        ...(isMemorialDraftCandidate(catalogArtist)
          ? { expectedArtistMbid: String(catalogArtist.mbid).toLowerCase() }
          : {}),
      });
      if (!artistMemorialConsoleOperationOwned({
        operationScope,
        operationId: operation,
        currentScope: scopeRef.current,
        currentOperationId: operationId.current,
      })) return;
      setSelectedKey(key);
      setConfirmedIndividual(false);
      setForm((current) => ({ ...current, artistKey: key, restartSpotlight: false }));
      setSuccess(`${form.status === "published" ? "Published" : "Saved draft"} memorial for ${key}.`);
      onSaved?.(saved);
    } catch (saveError) {
      if (artistMemorialConsoleOperationOwned({
        operationScope,
        operationId: operation,
        currentScope: scopeRef.current,
        currentOperationId: operationId.current,
      })) setLocalError(errorMessage(saveError) || "The memorial could not be saved. Try again.");
    } finally {
      if (artistMemorialConsoleOperationOwned({
        operationScope,
        operationId: operation,
        currentScope: scopeRef.current,
        currentOperationId: operationId.current,
      })) setSubmitting(false);
    }
  };

  if (!ownsSession) {
    return (
      <View style={styles.scopeReset} accessibilityLiveRegion="polite">
        <Icon name="shield" size={18} color={colors.textFaint} />
        <Text style={styles.scopeResetText}>{currentScope ? "Securing memorial workspace..." : "Memorial workspace requires an admin session."}</Text>
      </View>
    );
  }

  const externalError = errorMessage(error);
  const publishedExisting = selectedKey && rows.find((item) => item.artistKey === selectedKey)?.status === "published";
  const restartDisabled = busy || form.status !== "published" || !publishedExisting;

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.headingTitle}>Artist memorials</Text>
          <Text selectable style={styles.headingDetail}>Create a verified, permanent tribute for an individual artist. Publishing opens one respectful {ARTIST_MEMORIAL_SPOTLIGHT_DAYS}-day spotlight; the tribute card remains on the artist page afterward.</Text>
        </View>
        <View style={styles.headingActions}>
          <Button title="New memorial" variant="secondary" icon="plus" small onPress={startNew} disabled={busy} />
          {onRefresh ? <Button title="Refresh" variant="secondary" small loading={loading} onPress={onRefresh} /> : null}
        </View>
      </View>

      {(localError || externalError) ? (
        <View style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <Icon name="x" size={16} color={colors.danger} />
          <Text selectable style={styles.errorText}>{localError || externalError}</Text>
        </View>
      ) : null}
      {success ? <Text style={styles.success} accessibilityLiveRegion="polite">{success}</Text> : null}

      <View style={[styles.form, shadow.card]}>
        <View style={styles.formHeading}>
          <View>
            <Text style={styles.kicker}>{selectedKey ? "EDIT TRIBUTE" : "NEW TRIBUTE"}</Text>
            <Text accessibilityRole="header" style={styles.formTitle}>{selectedKey || "Choose an artist"}</Text>
          </View>
          {selectedKey ? <Text style={styles.editingBadge}>EXISTING</Text> : null}
        </View>

        {!selectedKey ? (
          <View style={styles.autofill}>
            <View style={styles.autofillHeading}>
              <View style={styles.autofillHeadingCopy}>
                <Text style={styles.autofillKicker}>SAFE AUTO-FILL</Text>
                <Text style={styles.autofillTitle}>Start from an exact Pit artist</Text>
                <Text style={styles.autofillHint}>Search the catalog and choose one result. Pit fills a neutral private draft from catalog facts, but never guesses a death date, source, award, or cause of death—and never publishes automatically.</Text>
              </View>
              {catalogArtist ? <Button title="Clear draft & choose another" variant="secondary" small disabled={busy} onPress={changeCatalogArtist} /> : null}
            </View>
            {catalogArtist ? (
              <View style={styles.chosenArtist} accessibilityLiveRegion="polite">
                <Icon name="check" size={17} color={colors.good} strokeWidth={2.5} />
                <View style={styles.chosenArtistCopy}>
                  <Text selectable style={styles.chosenArtistName}>{catalogArtist.name}</Text>
                  <Text selectable style={styles.chosenArtistKey}>{catalogArtist.key}</Text>
                </View>
                <Text style={styles.draftBadge}>DRAFT FILLED</Text>
              </View>
            ) : (
              <>
                <View style={styles.lookup}>
                  <Icon name="search" size={17} color={colors.textDim} />
                  <TextInput
                    accessibilityRole="search"
                    accessibilityLabel="Find an artist to auto-fill a memorial draft"
                    accessibilityHint="Searches Pit's artist catalog and shows exact identities to choose from"
                    value={lookupQuery}
                    onChangeText={(value) => {
                      resolveSequence.current += 1;
                      resolveController.current?.abort();
                      resolveController.current = null;
                      setLookupQuery(value);
                      setResolveState({ scope: currentScope, query: value.trim(), status: "idle", error: "" });
                      setLocalError("");
                      setSuccess("");
                    }}
                    editable={!busy && typeof onSearchArtists === "function"}
                    style={styles.lookupInput}
                    placeholder="Search an artist name"
                    placeholderTextColor={colors.textFaint}
                    selectionColor={colors.amber}
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {lookupState.status === "pending" || lookupState.status === "loading"
                    ? <ActivityIndicator accessibilityLabel="Searching the artist catalog" size="small" color={colors.amber} />
                    : null}
                </View>
                {lookupState.scope === currentScope && lookupState.status === "error" ? (
                  <Text selectable accessibilityLiveRegion="assertive" style={styles.lookupError}>{lookupState.error}</Text>
                ) : null}
                {lookupState.scope === currentScope && lookupState.status === "ready" && lookupState.results.length === 0 ? (
                  <View style={styles.exactLookup} accessibilityLiveRegion="polite">
                    <Text style={styles.lookupEmpty}>No exact memorial-ready match is stored in Pit yet.</Text>
                    <Button
                      title="Find exact artist & autofill"
                      variant="secondary"
                      icon="search"
                      small
                      loading={resolving}
                      disabled={busy || typeof onResolveArtist !== "function"}
                      onPress={resolveExactArtist}
                      accessibilityHint="Verifies this stage name against MusicBrainz and fills a private draft without publishing it"
                    />
                    <Text style={styles.exactLookupHint}>Pit will verify one exact MusicBrainz identity and fill only the private draft. You must still enter the death date, source, and confirmation yourself.</Text>
                    {resolveState.scope === currentScope && resolveState.status === "error" ? (
                      <Text selectable accessibilityLiveRegion="assertive" style={styles.lookupError}>{resolveState.error}</Text>
                    ) : null}
                  </View>
                ) : null}
                {lookupState.scope === currentScope && lookupState.status === "ready" && lookupState.results.length > 0 ? (
                  <Text accessibilityLiveRegion="polite" style={styles.lookupCount}>{lookupState.results.length} memorial-ready {lookupState.results.length === 1 ? "artist" : "artists"} found.</Text>
                ) : null}
                {lookupState.scope === currentScope && lookupState.results.length ? (
                  <View accessibilityRole="list" style={styles.lookupResults}>
                    {lookupState.results.map((artist) => (
                      <Pressable
                        key={`${artist.key}:${artist.mbid || "catalog"}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Use ${artist.name} and auto-fill a private memorial draft`}
                        onPress={() => chooseCatalogArtist(artist)}
                        disabled={busy}
                        style={({ pressed, focused }) => [styles.lookupResult, pressed && styles.pressed, focused && focusRing, busy && styles.disabled]}
                      >
                        <View style={styles.lookupResultCopy}>
                          <Text selectable style={styles.lookupResultName}>{artist.name}</Text>
                          <Text selectable style={styles.lookupResultMeta}>{[artist.genre, artist.country, artist.key, `MBID …${String(artist.mbid).slice(-8)}`].filter(Boolean).join(" · ")}</Text>
                        </View>
                        <Text style={styles.lookupResultAction}>USE & AUTO-FILL</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        <FormField
          label="Artist key"
          hint="Filled only after Pit confirms an exact MusicBrainz-backed artist. It cannot be entered manually."
          value={form.artistKey}
          editable={false}
          maxLength={180}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="artist-catalog-key"
          accessibilityState={{ disabled: true }}
        />

        <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel="Memorial publication status">
          <Text style={styles.fieldLabel}>Status</Text>
          <Text style={styles.fieldHint}>Drafts are private to staff. Published memorials appear permanently on the artist page.</Text>
          <View style={styles.choices}>
            {ARTIST_MEMORIAL_STATUSES.map((status) => (
              <Choice
                key={status}
                label={STATUS_LABELS[status]}
                selected={form.status === status}
                disabled={busy}
                onPress={() => {
                  update("status", status);
                  if (status !== "published") update("restartSpotlight", false);
                }}
              />
            ))}
          </View>
        </View>

        <View style={styles.columns}>
          <FormField
            label="Death date"
            hint="YYYY-MM-DD"
            style={styles.columnField}
            value={form.deathDate}
            onChangeText={(value) => update("deathDate", value)}
            editable={!busy}
            maxLength={10}
            placeholder="2026-08-25"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <FormField
            label="Source title (optional)"
            hint="The publication or announcement name."
            style={styles.columnField}
            value={form.sourceTitle}
            onChangeText={(value) => update("sourceTitle", value)}
            editable={!busy}
            maxLength={ARTIST_MEMORIAL_LIMITS.sourceTitle}
            placeholder="Official announcement"
          />
        </View>

        <FormField
          label="Memorial summary"
          hint={`20-${ARTIST_MEMORIAL_LIMITS.summary} characters. Keep this factual, warm, and concise.`}
          value={form.summary}
          onChangeText={(value) => update("summary", value)}
          editable={!busy}
          maxLength={ARTIST_MEMORIAL_LIMITS.summary}
          placeholder="A respectful overview of the artist's life and connection to live music."
          multiline
        />
        <FormField
          label="Thank-you"
          hint={`3-${ARTIST_MEMORIAL_LIMITS.thankYou} characters, written from the Pit community.`}
          value={form.thankYou}
          onChangeText={(value) => update("thankYou", value)}
          editable={!busy}
          maxLength={ARTIST_MEMORIAL_LIMITS.thankYou}
          placeholder="Thank you for the music and the nights we shared."
          multiline
        />
        <FormField
          label="Accomplishments"
          hint={`One per line. Include 1-${ARTIST_MEMORIAL_LIMITS.accomplishments}; each may be up to ${ARTIST_MEMORIAL_LIMITS.accomplishment} characters.`}
          value={form.accomplishmentsText}
          onChangeText={(value) => update("accomplishmentsText", value)}
          editable={!busy}
          maxLength={(ARTIST_MEMORIAL_LIMITS.accomplishment + 1) * ARTIST_MEMORIAL_LIMITS.accomplishments}
          placeholder={"A landmark album\nAn unforgettable live legacy"}
          multiline
        />
        <FormField
          label="Verification source URL"
          hint="Required. Public HTTPS source only; private-network and credentialed links are rejected."
          value={form.sourceUrl}
          onChangeText={(value) => update("sourceUrl", value)}
          editable={!busy}
          maxLength={ARTIST_MEMORIAL_LIMITS.sourceUrl}
          placeholder="https://example.org/official-announcement"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <RestartControl
          checked={form.restartSpotlight}
          disabled={restartDisabled}
          onPress={() => update("restartSpotlight", !form.restartSpotlight)}
        />
        <ConfirmationControl
          checked={confirmedIndividual}
          disabled={busy}
          onPress={() => {
            setConfirmedIndividual((current) => !current);
            setLocalError("");
            setSuccess("");
          }}
        />

        <Button
          title={form.status === "published" ? "Save & publish tribute" : "Save private draft"}
          icon="check"
          loading={saving || submitting}
          disabled={busy || !confirmedIndividual || typeof onSave !== "function" || (!selectedKey && !isMemorialDraftCandidate(catalogArtist))}
          onPress={submit}
          accessibilityHint="Validates the memorial and saves it to the selected artist"
        />
      </View>

      <View style={styles.library}>
        <View style={styles.libraryHeading}>
          <Text accessibilityRole="header" style={styles.libraryTitle}>Existing memorials</Text>
          <Text style={styles.libraryCount}>{rows.length}</Text>
        </View>
        {loading && !rows.length ? <Text style={styles.empty} accessibilityLiveRegion="polite">Loading artist memorials...</Text> : null}
        {!loading && !rows.length ? <Text style={styles.empty}>No memorials have been created.</Text> : null}
        {rows.map((memorial) => (
          <MemorialRow
            key={memorial.artistKey}
            memorial={memorial}
            selected={selectedKey === memorial.artistKey}
            onEdit={() => select(memorial)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space(5) },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: space(3) },
  headingCopy: { flex: 1, minWidth: 250, maxWidth: 720 },
  headingTitle: { color: colors.text, fontFamily: displayFont, fontSize: 24, lineHeight: 30, fontWeight: "900" },
  headingDetail: { color: colors.textDim, fontSize: 12.5, lineHeight: 19, paddingTop: space(1) },
  headingActions: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  error: { flexDirection: "row", alignItems: "flex-start", gap: space(2), padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: `${colors.danger}0D` },
  errorText: { flex: 1, color: colors.danger, fontSize: 12.5, lineHeight: 18, fontWeight: "700" },
  success: { color: colors.good, fontSize: 12.5, lineHeight: 18, fontWeight: "800" },
  form: { width: "100%", maxWidth: 880, alignSelf: "center", gap: space(4), padding: space(5), borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  formHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3) },
  kicker: { color: colors.gold, fontFamily: mono, fontSize: 9.5, lineHeight: 14, fontWeight: "900", letterSpacing: 1.3 },
  formTitle: { color: colors.text, fontFamily: displayFont, fontSize: 20, lineHeight: 26, fontWeight: "900", paddingTop: 2 },
  editingBadge: { color: colors.cool, fontFamily: mono, fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.cool, paddingHorizontal: space(2), paddingVertical: space(1) },
  autofill: { gap: space(3), padding: space(4), borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: `${colors.cool}66`, backgroundColor: `${colors.cool}0A` },
  autofillHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: space(3) },
  autofillHeadingCopy: { flex: 1, minWidth: 220, gap: 3 },
  autofillKicker: { color: colors.cool, fontFamily: mono, fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.2 },
  autofillTitle: { color: colors.text, fontSize: 14.5, lineHeight: 20, fontWeight: "900" },
  autofillHint: { color: colors.textDim, fontSize: 11.5, lineHeight: 17 },
  lookup: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space(2.5), paddingHorizontal: space(3.5), borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  lookupInput: { flex: 1, minWidth: 0, minHeight: 46, color: colors.text, fontSize: 13.5, lineHeight: 20, paddingVertical: space(2.5) },
  lookupError: { color: colors.danger, fontSize: 11.5, lineHeight: 17, fontWeight: "700" },
  lookupEmpty: { color: colors.textDim, fontSize: 11.5, lineHeight: 17 },
  exactLookup: { alignItems: "flex-start", gap: space(2), padding: space(3), borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  exactLookupHint: { maxWidth: 660, color: colors.textFaint, fontSize: 10.5, lineHeight: 16 },
  lookupCount: { color: colors.textDim, fontSize: 10.5, lineHeight: 16, fontWeight: "700" },
  lookupResults: { gap: space(2) },
  lookupResult: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5), borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  lookupResultCopy: { flex: 1, minWidth: 0 },
  lookupResultName: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "900" },
  lookupResultMeta: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, lineHeight: 14, paddingTop: 2 },
  lookupResultAction: { color: colors.amber, fontFamily: mono, fontSize: 8.5, lineHeight: 13, fontWeight: "900", letterSpacing: 0.6 },
  chosenArtist: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: space(3), padding: space(3), borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: `${colors.good}77`, backgroundColor: `${colors.good}0A` },
  chosenArtistCopy: { flex: 1, minWidth: 0 },
  chosenArtistName: { color: colors.text, fontSize: 13.5, lineHeight: 19, fontWeight: "900" },
  chosenArtistKey: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, lineHeight: 14, paddingTop: 1 },
  draftBadge: { color: colors.good, fontFamily: mono, fontSize: 8.5, lineHeight: 13, fontWeight: "900", letterSpacing: 0.7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.good, paddingHorizontal: space(2), paddingVertical: 2 },
  field: { gap: space(1.5) },
  fieldLabel: { color: colors.text, fontSize: 12.5, lineHeight: 17, fontWeight: "900" },
  fieldHint: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
  input: { minHeight: 48, color: colors.text, backgroundColor: colors.bgElev, borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, paddingHorizontal: space(3.5), paddingVertical: space(3), fontSize: 13.5, lineHeight: 20 },
  inputMultiline: { minHeight: 112 },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: space(3) },
  columnField: { flexGrow: 1, flexBasis: 280, minWidth: 220 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: space(2), paddingTop: space(1) },
  choice: { minWidth: 108, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: space(3), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  choiceSelected: { borderColor: colors.amber, backgroundColor: colors.amberStrong },
  choiceText: { color: colors.textDim, fontSize: 12, fontWeight: "900" },
  choiceTextSelected: { color: "#1A1206" },
  confirmation: { minHeight: 64, flexDirection: "row", alignItems: "flex-start", gap: space(3), padding: space(3.5), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  confirmationChecked: { borderColor: colors.amber, backgroundColor: `${colors.amber}0D` },
  checkbox: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.textFaint, backgroundColor: colors.surface },
  checkboxChecked: { borderColor: colors.amber, backgroundColor: colors.amberStrong },
  confirmationCopy: { flex: 1, minWidth: 0, gap: 3 },
  confirmationTitle: { color: colors.text, fontSize: 12.5, lineHeight: 18, fontWeight: "900" },
  confirmationHint: { color: colors.textFaint, fontSize: 10.5, lineHeight: 16 },
  restart: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: space(3), padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  switchTrack: { width: 44, height: 26, borderRadius: 13, justifyContent: "center", paddingHorizontal: 3, backgroundColor: colors.surfaceAlt },
  switchTrackOn: { backgroundColor: colors.amberStrong },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.textDim },
  switchThumbOn: { alignSelf: "flex-end", backgroundColor: "#1A1206" },
  restartCopy: { flex: 1, minWidth: 0 },
  restartTitle: { color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: "900" },
  restartHint: { color: colors.textFaint, fontSize: 10.5, lineHeight: 16, paddingTop: 2 },
  library: { gap: space(2.5) },
  libraryHeading: { flexDirection: "row", alignItems: "center", gap: space(2) },
  libraryTitle: { color: colors.text, fontFamily: displayFont, fontSize: 19, lineHeight: 25, fontWeight: "900" },
  libraryCount: { minWidth: 25, height: 25, borderRadius: 13, textAlign: "center", textAlignVertical: "center", color: colors.text, backgroundColor: colors.surfaceAlt, fontFamily: mono, fontSize: 10, lineHeight: 25, fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3), padding: space(3.5), borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  rowSelected: { borderColor: colors.amber },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTopline: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space(2) },
  rowName: { flexShrink: 1, color: colors.text, fontSize: 13.5, lineHeight: 19, fontWeight: "900" },
  rowKey: { color: colors.textFaint, fontFamily: mono, fontSize: 10, lineHeight: 15, paddingTop: 2 },
  rowMeta: { color: colors.textDim, fontSize: 10.5, lineHeight: 16, paddingTop: space(1) },
  spotlightMeta: { color: colors.gold, fontSize: 10.5, lineHeight: 16, fontWeight: "800", paddingTop: 2 },
  statusBadge: { fontFamily: mono, fontSize: 8.5, lineHeight: 13, fontWeight: "900", letterSpacing: 0.8, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: space(2), paddingVertical: 2 },
  statusPublished: { color: colors.good, borderColor: colors.good },
  statusDraft: { color: colors.textFaint, borderColor: colors.line },
  empty: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, textAlign: "center", paddingVertical: space(5) },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.45 },
  scopeReset: { minHeight: 120, alignItems: "center", justifyContent: "center", gap: space(2), padding: space(5), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  scopeResetText: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, textAlign: "center" },
});
