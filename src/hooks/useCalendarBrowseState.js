import { useLayoutEffect, useRef, useState } from "react";
import { calendarBrowseSnapshot, createCalendarBrowseMemory, createCalendarScrollReturn } from "../domain/calendarBrowseMemory.mjs";

export default function useCalendarBrowseState({ memory, occurrence, accountId = null, authEpoch,
  initialState, isCurrentRoute, restoreReady = true }) {
  const local = useRef(null);
  if (!local.current) local.current = { memory: createCalendarBrowseMemory(), occurrence: {} };
  const ownerMemory = memory || local.current.memory;
  if (!memory) ownerMemory.account(accountId, authEpoch);
  const frame = occurrence || local.current.occurrence;
  const ref = useRef(null);
  const [, redraw] = useState(0);
  const scrollRef = useRef(null);
  if (!ref.current || ref.current.memory !== ownerMemory || ref.current.frame !== frame
    || ref.current.accountId !== accountId || ref.current.authEpoch !== authEpoch) {
    if (ref.current) ref.current.admission.mounted = false;
    const lease = ownerMemory.claim(frame, { accountId, authEpoch }, initialState);
    const owner = { memory: ownerMemory, frame, accountId, authEpoch, lease,
      state: lease?.read() || calendarBrowseSnapshot(initialState), isCurrentRoute };
    const ownsRoute = () => ref.current === owner && !!lease?.current()
      && (!owner.isCurrentRoute || owner.isCurrentRoute());
    owner.newAdmission = () => {
      const admission = { mounted: false };
      admission.current = () => owner.admission === admission && admission.mounted && ownsRoute();
      return admission;
    };
    owner.admission = owner.newAdmission();
    const current = () => owner.admission.current();
    owner.scroll = createCalendarScrollReturn(owner.state.scrollY, patch => {
      const next = lease?.save(patch);
      if (next) owner.state = next; // Native scroll events do not rerender the calendar.
    }, current);
    ref.current = owner;
  }
  const owner = ref.current;
  owner.isCurrentRoute = isCurrentRoute;
  const current = owner.admission.current;
  useLayoutEffect(() => {
    const admission = owner.newAdmission();
    admission.mounted = true;
    owner.admission = admission;
    // Publish fresh native handlers after first commit and every reconnect.
    // An old queued onPress must not acquire the new layout lifetime.
    redraw(value => value + 1);
    return () => { admission.mounted = false; };
  }, [owner]);
  useLayoutEffect(() => {
    owner.scroll.update(scrollRef.current, restoreReady);
  });
  const update = patch => {
    if (!current()) return false;
    const next = owner.lease.save(typeof patch === "function" ? patch(owner.state) : patch);
    if (!next) return false;
    owner.scroll.cancel(); // A fresh date/filter choice takes precedence over restoring.
    owner.state = next;
    redraw(value => value + 1);
    return true;
  };
  return {
    state: owner.state, restored: !!owner.lease?.restored, update, scrollRef,
    onScroll: event => { if (current()) owner.scroll.onScroll(event); },
    onLayout: event => { if (current()) owner.scroll.onLayout(event); },
    onContentSizeChange: (width, height) => { if (current()) owner.scroll.onContentSizeChange(width, height); },
    onScrollBeginDrag: event => { if (current()) owner.scroll.onScrollBeginDrag(event); },
    // Both synchronous controls and delayed work retain render-time authority.
    isCurrent: current,
    capture: () => current,
  };
}
