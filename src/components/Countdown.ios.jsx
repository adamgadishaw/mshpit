import { useLayoutEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { fmtCountdown } from "../lib/showTime";
import useIOSDetailPresentation from "../hooks/useIOSDetailPresentation";

// Keep the clock's pixels while a detail is retained, but no timer or queued
// completion may borrow the admission created by a later Back/reconnect.
export default function Countdown({ target, style, tonightLabel = "TONIGHT", fallback = "", active = true, onComplete }) {
  const presentation = useIOSDetailPresentation();
  const canAct = presentation.canAct || presentation.current;
  const commandToken = presentation.commandToken || presentation.token;
  const [now, setNow] = useState(() => Date.now());
  const onCompleteRef = useRef(onComplete);
  const completedTargetRef = useRef(null);
  onCompleteRef.current = onComplete;

  useLayoutEffect(() => {
    if (!active || !canAct() || target == null) return undefined;
    let retired = false;
    const current = () => !retired && canAct();
    const notifyIfComplete = (currentTime) => {
      if (!current() || currentTime < target || completedTargetRef.current === target) return false;
      completedTargetRef.current = target;
      onCompleteRef.current?.();
      return true;
    };
    const currentTime = Date.now();
    setNow(currentTime);
    if (notifyIfComplete(currentTime)) return undefined;
    const id = setInterval(() => {
      if (!current()) return;
      const tickTime = Date.now();
      setNow(tickTime);
      if (notifyIfComplete(tickTime)) clearInterval(id);
    }, 1000);
    return () => { retired = true; clearInterval(id); };
  }, [active, target, presentation.active, commandToken]);

  if (target == null) return <Text style={style}>{fallback}</Text>;
  const left = target - now;
  return <Text style={style}>{left <= 0 ? tonightLabel : fmtCountdown(left)}</Text>;
}
