import { useCallback, useEffect, useRef, useState } from "react";
import { useNewsInteractions } from "./NewsInteractionContext";
import { requestNewsIntroduction } from "../../lib/newsDeskApi";
import { createChatClientMutationId } from "../../domain/chatDelivery.mjs";
import { newsPrivacyScope } from "../../domain/newsReaderState.mjs";
import { newsIntroductionSession } from "../../domain/newsIntroductionSession.mjs";

// Mounted only on the actual For You surface. No storage/session reset can
// reintroduce a story: the server owns the account/story receipt.
export default function useNewsIntroduction(enabled, { retainOnInactive = true } = {}) {
  const { session, blockedIds, removedIds, mutedIds, followedArtists, authReady } = useNewsInteractions();
  const scope = newsPrivacyScope({ session, blockedIds, removedIds, mutedIds, followedArtists });
  const eligible = !!session?.id && !!authReady && !!followedArtists?.length;
  const active = !!enabled && eligible;
  const slot = newsIntroductionSession.claim(session?.id, () => createChatClientMutationId("news"));
  const admission = useRef(null);
  if (admission.current?.scope !== scope || admission.current?.eligible !== eligible || admission.current?.retainOnInactive !== retainOnInactive) {
    admission.current = { scope, eligible, retainOnInactive };
  }
  const data = admission.current;
  const boundary = useRef(null);
  const controller = useRef(null);
  const mounted = useRef(true);
  const [state, setState] = useState(null);
  if (boundary.current?.data !== data || boundary.current?.active !== active) {
    controller.current?.abort();
    controller.current = null;
    boundary.current = { data, active, slot };
  }
  const attempt = boundary.current;
  const load = useCallback(async () => {
    if (!mounted.current || boundary.current !== attempt || !attempt.active || !attempt.slot || attempt.slot.complete) return;
    if (attempt.slot.inFlight && !attempt.slot.inFlight.signal.aborted) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    attempt.slot.inFlight = request;
    try {
      const result = await requestNewsIntroduction({ accountId: session.id, requestId: attempt.slot.requestId, signal: request.signal });
      if (mounted.current && !request.signal.aborted && boundary.current === attempt) {
        attempt.slot.complete = true;
        setState({ attempt, data, post: result?.post || null, error: false });
      }
    } catch {
      // architecture: allow-ambiguous-result -- ordinary ranked posts stay usable; retry reuses the exact introduction command
      if (mounted.current && !request.signal.aborted && boundary.current === attempt) setState({ attempt, data, post: null, error: true });
    } finally {
      if (attempt.slot.inFlight === request) attempt.slot.inFlight = null;
    }
  }, [attempt, data, session?.id]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      if (boundary.current === attempt) controller.current?.abort();
    };
  }, [load, attempt]);
  const dismiss = () => {
    if (!mounted.current || boundary.current !== attempt || !attempt.active) return;
    controller.current?.abort();
    if (attempt.slot) attempt.slot.complete = true;
    setState({ attempt, data, post: null, error: false });
  };
  const visible = eligible && (retainOnInactive ? state?.data === data : active && state?.attempt === attempt);
  return { post: visible ? state.post : null, error: !!(visible && state.error), retry: load, dismiss };
}
