import { useCallback, useEffect, useRef, useState } from 'react';
import { venueCommunityRequest } from './venueCommunityService';
import { beginLoadState, projectLoadState, rejectLoadState, resolveLoadState, isLoadCancellation } from '../../domain/loadState.mjs';
import { commandFailure, commandSuccess } from '../../domain/commandResult.mjs';

// Account + target bound, no persistent image/review/claim cache. Obsolete
// reads and writes cannot land after navigation or an account change.
export default function useVenueCommunity(url, accountId = null) {
  const scope = JSON.stringify([url, accountId]);
  const [resource, setResource] = useState(null);
  const [action, setAction] = useState(null);
  const latest = useRef(scope); latest.current = scope;
  const pendingRead = useRef(null), pendingWrite = useRef(null);
  const load = useCallback(async () => {
    pendingRead.current?.abort();
    if (!url) { setResource(resolveLoadState({ scope, data: null })); return; }
    const controller = new AbortController(); pendingRead.current = controller;
    const current = () => !controller.signal.aborted && latest.current === scope;
    setResource(old => beginLoadState(old, { scope, retainData: false }));
    try {
      const data = await venueCommunityRequest(url, { signal: controller.signal, expectedAccountId: accountId, silent: true, context: 'Loading venue community' });
      if (current()) setResource(resolveLoadState({ scope, data }));
    } catch (error) {
      if (current() && !isLoadCancellation(error)) setResource(old => rejectLoadState(old, { scope, error, retainData: false }));
    }
  }, [url, accountId, scope]);
  useEffect(() => { void load(); return () => { pendingRead.current?.abort(); pendingWrite.current?.abort(); }; }, [load]);
  const write = async (path, method, body) => {
    // architecture: allow-ambiguous-result -- null means a duplicate or cancelled lifecycle action; current failures always return CommandFailure and retain the draft.
    if (pendingWrite.current && !pendingWrite.current.signal.aborted) return null;
    const controller = new AbortController(); pendingWrite.current = controller;
    const current = () => !controller.signal.aborted && latest.current === scope;
    setAction({ scope, busy: true, error: null });
    try {
      const value = await venueCommunityRequest(path, { method, body, signal: controller.signal, expectedAccountId: accountId, silent: true, context: 'Saving venue community contribution' });
      if (!current()) return null;
      setAction({ scope, busy: false, error: null });
      await load();
      return current() ? commandSuccess(value) : null;
    } catch (error) {
      // architecture: allow-ambiguous-result -- cancellation belongs to the old account or target and must not report a failure in the new view.
      if (!current() || isLoadCancellation(error)) return null;
      setAction({ scope, busy: false, error });
      return commandFailure(error);
    } finally { if (pendingWrite.current === controller) pendingWrite.current = null; }
  };
  return { resource: projectLoadState(resource, scope), load, write,
    busy: action?.scope === scope && action.busy, error: action?.scope === scope ? action.error : null };
}
