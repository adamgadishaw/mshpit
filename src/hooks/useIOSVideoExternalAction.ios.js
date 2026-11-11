import { useLayoutEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";

// This guard owns only the external fallback, never the Expo player or cache.
export default function useIOSVideoExternalAction({ uri, postId, active, isCurrentRoute, isCurrentMedia, onFailure }) {
  const ref = useRef(null);
  const [, redraw] = useState(0);
  if (!ref.current || ref.current.uri !== uri || ref.current.postId !== postId || ref.current.active !== active) {
    ref.current = { uri, postId, active, live: false, presentation: { retired: false }, request: null };
  }
  const owner = ref.current;
  const presentation = owner.presentation;
  const current = () => ref.current === owner && owner.live && active
    && owner.presentation === presentation && !presentation.retired
    && AppState.currentState === "active" && (!isCurrentRoute || isCurrentRoute())
    && (!isCurrentMedia || isCurrentMedia());

  useLayoutEffect(() => {
    let live = true;
    owner.live = true;
    // Layout reconnect must publish new controls, not revive captured ones.
    if (owner.presentation.retired) owner.presentation = { retired: false };
    redraw(value => value + 1);
    const subscription = AppState.addEventListener("change", state => {
      if (!live) return;
      if (state !== "active") {
        owner.presentation.retired = true;
        owner.request = null;
      } else if (owner.presentation.retired) {
        // An inactive -> active pair can be batched into no useAppActive change.
        owner.presentation = { retired: false };
        redraw(value => value + 1);
      }
    });
    return () => {
      live = false;
      owner.live = false;
      owner.presentation.retired = true;
      owner.request = null;
      subscription.remove();
    };
  }, [owner]);

  return async () => {
    if (!current()) return;
    const request = {};
    owner.request = request;
    try {
      // Once accepted, an OS opening cannot be recalled. Only its feedback is
      // ours to suppress if this media/presentation/foreground has retired.
      await Linking.openURL(uri);
    } catch {
      if (current() && owner.request === request) onFailure();
    } finally {
      if (owner.request === request) owner.request = null;
    }
  };
}
