import { useLayoutEffect, useRef, useState } from "react";

// A presentation may start commands only while mounted on its Root route.
// This does not own delivery: an accepted send/retry must still settle its
// original draft lease after navigation, hiding or a newer edit.
export default function useIOSThreadControls({ accountId, authEpoch, otherId, draftLease, isCurrentRoute }) {
  const ref = useRef(null);
  const [, redraw] = useState(0);
  const key = JSON.stringify([accountId || null, authEpoch, otherId]);
  if (!ref.current || ref.current.key !== key || ref.current.draftLease !== draftLease
    || (ref.current.isCurrentRoute && !ref.current.isCurrentRoute())) {
    ref.current = { key, draftLease, isCurrentRoute, presentation: { active: false, retired: false } };
  }
  const owner = ref.current;
  const presentation = owner.presentation;
  useLayoutEffect(() => {
    // StrictMode and Suspense reconnect the component without a fresh render
    // closure. Give new controls a new presentation; never revive old ones.
    if (owner.presentation.retired) {
      owner.presentation = { active: true, retired: false };
      redraw(value => value + 1);
    } else owner.presentation.active = true;
    const mounted = owner.presentation;
    return () => { mounted.active = false; mounted.retired = true; };
  }, [owner]);
  return () => !!accountId && !!otherId && ref.current === owner
    && owner.presentation === presentation && presentation.active
    && (!isCurrentRoute || isCurrentRoute());
}
