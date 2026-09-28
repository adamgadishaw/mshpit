import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import { colors, radius } from "../../theme";
import { MAX_NEWS_LINKS, newsCandidateLine, newsCandidateNeed, newsDraftStatus, newsEditorCostLine, newsLiveStatus, parseNewsLinks } from "./newsDeskEditorApi.mjs";
import { discardDraft, endLive, loadNewsEditor, postLiveUpdate, publishDraft, removeLiveUpdate, startLive, writeDraft } from "./newsDeskEditorService";

// Live coverage of a big night: start it, post short updates, end it. The
// timeline also pulls in every outlet headline matching the keywords.
function LiveControls({ accountId, live, busy, pending, act }) {
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [hours, setHours] = useState("4");
  const [update, setUpdate] = useState("");
  const [link, setLink] = useState("");
  const running = live.find((event) => event.live);
  if (!running) {
    return <View style={styles.group}>
      <Text style={styles.label}>LIVE COVERAGE</Text>
      <Text selectable style={styles.hint}>For a big night like an award show. Readers see a LIVE card at the top of the news with every outlet headline matching your keywords, plus the updates you post here. No Claude cost.</Text>
      <TextInput accessibilityLabel="Live coverage title" style={styles.input} value={title} onChangeText={setTitle}
        placeholder="2026 MTV VMAs" placeholderTextColor={colors.textFaint} maxLength={80} />
      <TextInput accessibilityLabel="Keywords the outlets will use, separated by commas" style={styles.input} value={keywords} onChangeText={setKeywords}
        placeholder="VMAs, Video Music Awards" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
      <View style={styles.searchRow}>
        <TextInput accessibilityLabel="How many hours it runs" style={[styles.input, styles.hours]} value={hours} onChangeText={setHours}
          keyboardType="number-pad" maxLength={2} />
        <Text style={styles.hint}>hours</Text>
        <Button small title="Start live coverage" accessibilityLabel="Start live coverage"
          disabled={busy || title.trim().length < 3 || !keywords.trim()} loading={pending === "live:start"}
          onPress={() => act("live:start", () => startLive({ accountId, title, keywords, hours }), "Live coverage started. It is at the top of the news now.")} />
      </View>
    </View>;
  }
  const notes = running.items.filter((item) => item.kind === "note");
  return <View style={styles.group}>
    <Text style={styles.label}>LIVE COVERAGE</Text>
    <Text selectable style={styles.headline}>{running.title}</Text>
    <Text selectable style={styles.hint}>{newsLiveStatus(running)}</Text>
    <TextInput accessibilityLabel="Live update text" style={[styles.input, styles.links]} multiline value={update} onChangeText={setUpdate}
      placeholder="Sabrina Carpenter wins Video of the Year" placeholderTextColor={colors.textFaint} maxLength={280} />
    <TextInput accessibilityLabel="Optional link for the update" style={styles.input} value={link} onChangeText={setLink}
      placeholder="Optional https:// link" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
    <View style={styles.actions}>
      <Button small title="Post update" accessibilityLabel="Post the live update" disabled={busy || !update.trim()} loading={pending === "live:note"}
        onPress={() => act("live:note", async () => { await postLiveUpdate({ accountId, id: running.id, text: update, url: link }); setUpdate(""); setLink(""); }, "Update posted.")} />
      <Button small title="End live coverage" variant="secondary" accessibilityLabel={`End live coverage of ${running.title}`} disabled={busy}
        loading={pending === "live:end"} onPress={() => act("live:end", () => endLive({ accountId, id: running.id }), "Live coverage ended. The recap stays up until tomorrow evening.")} />
    </View>
    {notes.map((note) => <View key={note.id} style={styles.row}>
      <Text selectable style={[styles.copy, styles.rowCopy]}>{note.text}</Text>
      <Button small title="Remove" variant="secondary" accessibilityLabel={`Remove the update ${note.text}`} disabled={busy}
        loading={pending === `live:remove:${note.id}`} onPress={() => act(`live:remove:${note.id}`, () => removeLiveUpdate({ accountId, noteId: note.id }), "Update removed.")} />
    </View>)}
  </View>;
}

const failure = (error, fallback) => (typeof error?.message === "string" && error.message.trim() ? error.message : fallback);

