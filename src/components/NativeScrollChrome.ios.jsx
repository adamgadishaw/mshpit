import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import useScreenReaderEnabled from "../hooks/useScreenReaderEnabled";
import useAppActive from "../lib/useAppActive";

export const NativeScrollChromeContext = createContext(null);
export function NativeScrollChromeProvider({ children, scope, page, enabled = true }) {
  const shown = useSharedValue(true);
  const admitted = useSharedValue(false);
  const epoch = useSharedValue(0);
  const serial = useRef(0);
  const [presentation, setPresentation] = useState(null);
  const [height, setHeight] = useState(48);
  const [sources, setSources] = useState(0);
  const activeSources = useRef(new Set());
  const foreground = useAppActive();
  const reader = useScreenReaderEnabled();
  const owner = useMemo(() => ({}), [scope, page, enabled, foreground, reader]);
  const lifetime = useRef(null);
  const active = enabled && foreground && !reader;
  useLayoutEffect(() => {
    const entry = { owner, id: ++serial.current };
    lifetime.current = entry;
    epoch.set(entry.id);
    setPresentation(entry);
    shown.set(true);
    admitted.set(active);
    return () => { if (lifetime.current === entry) { lifetime.current = null; epoch.set(-entry.id); admitted.set(false); } };
  }, [owner, shown, admitted, active]);
  const register = useCallback(token => {
    activeSources.current.add(token); setSources(activeSources.current.size);
    return () => {
      activeSources.current.delete(token);
      setSources(activeSources.current.size);
      if (!activeSources.current.size) shown.set(true);
    };
  }, [shown]);
  const current = useCallback(() => presentation && presentation.owner === owner && lifetime.current === presentation && enabled && foreground && shown.get(), [owner, presentation, enabled, foreground, shown]);
  const measure = useCallback(event => {
    const next = event.nativeEvent.layout.height;
    if (Number.isFinite(next) && next > 0) setHeight(value => Math.abs(value - next) >= 0.5 ? next : value);
  }, []);
  const value = useMemo(() => ({ shown, admitted, epoch, revision: presentation?.owner === owner ? presentation.id : 0, height, sources, register, owner: presentation?.owner === owner ? presentation : null, active, reader, current, measure }),
    [shown, admitted, epoch, presentation, height, sources, register, owner, active, reader, current, measure]);
  return <NativeScrollChromeContext.Provider value={value}>{children}</NativeScrollChromeContext.Provider>;
}
export function NativeScrollChromeContent({ children }) {
  const chrome = useContext(NativeScrollChromeContext);
  // Loading/error/guest surfaces without a primary scroll retain usable space
  // below the shown header. A registered scroll owns its own stable inset.
  return <View style={{ flex: 1, minHeight: 0, paddingTop: chrome && !chrome.sources ? chrome.height : 0 }}>{children}</View>;
}
