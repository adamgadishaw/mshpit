import { useLayoutEffect, useRef, useState } from "react";

// Admission only. The screen still owns its draft and account-scoped tasks.
export function useIOSProfileEditor({ accountId, authEpoch, picker, isCurrentRoute }) {
  const ref = useRef(null);
  const [, redraw] = useState(0);
  const key = JSON.stringify([accountId || null, authEpoch]);
  if (!ref.current || ref.current.key !== key) {
    if (ref.current) ref.current.retired = true;
    ref.current = { key, live: false, retired: false, work: null, sent: false, close: null, render: null, edited: false };
  }
  const owner = ref.current, render = {};
  const owned = () => ref.current === owner && !owner.retired && (!isCurrentRoute || isCurrentRoute());
  const current = () => owned() && owner.live && owner.render === render;
  const editable = () => current() && !owner.work;
  const closeConfirmed = () => {
    if (!owned() || !owner.live || !owner.close) return;
    const close = owner.close;
    owner.close = null;
    // A navigation failure must not turn a confirmed update into another write.
    try { close(); } catch { /* The confirmed editor can still be closed manually. */ }
  };
  useLayoutEffect(() => {
    owner.live = true;
    // Reveal/StrictMode must publish fresh callbacks, never revive hidden ones.
    redraw(value => value + 1);
    return () => { owner.live = false; owner.render = null; };
  }, [owner]);
  useLayoutEffect(() => {
    owner.render = render;
    owner.edited = false;
    closeConfirmed();
  });
  return {
    locked: !!owner.work,
    confirmed: owner.sent,
    edit: action => (...args) => {
      if (!editable()) return;
      owner.edited = true;
      owner.sent = false;
      // Even an unchanged/normalized value must commit and release edit admission.
      redraw(value => value + 1);
      return action(...args);
    },
    async run(action, { media = false } = {}) {
      if (!editable() || owner.edited || picker || (owner.sent && !media)) return;
      owner.sent = false;
      const command = {};
      owner.work = command;
      redraw(value => value + 1);
      const isCurrent = () => owned() && owner.work === command;
      try {
        return await action({
          isCurrent,
          confirm(close) {
            if (!isCurrent() || owner.sent) return;
            owner.sent = true;
            owner.close = close;
            closeConfirmed();
          },
        });
      } finally {
        if (owner.work === command) {
          owner.work = null;
          if (owned()) redraw(value => value + 1);
        }
      }
    },
  };
}
