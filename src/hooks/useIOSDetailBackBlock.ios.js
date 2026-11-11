import { createContext, useContext, useLayoutEffect } from "react";

export const IOSDetailBackContext = createContext(null);

// Inline editors opt out of the optional edge gesture. Their existing explicit
// Close/Cancel controls and Root close guards remain the source of truth.
export default function useIOSDetailBackBlock(blocked) {
  const scope = useContext(IOSDetailBackContext);
  useLayoutEffect(() => {
    if (!scope || !blocked) return;
    const token = {};
    scope.add(token);
    return () => scope.remove(token);
  }, [scope, !!blocked]);
}
