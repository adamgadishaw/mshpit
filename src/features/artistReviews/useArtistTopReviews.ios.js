import useIOSDetailPresentation from "../../hooks/useIOSDetailPresentation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginLoadState,
  createLoadState,
  isLoadCancellation,
  rejectLoadState,
  resolveLoadState,
} from "../../domain/loadState.mjs";
import {
  artistReviewsIdentity,
  artistReviewsScope,
  EMPTY_ARTIST_REVIEWS,
  projectArtistReviewsResource,
} from "./artistReviewsState.mjs";
import { invalidateIOSDetailPrivacy } from "../../lib/iosDetailPrivacy.ios.js";
import { artistPageAccessDenied } from "../../domain/artistPageRead.mjs";
import { readArtistTopReviews } from "./services/artistReviewsApi.mjs";

const reviewAccessWithdrawn = (error) => artistPageAccessDenied(error) || [404, 410].includes(Number(error?.status));

// Screen-local public review resource. Privacy/block projection makes the data
// viewer-dependent, so its complete key is accountId + artist identity. There
// is no persistence or stale TTL: one bounded (10-row maximum) snapshot is kept
// for this hook instance, same-scope refresh may retain it, and a scope change
// projects empty synchronously. Only one request is current; replacement and
// unmount abort it, and no cross-screen in-flight work is deduplicated.
export function useArtistTopReviews({ accountId = null, name = null, artistKey = null, limit = 3, presentation = null } = {}) {
  const inherited = useIOSDetailPresentation();
  const { active, current, guard, token, privacyScope = null, privacyCurrent = () => true } = presentation || inherited;
  const scope = artistReviewsScope({ accountId, name, artistKey });
  const identity = artistReviewsIdentity({ name, artistKey });
  const [resource, setResource] = useState(() => createLoadState({ data: EMPTY_ARTIST_REVIEWS }));
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);
  const settledRead = useRef(null);
  const receiptPrivacy = useRef(privacyScope);
  const withdrawnReceipt = useRef(false);
  const currentPrivacy = useRef(privacyScope);
  currentPrivacy.current = privacyScope;

  useEffect(() => {
    if (!active || !current()) return undefined;
    const readKey = JSON.stringify([scope, revision, limit]);
    if (settledRead.current === readKey && resource.scope === scope && (resource.updatedAt != null || reviewAccessWithdrawn(resource.error))) return undefined;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;

    if (!identity) {
      setResource(resolveLoadState({ scope, data: EMPTY_ARTIST_REVIEWS }));
      return undefined;
    }

    const controller = new AbortController();
    setResource((current) => beginLoadState(current, {
      scope,
      emptyData: EMPTY_ARTIST_REVIEWS,
    }));

    readArtistTopReviews({ accountId, name, artistKey, limit, signal: controller.signal })
      .then((reviews) => {
        if (!current() || controller.signal.aborted || requestSequence.current !== sequence) return;
        // Successful viewer-dependent data cannot refill a withdrawn snapshot.
        // Denials below still settle under lifecycle ownership.
        const permitted = privacyCurrent();
        settledRead.current = readKey;
        receiptPrivacy.current = privacyScope;
        withdrawnReceipt.current = !permitted;
        setResource((current) => current.scope === scope
          ? resolveLoadState({ scope, data: permitted ? reviews : EMPTY_ARTIST_REVIEWS })
          : current);
      })
      .catch((error) => {
        if (!current() || isLoadCancellation(error, controller.signal) || requestSequence.current !== sequence) return;
        const denied = reviewAccessWithdrawn(error);
        if (denied) {
          if ([403, 404, 410].includes(Number(error?.status))) invalidateIOSDetailPrivacy();
          settledRead.current = readKey;
          receiptPrivacy.current = currentPrivacy.current;
          withdrawnReceipt.current = false;
        }
        setResource((current) => current.scope === scope
          ? rejectLoadState(current, { scope, error, emptyData: EMPTY_ARTIST_REVIEWS, retainData: !denied && privacyCurrent() })
          : current);
      });

    return () => {
      if (requestSequence.current === sequence) requestSequence.current += 1;
      controller.abort();
    };
  }, [accountId, artistKey, identity, limit, name, revision, scope, active, token]);

  const reload = useCallback(() => setRevision((current) => current + 1), []);
  const projected = projectArtistReviewsResource(resource, { accountId, name, artistKey });
  // A privacy revision hides the private snapshot without restarting an
  // admitted denial read. A fresh explicit reload can establish new access.
  const denied = reviewAccessWithdrawn(projected.error);
  const withdrawn = resource.scope === scope && (receiptPrivacy.current !== privacyScope || withdrawnReceipt.current);
  return {
    resource: withdrawn || denied ? {
      ...projected, data: EMPTY_ARTIST_REVIEWS, updatedAt: projected.updatedAt ?? 0,
      // Idle plus an explicit recovery reason is not a successful empty read.
      // Keep an actual denial error intact for diagnostics and retry UI.
      ...(!denied ? { status: "idle", error: null } : {}),
      privacyWithdrawn: true,
    } : projected,
    reload: guard(reload),
  };
}
