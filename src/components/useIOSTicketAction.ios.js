import { useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { openTicketLink } from "../lib/ticketLinks";
import useScreenReaderEnabled from "../hooks/useScreenReaderEnabled";
import useIOSDetailPresentation from "../hooks/useIOSDetailPresentation";

// Platform is immutable for this module's lifetime. Android/web keep their
// existing opener path without adding a native accessibility subscription.
const useTicketScreenReader = Platform.OS === "ios" ? useScreenReaderEnabled : () => false;
const useTicketLifetime = Platform.OS === "ios" ? useLayoutEffect : () => {};

// This is feedback, not ticket availability. The existing link helper remains
// the only owner of destination validation, confirmation and external opening.
export default function useIOSTicketAction(scope) {
  const presentation = useIOSDetailPresentation();
  const canAct = presentation.canAct || presentation.current;
  const commandToken = presentation.commandToken || presentation.token;
  const screenReaderEnabled = useTicketScreenReader();
  const reader = useRef(screenReaderEnabled);
  reader.current = screenReaderEnabled;
  const [failure, setFailure] = useState(null);
  const [lifetime, setLifetime] = useState(null);
  const active = useRef(null);
  const request = useRef(null);
  const context = useRef({ scope, token: commandToken });
  if (context.current.scope !== scope || context.current.token !== commandToken) {
    context.current = { scope, token: commandToken };
    request.current = null;
  }
  const identity = context.current;
  useTicketLifetime(() => {
    const owner = {};
    active.current = owner;
    // Publish fresh controls after every layout reconnect, including StrictMode
    // replay. A retained control must never borrow a later mounted lifetime.
    setLifetime(owner);
    setFailure(null);
    return () => {
      if (active.current === owner) {
        active.current = null;
        request.current = null;
      }
    };
  }, []);
  const owns = () => canAct() && lifetime && active.current === lifetime && context.current === identity;
  const open = async (url) => {
    if (Platform.OS !== "ios") return openTicketLink(url);
    if (!owns() || request.current) return;
    const claim = { identity, lifetime };
    request.current = claim;
    setFailure(null);
    try {
      return await openTicketLink(url, {
        isCurrent: owns,
        onFailure: () => {
          if (owns() && request.current === claim && !claim.reported) {
            claim.reported = true;
            const message = "The ticket site could not be opened. Try the ticket button again, or refresh these details.";
            setFailure({ identity, lifetime, message });
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
  return { open, error: Platform.OS === "ios" && owns() && failure?.identity === identity && failure.lifetime === lifetime ? failure.message : "" };
}
