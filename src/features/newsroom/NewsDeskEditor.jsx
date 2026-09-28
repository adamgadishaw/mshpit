import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import Button from "../../components/Button";
import { colors, radius } from "../../theme";
import { MAX_NEWS_LINKS, categoriesText, livePageUrl, newsCandidateLine, newsCandidateNeed, newsDraftStatus, newsEditorCostLine, newsLiveStatus,
  parseNewsLinks, parseStartTime } from "./newsDeskEditorApi.mjs";
import { chooseStoryPhoto, discardDraft, endLive, loadNewsEditor, markLiveWinner, postLiveUpdate, publishDraft, removeLiveUpdate, setLiveCategories, startLive, writeDraft } from "./newsDeskEditorService";

// The newsroom: write a story on demand, or run live coverage of a big night.
// Every input has a label that says what goes in it, a one-line example, and
// a short note on what it does. Inputs are one line unless they hold a list.

function Field({ label, help, children, error }) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
    {error ? <Text style={styles.error}>{error}</Text> : help ? <Text style={styles.help}>{help}</Text> : null}
  </View>;
}

function Choice({ options, value, onChange, label }) {
  return <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
    {options.map((option) => <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.choice, value === option.value && styles.choiceOn]}
      accessibilityRole="radio" accessibilityState={{ checked: value === option.value }} accessibilityLabel={option.a11y || option.label}>
      <Text style={[styles.choiceText, value === option.value && styles.choiceTextOn]}>{option.label}</Text>
    </Pressable>)}
  </View>;
}

