import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import { colors, radius } from "../../theme";
import { MAX_NEWS_LINKS, categoriesText, livePageUrl, newsCandidateLine, newsCandidateNeed, newsDraftStatus, newsEditorCostLine, newsLiveStatus,
  parseNewsLinks, parseStartTime } from "./newsDeskEditorApi.mjs";
import { discardDraft, endLive, loadNewsEditor, markLiveWinner, postLiveUpdate, publishDraft, removeLiveUpdate, setLiveCategories, startLive, writeDraft } from "./newsDeskEditorService";

// Live coverage of a big night: schedule or start it, paste the award
// categories, tap each winner as it is announced, post short updates, end
// it. The timeline also pulls in every outlet headline matching the keywords.
function WinnersControls({ accountId, event, busy, pending, act }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const categories = event.winners?.categories || [];
  const suggestions = new Map((event.suggestions || []).map((item) => [item.categoryId, item]));
  if (!categories.length || editing) {
    return <View style={styles.group}>
      <Text style={styles.label}>AWARD CATEGORIES</Text>
      <Text selectable style={styles.hint}>One category per line with its nominees, like "Video of the Year: Artist A; Artist B; Artist C". A category name on its own line followed by one nominee per line works too.</Text>
      <TextInput accessibilityLabel="Award categories and nominees" style={[styles.input, styles.categories]} multiline value={text} onChangeText={setText}
        placeholder={"Video of the Year: Sabrina Carpenter - Manchild; Taylor Swift - Fortnight\nBest New Artist: Alex Warren; Lola Young"}
        placeholderTextColor={colors.textFaint} autoCorrect={false} />
      <View style={styles.actions}>
        <Button small title="Save categories" accessibilityLabel="Save the award categories" disabled={busy || !text.trim()} loading={pending === "live:categories"}
          onPress={() => act("live:categories", async () => { await setLiveCategories({ accountId, id: event.id, text }); setEditing(false); }, "Categories saved. Tap each winner as it is announced.")} />
        {editing ? <Button small title="Cancel" variant="secondary" accessibilityLabel="Stop editing categories" disabled={busy} onPress={() => setEditing(false)} /> : null}
      </View>
    </View>;
  }
  return <View style={styles.group}>
    <Text style={styles.label}>WINNERS · {event.winners.announced} OF {event.winners.total} ANNOUNCED</Text>
    {categories.map((category) => {
      const suggestion = suggestions.get(category.id);
      return <View key={category.id} style={styles.categoryBlock}>
        <Text selectable style={styles.headline}>{category.name}</Text>
        {category.winner ? <View style={styles.searchRow}>
          <Text selectable style={[styles.copy, styles.winnerText]}>Winner: {category.winner}</Text>
          <Button small title="Clear" variant="secondary" accessibilityLabel={`Clear the winner of ${category.name}`} disabled={busy}
            loading={pending === `live:winner:${category.id}`}
            onPress={() => act(`live:winner:${category.id}`, () => markLiveWinner({ accountId, id: event.id, categoryId: category.id, nominee: null }), "Winner cleared.")} />
        </View> : <>
          {suggestion ? <View style={styles.searchRow}>
            <Text selectable style={[styles.hint, styles.rowCopy]}>{suggestion.source} reports {suggestion.nominee} won.</Text>
            <Button small title="Confirm" accessibilityLabel={`Confirm ${suggestion.nominee} won ${category.name}`} disabled={busy}
              loading={pending === `live:winner:${category.id}`}
              onPress={() => act(`live:winner:${category.id}`, () => markLiveWinner({ accountId, id: event.id, categoryId: category.id, nominee: suggestion.nominee }), `${suggestion.nominee} marked as the winner.`)} />
          </View> : null}
          <View style={styles.nominees}>
            {category.nominees.map((name) => <Button key={name} small variant="secondary" title={name} accessibilityLabel={`${name} won ${category.name}`}
              disabled={busy} onPress={() => act(`live:winner:${category.id}`, () => markLiveWinner({ accountId, id: event.id, categoryId: category.id, nominee: name }), `${name} marked as the winner.`)} />)}
          </View>
        </>}
      </View>;
    })}
    <View style={styles.actions}>
      <Button small title="Edit categories" variant="secondary" accessibilityLabel="Edit the award categories" disabled={busy}
        onPress={() => { setText(categoriesText(event)); setEditing(true); }} />
    </View>
  </View>;
}

