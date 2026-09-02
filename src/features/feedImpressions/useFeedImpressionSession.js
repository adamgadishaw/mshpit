import { useEffect } from "react";
import { configureFeedImpressions } from "./feedImpressionService";

export default function useFeedImpressionSession(session) {
  useEffect(() => {
    // Account changes fence the private in-memory retry queue immediately.
    // Individual records also configure synchronously so restored sessions do
    // not lose a child's first qualified impression before this effect runs.
    configureFeedImpressions(session);
  }, [session?.id]);
}