function Candidate({ candidate, busy, disabled, onWrite }) {
  return <View style={styles.row}>
    <View style={styles.rowCopy}>
      <Text selectable style={styles.headline}>{candidate.headline}</Text>
      <Text selectable style={styles.hint}>{newsCandidateLine(candidate)}</Text>
      {!candidate.ready ? <Text selectable style={styles.hint}>{newsCandidateNeed(candidate)}</Text> : null}
    </View>
    <Button small title="Write it" variant={candidate.ready ? "primary" : "secondary"}
      accessibilityLabel={`Write a draft about ${candidate.headline}`}
      disabled={disabled} loading={busy} onPress={() => onWrite(candidate)} />
  </View>;
}

function Draft({ draft, pending, disabled, onPublish, onDiscard }) {
  const open = draft.status === "draft" && !draft.expired;
  return <View style={styles.draft} testID={`news-draft-${draft.id}`}>
    <Text selectable style={draft.status === "declined" ? styles.error : styles.label}>{newsDraftStatus(draft).toUpperCase()}</Text>
    {draft.headline ? <Text selectable style={styles.draftHeadline}>{draft.headline}</Text> : null}
    {draft.summary ? <Text selectable style={styles.copy}>{draft.summary}</Text> : null}
    {draft.body ? <Text selectable style={styles.hint}>{draft.body}</Text> : null}
    <Text selectable style={styles.hint}>Sources: {draft.sources.map((source) => source.name).join(", ")} · cost ${draft.costUsd.toFixed(3)}</Text>
    {open || draft.status === "declined" ? <View style={styles.actions}>
      {open ? <Button small title="Publish now" accessibilityLabel={`Publish ${draft.headline}`}
        disabled={disabled} loading={pending === `publish:${draft.id}`} onPress={() => onPublish(draft)} /> : null}
      <Button small title="Discard" variant="secondary" accessibilityLabel={`Discard the draft ${draft.headline || ""}`.trim()}
        disabled={disabled} loading={pending === `discard:${draft.id}`} onPress={() => onDiscard(draft)} />
    </View> : null}
  </View>;
}

