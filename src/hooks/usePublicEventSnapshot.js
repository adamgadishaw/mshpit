import { useCallback, useEffect, useRef, useState } from "react";
import { publicEventSnapshotScope } from "../domain/publicEventSnapshot.mjs";
import { beginLoadState, isLoadCancellation, projectLoadState, rejectLoadState, resolveLoadState } from "../domain/loadState.mjs";
import { readPublicEventSnapshot } from "../features/showSocial/showSocialService";

export default function usePublicEventSnapshot({ eventId = null, accountId = null } = {}) {
  const scope = publicEventSnapshotScope(eventId, accountId);
  const [resource, setResource] = useState(null);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    const ticket = ++sequence.current;
    if (!eventId) {
      setResource(resolveLoadState({ scope, data: null }));
      return undefined;
    }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && sequence.current === ticket;
    setResource((previous) => beginLoadState(previous, { scope }));
    readPublicEventSnapshot({ eventId, accountId, signal: controller.signal })
      .then((data) => {
        if (current()) setResource(resolveLoadState({ scope, data }));
      })
      .catch((error) => {
        if (current() && !isLoadCancellation(error, controller.signal)) {
          setResource((previous) => rejectLoadState(previous, { scope, error }));
        }
      });
    return () => controller.abort();
  }, [eventId, accountId, revision, scope]);

  return {
    resource: projectLoadState(resource, scope),
    reload: useCallback(() => setRevision((current) => current + 1), []),
  };
}
