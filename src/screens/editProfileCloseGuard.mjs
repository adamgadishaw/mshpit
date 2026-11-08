// Private to one editor. No persistence, navigation stack, or profile writes.
export function createEditProfileCloseGuard({ accountId, draft, alert }) {
  const baseline = JSON.stringify(draft);
  let current = { accountId, draft, busy: false, dismissPicker: null };
  let active = true, dispatching = false, generation = 0, pending = null, busyNotice = null, bypass = false;
  const work = new Set();
  const invalidate = () => { generation++; pending = null; busyNotice = null; };
  const busy = () => work.size > 0 || current.busy;
  const dispatch = (action) => {
    invalidate();
    dispatching = true;
    try { action(); } finally { dispatching = false; }
  };
  const showBusy = () => {
    if (busyNotice) return;
    const token = { generation };
    busyNotice = token;
    const dismiss = () => {
      if (active && generation === token.generation && busyNotice === token) busyNotice = null;
    };
    alert("Profile update in progress", "Wait for your photo or profile update to finish before leaving.",
      [{ text: "OK", onPress: dismiss }], { cancelable: true, onDismiss: dismiss });
  };
  const guard = ({ proceed = () => {}, cancel = () => {} } = {}) => {
    if (!active) { cancel(); return; }
    if (bypass) { bypass = false; proceed(); return; }
    if (dispatching) { cancel(); return; }
    if (busy()) { cancel(); if (!pending) showBusy(); return; }
    if (busyNotice) { cancel(); return; }
    if (current.dismissPicker) { current.dismissPicker(); cancel(); return; }
    if (pending) { cancel(); return; }
    if (JSON.stringify(current.draft) === baseline) { dispatch(proceed); return; }
    const token = { generation };
    pending = token;
    const finish = (discard) => {
      if (!active || dispatching || pending !== token || generation !== token.generation) return;
      pending = null;
      if (!discard) { cancel(); return; }
      if (busy()) { cancel(); showBusy(); return; }
      dispatch(proceed);
    };
    alert("Discard profile changes?", "Your profile edits have not been saved.", [
      { text: "Keep editing", style: "cancel", onPress: () => finish(false) },
      { text: "Discard", style: "destructive", onPress: () => finish(true) },
    ], { cancelable: true, onDismiss: () => finish(false) });
  };
  const bypassClose = (onClose) => {
    // Root's synchronous back consumes this once. Never leave a spare bypass.
    invalidate();
    bypass = true;
    try { onClose?.(); } finally { bypass = false; }
  };
  return {
    guard,
    update(next) { if (next.accountId !== current.accountId) { invalidate(); work.clear(); } current = next; },
    mount() { active = true; },
    dispose() { active = false; invalidate(); },
    close(onClose) { guard({ proceed: () => bypassClose(onClose) }); },
    saved(onClose) { if (active && !dispatching) bypassClose(onClose); },
    async runBusy(action) {
      const token = {};
      work.add(token);
      try { return await action(); } finally { work.delete(token); }
    },
  };
}