// Award categories: paste them once, then tap each winner as it is announced.
function WinnersControls({ accountId, event, busy, pending, act }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const categories = event.winners?.categories || [];
  const suggestions = new Map((event.suggestions || []).map((item) => [item.categoryId, item]));
  if (!categories.length || editing) {
    return <View style={styles.card}>
      <Text style={styles.step}>AWARD CATEGORIES <Text style={styles.optional}>optional, for award shows</Text></Text>
      <Field label="Categories and nominees" help='One category per line: "Category: Nominee; Nominee; Nominee". This builds the winners table.'>
        <TextInput accessibilityLabel="Award categories and nominees" style={[styles.input, styles.multiline]} multiline value={text} onChangeText={setText}
          placeholder={"Video of the Year: Sabrina Carpenter; Taylor Swift\nBest New Artist: Alex Warren; Lola Young"}
          placeholderTextColor={colors.textFaint} autoCorrect={false} />
      </Field>
      <View style={styles.actions}>
        <Button small title="Save categories" accessibilityLabel="Save the award categories" disabled={busy || !text.trim()} loading={pending === "live:categories"}
          onPress={() => act("live:categories", async () => { await setLiveCategories({ accountId, id: event.id, text }); setEditing(false); }, "Categories saved. Tap each winner as it is announced.")} />
        {editing ? <Button small title="Cancel" variant="secondary" accessibilityLabel="Stop editing categories" disabled={busy} onPress={() => setEditing(false)} /> : null}
      </View>
    </View>;
  }
  return <View style={styles.card}>
    <Text style={styles.step}>WINNERS · {event.winners.announced} OF {event.winners.total} ANNOUNCED</Text>
    <Text style={styles.help}>Tap the winner in each category as it is announced. Outlet reports of a winner appear here to confirm.</Text>
    {categories.map((category) => {
      const suggestion = suggestions.get(category.id);
      return <View key={category.id} style={styles.categoryBlock}>
        <Text selectable style={styles.headline}>{category.name}</Text>
        {category.winner ? <View style={styles.row}>
          <Text selectable style={[styles.copy, styles.winnerText]}>Winner: {category.winner}</Text>
          <Button small title="Clear" variant="secondary" accessibilityLabel={`Clear the winner of ${category.name}`} disabled={busy}
            loading={pending === `live:winner:${category.id}`}
            onPress={() => act(`live:winner:${category.id}`, () => markLiveWinner({ accountId, id: event.id, categoryId: category.id, nominee: null }), "Winner cleared.")} />
        </View> : <>
          {suggestion ? <View style={styles.row}>
            <Text selectable style={[styles.help, styles.rowCopy]}>{suggestion.source} reports {suggestion.nominee} won.</Text>
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

const HOURS = ["2", "3", "4", "6"];

function LiveControls({ accountId, live, busy, pending, act }) {
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [hours, setHours] = useState("4");
  const [when, setWhen] = useState("now");
  const [startsAt, setStartsAt] = useState("");
  const [update, setUpdate] = useState("");
  const [link, setLink] = useState("");
  const running = live.find((event) => event.live);
  const scheduled = live.filter((event) => event.scheduled);
  // A show that just ended stays editable, so winners can still be filled in
  // for the recap and its winners-list page.
  const recap = live.find((event) => !event.live && !event.scheduled);
  const managed = running || scheduled[0] || recap || null;
  const start = when === "later" ? parseStartTime(startsAt) : null;
  const startInvalid = when === "later" && (!startsAt.trim() || Number.isNaN(start));
  const header = <View style={styles.sectionHead}>
    <Text accessibilityRole="header" style={styles.title}>Live coverage</Text>
    <Text selectable style={styles.copy}>For award shows and big nights. Readers get a LIVE card at the top of News with outlet headlines, your updates and the winners. No Claude cost.</Text>
  </View>;
  const startForm = <View style={styles.card}>
    <Text style={styles.step}>{managed ? "START ANOTHER" : "START LIVE COVERAGE"}</Text>
    <Field label="Event name" help="Shown as the page title and the LIVE card.">
      <TextInput accessibilityLabel="Event name" style={styles.input} value={title} onChangeText={setTitle}
        placeholder="2027 Grammy Awards" placeholderTextColor={colors.textFaint} maxLength={80} />
    </Field>
    <Field label="Headline keywords" help="Outlet headlines that mention any of these are added to the timeline. Separate with commas.">
      <TextInput accessibilityLabel="Headline keywords" style={styles.input} value={keywords} onChangeText={setKeywords}
        placeholder="Grammys, Grammy Awards" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
    </Field>
    <Field label="Starts" error={when === "later" && startsAt.trim() && Number.isNaN(start) ? "Write it as 2027-02-01 20:00." : null}
      help={when === "later" ? "Your local time. It goes public when it starts; add categories before then." : "Goes live on News right away."}>
      <Choice label="When coverage starts" value={when} onChange={setWhen}
        options={[{ value: "now", label: "Now", a11y: "Start now" }, { value: "later", label: "Later", a11y: "Start later" }]} />
      {when === "later" ? <TextInput accessibilityLabel="Start date and time" style={[styles.input, styles.short]} value={startsAt} onChangeText={setStartsAt}
        placeholder="2027-02-01 20:00" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} maxLength={16} /> : null}
    </Field>
    <Field label="Runs for" help="The LIVE card comes down after this. You can end it early.">
      <Choice label="How long coverage runs" value={hours} onChange={setHours}
        options={HOURS.map((value) => ({ value, label: `${value} hours`, a11y: `${value} hours` }))} />
    </Field>
    <View style={styles.actions}>
      <Button small title={when === "later" ? "Schedule live coverage" : "Start live coverage"} accessibilityLabel={when === "later" ? "Schedule live coverage" : "Start live coverage"}
        disabled={busy || title.trim().length < 3 || !keywords.trim() || startInvalid} loading={pending === "live:start"}
        onPress={() => act("live:start", async () => { await startLive({ accountId, title, keywords, hours, startsAt: start }); setTitle(""); setKeywords(""); setStartsAt(""); setWhen("now"); },
          start ? "Scheduled. Paste the categories now; it goes public when it starts." : "Live coverage started. It is at the top of the news now.")} />
    </View>
  </View>;
  if (!managed) return <View style={styles.section}>{header}{startForm}</View>;
  const notes = managed.items.filter((item) => item.kind === "note");
  const ended = !managed.live && !managed.scheduled;
  return <View style={styles.section}>
    {header}
    <View style={styles.card}>
      <Text style={styles.step}>{ended ? "RECAP" : managed.live ? "ON AIR" : "SCHEDULED"}</Text>
      <Text selectable style={styles.headline}>{ended ? `Recap: ${managed.title}` : managed.title}</Text>
      <Text selectable style={styles.help}>{managed.scheduled
        ? `Starts ${new Date(managed.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
        : newsLiveStatus(managed)}</Text>
      {managed.slug ? <Text selectable style={styles.help}>Public page: {livePageUrl(managed.slug)}</Text> : null}
      {managed.live ? <>
        <Field label="Post an update" help="One or two sentences, like a live blog. Up to 280 characters.">
          <TextInput accessibilityLabel="Live update text" style={[styles.input, styles.update]} multiline value={update} onChangeText={setUpdate}
            placeholder="Snoop Dogg opens the show" placeholderTextColor={colors.textFaint} maxLength={280} />
        </Field>
        <Field label="Link" help="Optional. A source or clip for this update.">
          <TextInput accessibilityLabel="Optional link for the update" style={styles.input} value={link} onChangeText={setLink}
            placeholder="https://" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} />
        </Field>
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
    </View>
    <WinnersControls accountId={accountId} event={managed} busy={busy} pending={pending} act={act} />
    {ended ? startForm : null}
  </View>;
}

// The photo on each story's share card: automatic (the first artist in the
// story with a photo), a specific artist from the story, or no photo.
function StoryPhotos({ accountId, stories, busy, pending, act }) {
  if (!stories.length) return null;
  return <View style={styles.section}>
    <View style={styles.sectionHead}>
      <Text accessibilityRole="header" style={styles.title}>Share card photos</Text>
      <Text selectable style={styles.copy}>The photo on each story's share card. Automatic uses the first artist in the story with a photo: their profile photo, or a licensed photo. Pick another artist from the story, or no photo for a clean headline card.</Text>
    </View>
    {stories.map((story) => {
      const choose = (choice, artistKey = null, label) => act(`photo:${story.postId}`,
        () => chooseStoryPhoto({ accountId, postId: story.postId, choice, artistKey }), label);
      const picked = story.photo?.choice || "auto";
      return <View key={story.postId} style={styles.card}>
        <View style={styles.storyRow}>
          {story.current ? <ExpoImage source={{ uri: story.current }} style={styles.storyThumb} contentFit="cover" accessible={false} />
            : <View style={[styles.storyThumb, styles.storyThumbEmpty]}><Text style={styles.help}>No photo</Text></View>}
          <Text selectable style={[styles.headline, styles.rowCopy]}>{story.headline}</Text>
        </View>
        <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={`Share card photo for ${story.headline}`}>
          <PhotoChoice label="Automatic" on={picked === "auto"} disabled={busy} onPress={() => choose("auto", null, "The card picks its photo automatically.")} />
          {story.options.map((option) => <PhotoChoice key={option.artistKey} label={option.name} uri={option.url}
            on={picked === "artist" && story.photo?.artistKey === option.artistKey} disabled={busy}
            onPress={() => choose("artist", option.artistKey, `The card now uses ${option.name}'s photo.`)} />)}
          <PhotoChoice label="No photo" on={picked === "none"} disabled={busy} onPress={() => choose("none", null, "The card is a clean headline card now.")} />
        </View>
        {!story.options.length ? <Text style={styles.help}>None of this story's artists has a photo we can use yet, so the card is a headline card.</Text> : null}
        {pending === `photo:${story.postId}` ? <Text style={styles.help}>Saving…</Text> : null}
      </View>;
    })}
  </View>;
}

function PhotoChoice({ label, uri = null, on, disabled, onPress }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.choice, styles.photoChoice, on && styles.choiceOn]}
    accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} accessibilityLabel={label}>
    {uri ? <ExpoImage source={{ uri }} style={styles.choiceThumb} contentFit="cover" accessible={false} /> : null}
    <Text style={[styles.choiceText, on && styles.choiceTextOn]} numberOfLines={1}>{label}</Text>
  </Pressable>;
}

const failure = (error, fallback) => (typeof error?.message === "string" && error.message.trim() ? error.message : fallback);

function Candidate({ candidate, busy, disabled, onWrite }) {
  return <View style={styles.row}>
    <View style={styles.rowCopy}>
      <Text selectable style={styles.headline}>{candidate.headline}</Text>
      <Text selectable style={styles.help}>{newsCandidateLine(candidate)}</Text>
      {!candidate.ready ? <Text selectable style={styles.help}>{newsCandidateNeed(candidate)}</Text> : null}
    </View>
    <Button small title="Write it" variant={candidate.ready ? "primary" : "secondary"}
      accessibilityLabel={`Write a draft about ${candidate.headline}`}
      disabled={disabled} loading={busy} onPress={() => onWrite(candidate)} />
  </View>;
}

function Draft({ draft, pending, disabled, onPublish, onDiscard }) {
  const open = draft.status === "draft" && !draft.expired;
  return <View style={styles.draft} testID={`news-draft-${draft.id}`}>
    <Text selectable style={draft.status === "declined" ? styles.error : styles.step}>{newsDraftStatus(draft).toUpperCase()}</Text>
    {draft.headline ? <Text selectable style={styles.draftHeadline}>{draft.headline}</Text> : null}
    {draft.summary ? <Text selectable style={styles.copy}>{draft.summary}</Text> : null}
    {draft.body ? <Text selectable style={styles.help}>{draft.body}</Text> : null}
    <Text selectable style={styles.help}>Sources: {draft.sources.map((source) => source.name).join(", ")} · cost ${draft.costUsd.toFixed(3)}</Text>
    {open || draft.status === "declined" ? <View style={styles.actions}>
      {open ? <Button small title="Publish now" accessibilityLabel={`Publish ${draft.headline}`}
        disabled={disabled} loading={pending === `publish:${draft.id}`} onPress={() => onPublish(draft)} /> : null}
      <Button small title="Discard" variant="secondary" accessibilityLabel={`Discard the draft ${draft.headline || ""}`.trim()}
        disabled={disabled} loading={pending === `discard:${draft.id}`} onPress={() => onDiscard(draft)} />
    </View> : null}
  </View>;
}

// Admins and editors (the news team) only.
export const canUseNewsroom = (role) => role === "admin" || role === "editor";

export default function NewsDeskEditor({ accountId, role, active = true }) {
  const allowed = canUseNewsroom(role) && !!accountId;
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
      if (ticket === request.current) setError(failure(reason, "The newsroom could not load. Try again in a moment."));
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
    {error ? <Text selectable accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text selectable accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}

    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={styles.title}>Write a story</Text>
        <Text selectable style={styles.copy}>When the feed feels stale. Pick a story the outlets are covering, search for one, or paste links. Claude writes a draft; you review it and publish. A story needs two independent outlets, three for deaths and legal news.</Text>
        {overview ? <Text selectable style={styles.help}>{newsEditorCostLine(overview)}</Text> : null}
        {overview && !overview.configured ? <Text selectable style={styles.error}>Add ANTHROPIC_API_KEY in Render to write drafts. Browsing and search still work.</Text> : null}
        {overview && overview.configured && !overview.publisherReady ? <Text selectable style={styles.error}>The news account needs review before anything can be published.</Text> : null}
      </View>

      {(overview?.drafts?.recent || []).length ? <View style={styles.card}>
        <Text style={styles.step}>YOUR DRAFTS</Text>
        {overview.drafts.recent.map((draft) => <Draft key={draft.id} draft={draft} pending={pending} disabled={busy}
          onPublish={publish} onDiscard={discard} />)}
      </View> : null}

      <View style={styles.card}>
        <Text style={styles.step}>1. PICK A STORY BEING COVERED NOW</Text>
        {!overview ? <Text style={styles.help}>{pending === "load" ? "Loading stories…" : "Stories are not loaded."}</Text>
          : overview.candidates.length ? overview.candidates.map((candidate) => <Candidate key={candidate.reportUrls.join(" ")} candidate={candidate}
            busy={writing === `write:${candidate.headline}`} disabled={disabled} onWrite={write} />)
            : <Text style={styles.help}>No outlet stories from the last two days are waiting. Search or paste links below.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.step}>2. OR SEARCH THIS WEEK'S COVERAGE</Text>
        <Field label="Search" help="An artist, festival or topic the outlets wrote about in the last week.">
          <View style={styles.searchRow}>
            <TextInput accessibilityRole="search" accessibilityLabel="Search the week's outlet coverage" style={[styles.input, styles.grow]}
              value={query} onChangeText={setQuery} placeholder="Radiohead tour" placeholderTextColor={colors.textFaint}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => query.trim() && load(query)} />
            <Button small title="Search" variant="secondary" accessibilityLabel="Search coverage" disabled={busy || query.trim().length < 2}
              loading={pending === "search"} onPress={() => load(query)} />
          </View>
        </Field>
        {overview?.query ? (overview.matches?.length ? overview.matches.map((candidate) => <Candidate key={`match ${candidate.reportUrls.join(" ")}`}
          candidate={candidate} busy={writing === `write:${candidate.headline}`} disabled={disabled} onWrite={write} />)
          : <Text selectable style={styles.help}>None of the outlets covered "{overview.query}" in the last week. Paste links if you have them.</Text>) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.step}>3. OR PASTE ARTICLE LINKS</Text>
        <Field label="Article links" help={`Up to ${MAX_NEWS_LINKS}, one per line, from the outlets the desk reads. They are added to the story you write next, or written up on their own.`}>
          <TextInput accessibilityLabel="Article links to include in the draft" style={[styles.input, styles.multiline]} multiline
            value={links} onChangeText={setLinks} placeholder="https://pitchfork.com/news/..." placeholderTextColor={colors.textFaint}
            autoCapitalize="none" autoCorrect={false} />
        </Field>
        <View style={styles.actions}>
          <Button small title="Write from links" variant="secondary" accessibilityLabel="Write a draft from the pasted links"
            disabled={disabled || !pasted.length} loading={writing === "write:links"} onPress={() => write(null)} />
        </View>
      </View>
    </View>

    {overview ? <LiveControls accountId={accountId} live={Array.isArray(overview.live) ? overview.live : []} busy={busy} pending={pending} act={act} /> : null}

    {overview ? <StoryPhotos accountId={accountId} stories={Array.isArray(overview.stories) ? overview.stories : []} busy={busy} pending={pending} act={act} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  editor: { gap: 22, paddingTop: 6 },
  section: { gap: 12 },
  sectionHead: { gap: 6 },
  title: { color: colors.text, fontSize: 18, fontWeight: "900" },
  copy: { color: colors.textDim, fontSize: 13, lineHeight: 20, flexShrink: 1 },
  help: { color: colors.textFaint, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  notice: { color: colors.good, fontSize: 13, lineHeight: 20 },
  step: { color: colors.amber, fontSize: 11, lineHeight: 16, fontWeight: "900", letterSpacing: 1 },
  optional: { color: colors.textFaint, fontWeight: "600", letterSpacing: 0 },
  card: { gap: 12, padding: 14, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface },
  field: { gap: 6 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "800" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  rowCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 260, minWidth: 0, gap: 3 },
  headline: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  draft: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  draftHeadline: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: "800" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  searchRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  // One-line inputs: sized by their content, never by a flex basis (in a
  // column a flex basis becomes the height).
  input: { color: colors.text, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, maxWidth: 560 },
  grow: { flexGrow: 1, flexBasis: 200, minWidth: 0 },
  short: { maxWidth: 200 },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  update: { minHeight: 60, textAlignVertical: "top" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 6 },
  choiceOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  choiceText: { color: colors.textDim, fontSize: 13, fontWeight: "800" },
  choiceTextOn: { color: colors.bg },
  storyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  storyThumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.bgElev },
  storyThumbEmpty: { alignItems: "center", justifyContent: "center" },
  photoChoice: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 220 },
  choiceThumb: { width: 22, height: 22, borderRadius: 11 },
  categoryBlock: { gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft },
  nominees: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  winnerText: { color: colors.gold, fontWeight: "700", flexGrow: 1, flexShrink: 1 },
});
