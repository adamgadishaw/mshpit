import { useCallback, useEffect, useRef, useState } from "react";

import {
  beginLoadState,
  createLoadState,
  isLoadCancellation,
  rejectLoadState,
  resolveLoadState,
} from "../../domain/loadState.mjs";
import {
  artistMemorialAdminScope,
  artistMemorialScope,
  EMPTY_ARTIST_MEMORIALS,
  mergeArtistMemorial,
  projectArtistMemorial,
  projectArtistMemorialAdmin,
} from "./artistMemorialState.mjs";
import {
  listArtistMemorials,
  readArtistMemorial,
  saveArtistMemorial,
} from "./services/artistMemorialApi.mjs";

export function useArtistMemorial({ accountId = null, artistKey = null, enabled = true } = {}) {
  const scope = artistMemorialScope({ accountId, artistKey });
  const [resource, setResource] = useState(() => createLoadState({ data: null }));
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    const ticket = ++sequence.current;
    if (!enabled || !artistKey) {
      setResource(resolveLoadState({ scope, data: null }));
      return undefined;
    }
    const controller = new AbortController();
    setResource((current) => beginLoadState(current, { scope, emptyData: null }));
    readArtistMemorial({ accountId, artistKey, signal: controller.signal })
      .then((memorial) => {
        if (controller.signal.aborted || sequence.current !== ticket) return;
        setResource((current) => current.scope === scope ? resolveLoadState({ scope, data: memorial }) : current);
      })
      .catch((error) => {
        if (isLoadCancellation(error, controller.signal) || sequence.current !== ticket) return;
        setResource((current) => current.scope === scope
          ? rejectLoadState(current, { scope, error, emptyData: null })
          : current);
      });
    return () => {
      if (sequence.current === ticket) sequence.current += 1;
      controller.abort();
    };
  }, [accountId, artistKey, enabled, revision, scope]);

  return {
    resource: projectArtistMemorial(resource, { accountId, artistKey }),
    reload: useCallback(() => setRevision((current) => current + 1), []),
  };
}

export function useArtistMemorialAdmin({ accountId = null, sessionScope = null, enabled = true } = {}) {
  const scope = artistMemorialAdminScope({ accountId, sessionScope });
  const [resource, setResource] = useState(() => createLoadState({ data: EMPTY_ARTIST_MEMORIALS }));
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState({ scope, saving: false, error: null });
  const scopeRef = useRef(scope);
  const sequence = useRef(0);
  const saveController = useRef(null);
  scopeRef.current = scope;

  useEffect(() => {
    saveController.current?.abort();
    saveController.current = null;
    setSaveState({ scope, saving: false, error: null });
    const ticket = ++sequence.current;
    if (!enabled || !accountId || !sessionScope) {
      setResource(resolveLoadState({ scope, data: EMPTY_ARTIST_MEMORIALS }));
      return undefined;
    }
    const controller = new AbortController();
    setResource((current) => beginLoadState(current, { scope, emptyData: EMPTY_ARTIST_MEMORIALS }));
    listArtistMemorials({ accountId, signal: controller.signal })
      .then((memorials) => {
        if (controller.signal.aborted || sequence.current !== ticket) return;
        setResource((current) => current.scope === scope ? resolveLoadState({ scope, data: memorials }) : current);
      })
      .catch((error) => {
        if (isLoadCancellation(error, controller.signal) || sequence.current !== ticket) return;
        setResource((current) => current.scope === scope
          ? rejectLoadState(current, { scope, error, emptyData: EMPTY_ARTIST_MEMORIALS })
          : current);
      });
    return () => controller.abort();
  }, [accountId, enabled, revision, scope, sessionScope]);

  useEffect(() => () => saveController.current?.abort(), []);

  const save = useCallback(async (input) => {
    if (!enabled || !accountId || !sessionScope || saveController.current) {
      throw new TypeError("Artist memorial saving is not available for this session.");
    }
    const initiatingScope = scope;
    const controller = new AbortController();
    saveController.current = controller;
    setSaveState({ scope: initiatingScope, saving: true, error: null });
    try {
      const saved = await saveArtistMemorial(input, { accountId, signal: controller.signal });
      if (controller.signal.aborted || scopeRef.current !== initiatingScope) return saved;
      setResource((current) => current.scope === initiatingScope
        ? resolveLoadState({ scope: initiatingScope, data: mergeArtistMemorial(current.data, saved) })
        : current);
      setSaveState({ scope: initiatingScope, saving: false, error: null });
      return saved;
    } catch (error) {
      if (!isLoadCancellation(error, controller.signal) && scopeRef.current === initiatingScope) {
        setSaveState({ scope: initiatingScope, saving: false, error });
      }
      throw error;
    } finally {
      if (saveController.current === controller) saveController.current = null;
    }
  }, [accountId, enabled, scope, sessionScope]);

  const projected = projectArtistMemorialAdmin(resource, { accountId, sessionScope });
  const currentSave = saveState.scope === scope ? saveState : { saving: false, error: null };
  return {
    resource: projected,
    memorials: projected.data || EMPTY_ARTIST_MEMORIALS,
    loading: projected.status === "loading" || projected.status === "refreshing",
    saving: currentSave.saving,
    error: currentSave.error || projected.error,
    reload: useCallback(() => setRevision((current) => current + 1), []),
    save,
  };
}
