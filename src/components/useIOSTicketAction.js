import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { openTicketLink } from "../lib/ticketLinks";
import useScreenReaderEnabled from "../hooks/useScreenReaderEnabled";

// Platform is immutable for this module's lifetime. Android/web keep their
// existing opener path without adding a native accessibility subscription.
const useTicketScreenReader = Platform.OS === "ios" ? useScreenReaderEnabled : () => false;

// This is feedback, not ticket availability. The existing link helper remains
// the only owner of destination validation, confirmation and external opening.
export default function useIOSTicketAction(scope) {
  const screenReaderEnabled = useTicketScreenReader();
  const reader = useRef(screenReaderEnabled);
  reader.current = screenReaderEnabled;
  const [failure, setFailure] = useState(null);
  const active = useRef(scope);
  const request = useRef(null);
  const context = useRef({ scope });
  if (context.current.scope !== scope) context.current = { scope };
  const identity = context.current;
  if (active.current !== scope) request.current = null;
  active.current = scope;
  useEffect(() => {
    active.current = scope;
    return () => {
      if (active.current === scope) active.current = null;
    };
  }, [scope]);
  const open = async (url) => {
    if (Platform.OS !== "ios") return openTicketLink(url);
    if (request.current?.scope === scope) return;
    const claim = { scope };
    request.current = claim;
    setFailure(null);
    try {
      return await openTicketLink(url, {
        onFailure: () => {
          if (active.current === scope && context.current === identity && request.current === claim && !claim.reported) {
            claim.reported = true;
            const message = "The ticket site could not be opened. Try the ticket button again, or refresh these details.";
            setFailure({ identity, message });
            // Announce only this completed user action, never a render or a
            // preference change. Queue behind the user's current VoiceOver speech.
            if (reader.current) AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
          }
        },
      });
    } finally {
      if (request.current === claim) request.current = null;
    }
  };
  return { open, error: Platform.OS === "ios" && failure?.identity === identity ? failure.message : "" };
}
