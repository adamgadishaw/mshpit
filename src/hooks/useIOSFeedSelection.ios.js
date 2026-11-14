import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { load, save } from "../lib/persist";
import { feedFilterStorageKey, normalizeFeedFilter } from "../domain/feedExperience.mjs";
import { IOS_FEED_FILTERS } from "../domain/iosMenuSections.mjs";

// App and its drawer share this owner. It survives tab navigation, while an
// account handoff immediately replaces both its selected value and authority.
export default function useIOSFeedSelection(accountId = null) {
  const scope = feedFilterStorageKey(accountId);
  const generation = useMemo(() => ({ accountId }), [accountId]);
  const renderOwner = useRef(generation), live = useRef(null);
  renderOwner.current = generation;
  const [admission, setAdmission] = useState(null);
  const [state, setState] = useState(() => ({ scope, revision: 0, value: normalizeFeedFilter(load(scope, "everyone"), { loggedIn: !!accountId }) }));
  const filter = state.scope === scope ? state.value : normalizeFeedFilter(load(scope, "everyone"), { loggedIn: !!accountId });
  const selected = useRef({ scope, value: filter });
  selected.current = { scope, value: filter };
  useLayoutEffect(() => {
    const token = { generation };
    live.current = token; setAdmission(token);
    return () => { if (live.current === token) live.current = null; };
  }, [generation]);
  const select = value => {
    if (!accountId || renderOwner.current !== generation || !admission || live.current !== admission || admission.generation !== generation
      || !IOS_FEED_FILTERS.some(item => item.key === value)) return false;
    // A deliberate tap, including the selected tab, retires a queued drag.
    // The revision is shared by the header, drawer and retained Feed pager.
    const changed = selected.current.scope !== scope || selected.current.value !== value;
    selected.current = { scope, value };
    setState(previous => ({ scope, value, revision: (previous.scope === scope ? previous.revision : 0) + 1 }));
    if (changed) save(scope, value);
    return true;
  };
  return { accountId, filter, select, revision: state.scope === scope ? state.revision : 0 };
}