function LiveControls({ accountId, live, busy, pending, act }) {
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [hours, setHours] = useState("4");
  const [startsAt, setStartsAt] = useState("");
  const [update, setUpdate] = useState("");
  const [link, setLink] = useState("");
  const running = live.find((event) => event.live);
  const scheduled = live.filter((event) => event.scheduled);
  // A show that just ended stays editable, so winners can still be filled in
  // for the recap and its winners-list page.
  const recap = live.find((event) => !event.live && !event.scheduled);
  const managed = running || scheduled[0] || recap || null;
  const start = parseStartTime(startsAt);
  const header = <>
    <Text style={styles.label}>LIVE COVERAGE</Text>
    <Text selectable style={styles.hint}>For a big night like an award show. Readers see a LIVE card at the top of the news with every outlet headline matching your keywords, the winners as you mark them, and your updates. Its page, /news/live/..., is built for search. No Claude cost.</Text>
  </>;
  const startForm = <>
      <TextInput accessibilityLabel="Live coverage title" style={styles.input} value={title} onChangeText={setTitle}
        placeholder="2026 MTV VMAs" placeholderTextColor={colors.textFaint} maxLength={80} />
      <TextInput accessibilityLabel="Keywords the outlets will use, separated by commas" style={styles.input} value={keywords} onChangeText={setKeywords}
        placeholder="VMAs, Video Music Awards" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
      <TextInput accessibilityLabel="Start time, optional, like 2027-02-01 20:00 in your time zone" style={styles.input} value={startsAt} onChangeText={setStartsAt}
        placeholder="Starts: now, or 2027-02-01 20:00 (your time)" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
      {Number.isNaN(start) ? <Text style={styles.error}>Write the start as 2027-02-01 20:00, or leave it empty to start now.</Text> : null}
      <View style={styles.searchRow}>
        <TextInput accessibilityLabel="How many hours it runs" style={[styles.input, styles.hours]} value={hours} onChangeText={setHours}
          keyboardType="number-pad" maxLength={2} />
        <Text style={styles.hint}>hours</Text>
        <Button small title={start ? "Schedule live coverage" : "Start live coverage"} accessibilityLabel={start ? "Schedule live coverage" : "Start live coverage"}
          disabled={busy || title.trim().length < 3 || !keywords.trim() || Number.isNaN(start)} loading={pending === "live:start"}
          onPress={() => act("live:start", () => startLive({ accountId, title, keywords, hours, startsAt: start }),
            start ? "Scheduled. Paste the categories now; it goes public when it starts." : "Live coverage started. It is at the top of the news now.")} />
      </View>
  </>;
  if (!managed) return <View style={styles.group}>{header}{startForm}</View>;
  const notes = managed.items.filter((item) => item.kind === "note");
  const ended = !managed.live && !managed.scheduled;
  return <View style={styles.group}>
    {header}
    {ended ? startForm : null}
    <Text selectable style={styles.headline}>{ended ? `Recap: ${managed.title}` : managed.title}</Text>
    <Text selectable style={styles.hint}>{managed.scheduled
      ? `Scheduled: starts ${new Date(managed.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
      : newsLiveStatus(managed)}</Text>
    {managed.slug ? <Text selectable style={styles.hint}>Public page: {livePageUrl(managed.slug)}</Text> : null}
    <WinnersControls accountId={accountId} event={managed} busy={busy} pending={pending} act={act} />
    {managed.live ? <>
      <TextInput accessibilityLabel="Live update text" style={[styles.input, styles.links]} multiline value={update} onChangeText={setUpdate}
        placeholder="Snoop Dogg opens the show" placeholderTextColor={colors.textFaint} maxLength={280} />
      <TextInput accessibilityLabel="Optional link for the update" style={styles.input} value={link} onChangeText={setLink}
        placeholder="Optional https:// link" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
    </> : null}
    {ended ? null : <View style={styles.actions}>
      {managed.live ? <Button small title="Post update" accessibilityLabel="Post the live update" disabled={busy || !update.trim()} loading={pending === "live:note"}
        onPress={() => act("live:note", async () => { await postLiveUpdate({ accountId, id: managed.id, text: update, url: link }); setUpdate(""); setLink(""); }, "Update posted.")} /> : null}
      <Button small title={managed.live ? "End live coverage" : "Cancel this show"} variant="secondary"
        accessibilityLabel={managed.live ? `End live coverage of ${managed.title}` : `Cancel the scheduled coverage of ${managed.title}`} disabled={busy}
        loading={pending === "live:end"} onPress={() => act("live:end", () => endLive({ accountId, id: managed.id }),
          managed.live ? "Live coverage ended. You can still mark winners below; the page stays as the winners list." : "Scheduled coverage cancelled.")} />
    </View>}
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
  categories: { minHeight: 140, textAlignVertical: "top" },
  categoryBlock: { gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  nominees: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  winnerText: { color: colors.gold, fontWeight: "700", flexGrow: 1, flexShrink: 1 },
});
