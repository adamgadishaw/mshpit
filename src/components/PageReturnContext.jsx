import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { focusRing } from "../theme";

const PageReturnContext = createContext(null);

export function PageReturnProvider({ controller, scope, children }) {
  const value = useMemo(() => ({
    register: (handler, refreshes) => controller.register(scope, handler, refreshes),
    request: () => controller.request(scope),
    subscribe: controller.subscribe,
    capability: () => controller.capability(scope),
  }), [controller, scope]);
  return <PageReturnContext.Provider value={value}>{children}</PageReturnContext.Provider>;
}

export const usePageReturn = () => useContext(PageReturnContext);
const noSubscription = () => () => {};
const noCapability = () => 0;

// Preserve each page's typography while giving all headings the same gesture.
export function PageTitle({ children, label, style }) {
  const page = usePageReturn();
  const capability = useSyncExternalStore(page?.subscribe || noSubscription, page?.capability || noCapability, noCapability);
  if (!capability) return style ? <View style={style}>{children}</View> : children;
  return <Pressable style={({ focused }) => [style, { minHeight: 44, justifyContent: "center" }, focused && focusRing]} onPress={page.request} accessibilityRole="button"
    accessibilityLabel={`${label || "Page"}, return to top${capability === 2 ? " and refresh" : ""}`} hitSlop={8}>{children}</Pressable>;
}