// Write a story on demand: pick one the outlets are covering, search the
// week's coverage, or paste links; review Claude's draft, then publish it.
export default function NewsDeskEditor({ accountId, role, active = true }) {
  const allowed = role === "admin" && !!accountId;
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [links, setLinks] = useState("");
  const [pending, setPending] = useState(null);
  const request = useRef(0);

  const load = useCallback(async (search = "") => {
    const ticket = ++request.current;
    setPending(search ? "search" : "load");
    try {
      const next = await loadNewsEditor({ accountId, query: search });
      if (ticket === request.current) { setOverview(next); setError(""); }
    } catch (reason) {
      if (ticket === request.current) setError(failure(reason, "The news editor could not load. Try again in a moment."));
    } finally {
      if (ticket === request.current) setPending(null);
    }
  }, [accountId]);

  useEffect(() => {
    if (allowed && active) void load();
    return () => { request.current += 1; };
  }, [allowed, active, load]);

  if (!allowed) return null;
  const busy = !!pending;
  const pasted = parseNewsLinks(links);
  const act = async (key, work, done) => {
    setPending(key);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(done);
      await load(overview?.query || "");
    } catch (reason) {
      setError(failure(reason, "That did not go through. Refresh and try again."));
      setPending(null);
    }
  };
  const write = (candidate) => act(`write:${candidate?.headline || "links"}`,
    () => writeDraft({ accountId, reportUrls: candidate?.reportUrls || [], links: pasted }),
    "Draft written. Review it below before publishing.");
  const publish = (draft) => act(`publish:${draft.id}`, () => publishDraft({ accountId, id: draft.id }),
    "Published. It is on the News tab now.");
  const discard = (draft) => act(`discard:${draft.id}`, () => discardDraft({ accountId, id: draft.id }), "Draft discarded.");
  const writing = typeof pending === "string" && pending.startsWith("write:") ? pending : null;
  const disabled = busy || !overview?.configured;

  return <View style={styles.editor} testID="news-desk-editor">
    <Text accessibilityRole="header" style={styles.title}>Write a story now</Text>
    <Text selectable style={styles.copy}>When the feed feels stale, pick a story the outlets are covering, search for one, or paste links. Claude writes a draft you review; publishing skips the time slots. A story still needs two independent outlets, three for deaths and legal news.</Text>
    {overview ? <Text selectable style={styles.hint}>{newsEditorCostLine(overview)}</Text> : null}
    {overview && !overview.configured ? <Text selectable style={styles.error}>Add ANTHROPIC_API_KEY in Render to write drafts. Browsing and search still work.</Text> : null}
    {overview && overview.configured && !overview.publisherReady ? <Text selectable style={styles.error}>The news account needs review before anything can be published.</Text> : null}
    {error ? <Text selectable accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text selectable accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}

    {overview ? <LiveControls accountId={accountId} live={Array.isArray(overview.live) ? overview.live : []} busy={busy} pending={pending} act={act} /> : null}

    {(overview?.drafts?.recent || []).length ? <View style={styles.group}>
      <Text style={styles.label}>RECENT DRAFTS</Text>
      {overview.drafts.recent.map((draft) => <Draft key={draft.id} draft={draft} pending={pending} disabled={busy}
        onPublish={publish} onDiscard={discard} />)}
    </View> : null}

    <View style={styles.group}>
      <Text style={styles.label}>BEING COVERED NOW</Text>
      {!overview ? <Text style={styles.hint}>{pending === "load" ? "Loading stories…" : "Stories are not loaded."}</Text>
        : overview.candidates.length ? overview.candidates.map((candidate) => <Candidate key={candidate.reportUrls.join(" ")} candidate={candidate}
          busy={writing === `write:${candidate.headline}`} disabled={disabled} onWrite={write} />)
          : <Text style={styles.hint}>No outlet stories from the last two days are waiting. Try a search or paste links.</Text>}
    </View>

    <View style={styles.group}>
      <Text style={styles.label}>FIND COVERAGE</Text>
      <View style={styles.searchRow}>
        <TextInput accessibilityRole="search" accessibilityLabel="Search the week's outlet coverage" style={styles.input}
          value={query} onChangeText={setQuery} placeholder="Artist, festival or topic" placeholderTextColor={colors.textFaint}
          autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => query.trim() && load(query)} />
        <Button small title="Search" variant="secondary" accessibilityLabel="Search coverage" disabled={busy || query.trim().length < 2}
          loading={pending === "search"} onPress={() => load(query)} />
      </View>
      {overview?.query ? (overview.matches?.length ? overview.matches.map((candidate) => <Candidate key={`match ${candidate.reportUrls.join(" ")}`}
        candidate={candidate} busy={writing === `write:${candidate.headline}`} disabled={disabled} onWrite={write} />)
        : <Text selectable style={styles.hint}>None of the outlets covered "{overview.query}" in the last week. Paste links if you have them.</Text>) : null}
    </View>

    <View style={styles.group}>
      <Text style={styles.label}>ARTICLE LINKS (OPTIONAL)</Text>
      <TextInput accessibilityLabel="Article links to include in the draft" style={[styles.input, styles.links]} multiline
        value={links} onChangeText={setLinks} placeholder={`Up to ${MAX_NEWS_LINKS} links from the outlets the desk reads, one per line`}
        placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
      <Text selectable style={styles.hint}>Links are added to whichever story you write next, or written up on their own.</Text>
      <View style={styles.actions}>
        <Button small title="Write from links" variant="secondary" accessibilityLabel="Write a draft from the pasted links"
          disabled={disabled || !pasted.length} loading={writing === "write:links"} onPress={() => write(null)} />
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  editor: { gap: 14, paddingTop: 6 },
  title: { color: colors.text, fontSize: 15, fontWeight: "800" },
  copy: { color: colors.textDim, fontSize: 13, lineHeight: 20, flexShrink: 1 },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  notice: { color: colors.good, fontSize: 13, lineHeight: 20 },
  label: { color: colors.textDim, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  group: { gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  rowCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 260, minWidth: 0, gap: 3 },
  headline: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  draft: { gap: 6, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  draftHeadline: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: "800" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  searchRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  input: { flexGrow: 1, flexBasis: 220, minWidth: 0, color: colors.text, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  links: { minHeight: 72, textAlignVertical: "top" },
  hours: { flexGrow: 0, flexBasis: 64, width: 64 },
});
