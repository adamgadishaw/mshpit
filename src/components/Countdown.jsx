import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";

import { fmtCountdown } from "../lib/showTime";

// A live countdown that owns its own clock.
//
// Every screen showing one of these used to hold a `nowTick` state and a
// 1-second interval, so the whole screen re-rendered once a second to update a
// single label. On the You screen that meant re-rendering the playlists, the
// going-to list, the tools grid and the diary every second, forever, on a page
// where nothing else was moving. Keeping the tick inside the label means the
// only thing React re-renders each second is this one Text node.
//
// `target` is the show's start in epoch ms, or null when it is unknown.
export default function Countdown({ target, style, tonightLabel = "TONIGHT", fallback = "", active = true, onComplete }) {
  const [now, setNow] = useState(() => Date.now());
  const onCompleteRef = useRef(onComplete);
  const completedTargetRef = useRef(null);

  // Keep the latest callback without making its identity part of the timer
  // lifecycle. A parent render must not tear down and recreate this interval.
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!active || target == null) return undefined;
    const notifyIfComplete = (currentTime) => {
      if (currentTime < target || completedTargetRef.current === target) return false;
      completedTargetRef.current = target;
      onCompleteRef.current?.();
      return true;
    };
    const currentTime = Date.now();
    setNow(currentTime);
    // Once the show has started there is nothing left to count. Notify the
    // owner once so it can advance to the next phase, then stay asleep.
    if (notifyIfComplete(currentTime)) return undefined;
    const id = setInterval(() => {
      const tickTime = Date.now();
      setNow(tickTime);
      if (notifyIfComplete(tickTime)) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [active, target]);

  if (target == null) return <Text style={style}>{fallback}</Text>;
  const left = target - now;
  return <Text style={style}>{left <= 0 ? tonightLabel : fmtCountdown(left)}</Text>;
}
