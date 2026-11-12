// One review lifetime owns both picker/upload and posting. Never retries a send.
export function createVenueReviewIOSController({ accountId, venueName, alert }) {
  let active = true, expired = false, work = null, pending = null, bypass = false, dispatching = false, published = false;
  let draft = { rating: 0, text: "", photos: [], photosPublic: false };
  const current = () => active && !expired;
  const dispatch = (onClose) => {
    if (!current() || dispatching) return;
    pending = null;
    dispatching = true;
    bypass = true;
    try { onClose?.(); } catch {
      // Navigation failure must not turn a confirmed publication into a retry.
    } finally { bypass = false; dispatching = false; }
  };
  const guard = ({ proceed = () => {}, cancel = () => {} } = {}) => {
    if (bypass) { bypass = false; proceed(); return; }
    if (!current() || dispatching) { cancel(); return; }
    if (work) {
      cancel();
      if (!pending) {
        const token = {}; pending = token;
        const dismiss = () => { if (pending === token) pending = null; };
        alert("Review in progress", "Wait for your photo or review to finish before leaving.", [{ text: "OK", onPress: dismiss }], { cancelable: true, onDismiss: dismiss });
      }
      return;
    }
    if (pending) { cancel(); return; }
    if (published || (!draft.rating && !draft.text && !draft.photos.length && !draft.photosPublic)) { dispatch(proceed); return; }
    const token = {}; pending = token;
    const finish = (discard) => {
      if (!current() || pending !== token) return;
      pending = null;
      if (!discard || work) { cancel(); return; }
      dispatch(proceed);
    };
    alert("Discard venue review?", "Your rating, review and photo choices have not been posted.", [
      { text: "Keep editing", style: "cancel", onPress: () => finish(false) },
      { text: "Discard", style: "destructive", onPress: () => finish(true) },
    ], { cancelable: true, onDismiss: () => finish(false) });
  };
  return {
    guard,
    update(owner, next) {
      if (owner.accountId !== accountId || owner.venueName !== venueName) { expired = true; pending = null; work?.controller.abort(); }
      draft = next;
    },
    edit(patch) { if (!current() || published || work || pending) return false; draft = { ...draft, ...patch }; return true; },
    mount() { active = true; },
    dispose() { active = false; pending = null; work?.controller.abort(); work = null; },
    begin(accountTasks, expectedAccountId) {
      if (!current() || published || work || pending) return null;
      const task = accountTasks.begin(expectedAccountId);
      if (!task) return null;
      work = task;
      return { ...task,
        isCurrent: () => current() && work === task && task.isCurrent(),
        finish() { task.finish(); if (work === task) work = null; },
      };
    },
    close(onClose) { guard({ proceed: () => { bypass = true; try { onClose?.(); } finally { bypass = false; } } }); },
    saved(onClose) { if (!current() || published) return; published = true; dispatch(onClose); },
  };
}
