import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { festivalToday } from "./festivalPresentation.ios.mjs";

// Advance the UTC catalogue day without polling the server or waking the app.
export default function useFestivalDay() {
  const [today, setToday] = useState(() => festivalToday());
  useEffect(() => {
    let timer;
    let alive = true;
    const update = () => {
      clearTimeout(timer);
      if (!alive) return;
      setToday(festivalToday());
      const now = new Date();
      const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      timer = setTimeout(update, Math.max(1000, midnight.getTime() - now.getTime() + 100));
    };
    const subscription = AppState.addEventListener("change", state => { if (state === "active") update(); });
    update();
    return () => { alive = false; clearTimeout(timer); subscription.remove(); };
  }, []);
  return today;
}
