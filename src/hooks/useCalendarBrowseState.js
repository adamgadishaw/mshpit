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
    if (ref.current) ref.current.active = false;
    const lease = ownerMemory.claim(frame, { accountId, authEpoch }, initialState);
    const owner = { memory: ownerMemory, frame, accountId, authEpoch, lease,
      state: lease?.read() || calendarBrowseSnapshot(initialState), active: false, lifetime: null, isCurrentRoute };
    const current = () => ref.current === owner && owner.active && !!lease?.current()
      && (!owner.isCurrentRoute || owner.isCurrentRoute());
    owner.current = current;
    owner.scroll = createCalendarScrollReturn(owner.state.scrollY, patch => {
      const next = lease?.save(patch);
      if (next) owner.state = next; // Native scroll events do not rerender the calendar.
    }, current);
    ref.current = owner;
  }
  const owner = ref.current;
  owner.isCurrentRoute = isCurrentRoute;
  useLayoutEffect(() => {
    owner.active = true;
    owner.lifetime = {};
    return () => { owner.active = false; owner.lifetime = null; };
  }, [owner]);
  useLayoutEffect(() => {
    owner.scroll.update(scrollRef.current, restoreReady);
  });
  const update = patch => {
    if (!owner.current()) return false;
    const next = owner.lease.save(typeof patch === "function" ? patch(owner.state) : patch);
    if (!next) return false;
    owner.scroll.cancel(); // A fresh date/filter choice takes precedence over restoring.
    owner.state = next;
    redraw(value => value + 1);
    return true;
  };
  return {
    state: owner.state, restored: !!owner.lease?.restored, update, scrollRef,
    onScroll: owner.scroll.onScroll,
    onLayout: owner.scroll.onLayout,
    onContentSizeChange: owner.scroll.onContentSizeChange,
    onScrollBeginDrag: event => owner.scroll.onScrollBeginDrag(event),
    // Synchronous controls may ask current admission; delayed native callbacks
    // and async work must capture a lifetime before starting the operation.
    isCurrent: owner.current,
    capture() {
      const lifetime = owner.lifetime;
      return () => lifetime != null && owner.lifetime === lifetime && owner.current();
    },
  };
}
