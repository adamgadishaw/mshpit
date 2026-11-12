import { useLayoutEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useStore } from "../store";
import useIOSDetailPresentation from "../hooks/useIOSDetailPresentation";

// Reads may outlive a retained source screen. Admission, account, location and
// request ownership must all still agree before a result can push navigation.
function useEventPageNavigation(read, onOpen) {
  const { session } = useStore();
  const accountId = session?.id || null;
  const { active, canAct, commandToken } = useIOSDetailPresentation();
  const owner = useRef(accountId); owner.current = accountId;
  const request = useRef(null);
  const [state, setState] = useState(null);
  useLayoutEffect(() => () => { request.current?.abort(); request.current = null; }, [accountId, active, commandToken]);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const cancel = () => { request.current?.abort(); request.current = null; setState(null); };
    globalThis.addEventListener("popstate", cancel);
    return () => globalThis.removeEventListener("popstate", cancel);
  }, []);
  const open = async (target) => {
    if (!active || !canAct()) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const origin = Platform.OS === "web" ? globalThis.location?.href : null;
    const entry = Platform.OS === "web" ? globalThis.history?.state : null;
    const current = () => !controller.signal.aborted && request.current === controller
      && owner.current === accountId && canAct()
      && (Platform.OS !== "web" || (globalThis.location?.href === origin && globalThis.history?.state === entry));
    setState({ target, accountId, status: "loading" });
    try {
      const event = await read(target, { accountId, signal: controller.signal });
      if (!current()) return;
      setState({ target, accountId, status: event ? "idle" : "unavailable" });
      if (event) onOpen?.(event);
    } catch {
      if (current()) setState({ target, accountId, status: "error" });
    } finally { if (request.current === controller) request.current = null; }
  };
  return { open, state: state?.accountId === accountId && (state.status !== "loading" || request.current) ? state : null };
}

export default function EventPageNavigation({ read, onOpen, children }) {
  return children(useEventPageNavigation(read, onOpen));
}
