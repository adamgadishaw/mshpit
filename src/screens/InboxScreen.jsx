import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useStore } from "../store";
import useLiveChat from "../lib/useLiveChat";
import { unifiedSearchRequestOptions } from "../domain/unifiedSearch.mjs";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";
import useScopedRefresh from "../hooks/useScopedRefresh";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import { createIOSInboxLoad } from "../domain/iosInboxLoad.mjs";
import { filterInboxConversations } from "../domain/inboxPresentation.mjs";
import InboxPresentation from "../components/InboxPresentation";

const EMPTY_PEOPLE_SEARCH = Object.freeze({ status: "idle", rows: [], error: "" });

export default function InboxScreen({ onClose, onOpenThread }) {
  const { mainThreads, requestThreads, searchPeople, loadInboxThreads, session, chatAuthEpoch } = useStore();
  const [tab, setTab] = useState("main");
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState("");
  const inboxSearchScope = accountTargetScope(session?.id, `inbox-search:${chatAuthEpoch}`);
  const [inboxSearchState, setInboxSearchState] = useState({ scope: inboxSearchScope, value: "" });
  const inboxQuery = scopedScreenValue(inboxSearchState, inboxSearchScope, "");
  const setInboxQuery = value => setInboxSearchState({ scope: inboxSearchScope, value });
  const [searchRevision, setSearchRevision] = useState(0);
  const normalizedQuery = query.trim();
  const peopleScope = accountTargetScope(session?.id, `inbox-people:${chatAuthEpoch}:${composing ? normalizedQuery.toLowerCase() : "closed"}`);
  const peopleScopeRef = useRef(peopleScope);
  peopleScopeRef.current = peopleScope;
  const [peopleSearchState, setPeopleSearchState] = useState(() => ({ scope: peopleScope, value: EMPTY_PEOPLE_SEARCH }));
  const peopleSearch = scopedScreenValue(peopleSearchState, peopleScope, EMPTY_PEOPLE_SEARCH);
  const people = peopleSearch.rows;
  const main = session ? mainThreads() : [];
  const requests = session ? requestThreads() : [];
  const threads = filterInboxConversations(tab === "requests" ? requests : main, inboxQuery);
  const isIOS = Platform.OS === "ios";
  const inboxRefreshScope = refreshScope(session?.id, "inbox", chatAuthEpoch);
  const navigationOwner = useMemo(() => ({ alive: true }), [inboxRefreshScope]);
  const navigationOwnerRef = useRef(navigationOwner);
  navigationOwnerRef.current = navigationOwner;
  useLayoutEffect(() => {
    navigationOwner.alive = true;
    return () => { navigationOwner.alive = false; };
  }, [navigationOwner]);
  const ownsNavigation = () => navigationOwnerRef.current === navigationOwner && navigationOwner.alive;
  const openThread = id => { if (ownsNavigation()) onOpenThread?.(id); };
  const inboxScopeRef = useRef(inboxRefreshScope);
  inboxScopeRef.current = inboxRefreshScope;
  const [inboxLoad, setInboxLoad] = useState(null);
  const inboxStatus = inboxLoad?.scope === inboxRefreshScope ? inboxLoad.status : "loading";
  const inboxLoader = useMemo(() => createIOSInboxLoad((status) => {
    if (inboxScopeRef.current === inboxRefreshScope) setInboxLoad({ scope: inboxRefreshScope, status });
  }), [inboxRefreshScope]);
  useEffect(() => () => inboxLoader.cancel(), [inboxLoader]);

  useLiveChat(
    ({ signal }) => isIOS
      ? inboxLoader.run({ signal, load: loadInboxThreads })
      : loadInboxThreads({ signal }),
    { channelKey: `inbox:${chatAuthEpoch}:${session?.id || "guest"}`, enabled: !!session, intervalMs: 8000 },
  );
  const { refresh: refreshInbox, refreshing: inboxRefreshing } = useScopedRefresh({
    scope: inboxRefreshScope,
    enabled: !!session,
    task: ({ signal }) => isIOS
      ? inboxLoader.run({ signal, load: loadInboxThreads, interactive: true })
      : loadInboxThreads({ signal, strict: true }),
  });

  useEffect(() => {
    const controller = new AbortController();
    const requestScope = peopleScope;
    if (!composing || !normalizedQuery) {
      setPeopleSearchState({ scope: requestScope, value: EMPTY_PEOPLE_SEARCH });
      return () => controller.abort();
    }
    setPeopleSearchState({ scope: requestScope, value: { status: "loading", rows: [], error: "" } });
    const timer = setTimeout(async () => {
      try {
        const found = await searchPeople(normalizedQuery, unifiedSearchRequestOptions(controller));
        if (controller.signal.aborted || peopleScopeRef.current !== requestScope) return;
        setPeopleSearchState({
          scope: requestScope,
          value: { status: "ready", rows: (found || []).filter((person) => person.id !== session?.id).slice(0, 12), error: "" },
        });
      } catch (error) {
        if (!controller.signal.aborted && error?.name !== "AbortError" && peopleScopeRef.current === requestScope) {
          setPeopleSearchState({ scope: requestScope, value: { status: "error", rows: [], error: "People search could not update. Check your connection and try again." } });
        }
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
    // searchPeople is a store action whose identity changes with store state;
    // the account/chat epoch/query scope is the durable request owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing, normalizedQuery, peopleScope, searchRevision, session?.id]);

  const closeComposer = () => { setComposing(false); setQuery(""); };
  const openPerson = (person) => {
    if (!ownsNavigation() || peopleScopeRef.current !== peopleScope) return;
    closeComposer(); openThread(person.id);
  };

  useEffect(() => { closeComposer(); setTab("main"); }, [session?.id, chatAuthEpoch]);

  return <InboxPresentation
    session={session} composing={composing} query={query} setQuery={setQuery}
    inboxQuery={inboxQuery} setInboxQuery={setInboxQuery}
    peopleSearch={peopleSearch} people={people} retryPeople={() => setSearchRevision(value => value + 1)}
    tab={tab} setTab={setTab} requests={requests} threads={threads}
    inboxStatus={isIOS ? inboxStatus : "ready"} inboxRefreshing={inboxRefreshing} refreshInbox={refreshInbox}
    onClose={composing ? closeComposer : onClose} onCompose={() => setComposing(true)} closeComposer={closeComposer}
    onOpenThread={openThread} openPerson={openPerson}
  />;
}
