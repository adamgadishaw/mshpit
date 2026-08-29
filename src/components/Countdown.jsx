import { useEffect, useState } from "react";
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
export default function Countdown({ target, style, tonightLabel = "TONIGHT", fallback = "", active = true }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || target == null) return undefined;
    // Once the show has started there is nothing left to count, so the timer
    // stops rather than ticking forever behind a static label.
    if (target - Date.now() <= 0) return undefined;
    const id = setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= target) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [active, target]);

  if (target == null) return <Text style={style}>{fallback}</Text>;
  const left = target - now;
  return <Text style={style}>{left <= 0 ? tonightLabel : fmtCountdown(left)}</Text>;
}
