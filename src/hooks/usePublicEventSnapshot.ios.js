import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { publicEventSnapshotScope } from "../domain/publicEventSnapshot.mjs";
import { beginLoadState, isLoadCancellation, projectLoadState, rejectLoadState, resolveLoadState } from "../domain/loadState.mjs";
import { readPublicEventSnapshot } from "../features/showSocial/showSocialService";
import useIOSDetailPresentation from "./useIOSDetailPresentation";

export default function usePublicEventSnapshot({ eventId = null, accountId = null } = {}) {
  const presentation = useIOSDetailPresentation();
  const scope = publicEventSnapshotScope(eventId, accountId);
  const [resource, setResource] = useState(null);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const settledRead = useRef(null);

  useLayoutEffect(() => {
    const ticket = ++sequence.current;
    if (!presentation.current()) return undefined;
    const readKey = JSON.stringify([scope, revision]);
    // A settled identity decision is part of the retained Show. Refreshing it
    // merely for Back would temporarily reapply an old route's pending flag.
    if (settledRead.current === readKey) return undefined;
    if (!eventId) {
      setResource(resolveLoadState({ scope, data: null }));
      return undefined;
    }
    const controller = new AbortController();
    const current = () => presentation.current() && !controller.signal.aborted && sequence.current === ticket;
    setResource((previous) => beginLoadState(previous, { scope }));
    readPublicEventSnapshot({ eventId, accountId, signal: controller.signal })
      .then((data) => {
        if (current()) {
          settledRead.current = readKey;
          setResource(resolveLoadState({ scope, data }));
        }
      })
      .catch((error) => {
        if (current() && !isLoadCancellation(error, controller.signal)) {
          setResource((previous) => rejectLoadState(previous, { scope, error }));
        }
      });
    return () => controller.abort();
  }, [eventId, accountId, revision, scope, presentation.token, presentation.active]);

  return {
    resource: projectLoadState(resource, scope),
    reload: useCallback(() => { if ((presentation.canAct || presentation.current)()) setRevision((current) => current + 1); }, [presentation]),
  };
}
