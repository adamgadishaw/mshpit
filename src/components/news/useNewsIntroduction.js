import { useCallback, useEffect, useRef, useState } from "react";
import { useNewsInteractions } from "./NewsInteractionContext";
import { requestNewsIntroduction } from "../../lib/newsDeskApi";
import { createChatClientMutationId } from "../../domain/chatDelivery.mjs";
import { newsPrivacyScope } from "../../domain/newsReaderState.mjs";

// Mounted only on the actual For You surface. No storage/session reset can
// reintroduce a story: the server owns the account/story receipt.
export default function useNewsIntroduction(enabled) {
  const { session, blockedIds, removedIds, mutedIds, followedArtists, authReady } = useNewsInteractions();
  const scope = newsPrivacyScope({ session, blockedIds, removedIds, mutedIds, followedArtists });
  const active = !!enabled && !!session?.id && authReady && !!followedArtists?.length;
  const boundary = useRef(null);
  const controller = useRef(null);
  const [state, setState] = useState(null);
  if (boundary.current?.scope !== scope || boundary.current?.active !== active) {
    boundary.current = { scope, active, requestId: createChatClientMutationId("news") };
  }
  const attempt = boundary.current;
  const load = useCallback(async () => {
    if (!attempt.active) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    try {
      const result = await requestNewsIntroduction({ accountId: session.id, requestId: attempt.requestId, signal: request.signal });
      if (!request.signal.aborted && boundary.current === attempt) setState({ attempt, post: result?.post || null, error: false });
    } catch {
      // architecture: allow-ambiguous-result -- ordinary ranked posts stay usable; retry reuses the exact introduction command
      if (!request.signal.aborted && boundary.current === attempt) setState({ attempt, post: null, error: true });
    }
  }, [attempt, session?.id]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  const dismiss = () => { controller.current?.abort(); setState({ attempt, post: null, error: false }); };
  return { post: active && state?.attempt === attempt ? state.post : null, error: active && state?.attempt === attempt && state.error, retry: load, dismiss };
}
