import { createContext, useContext } from "react";

// The application shell supplies account-scoped state; shared news UI never
// reaches into the legacy store or retains credentials of its own.
export const NewsInteractionContext = createContext({ session: null, authReady: false, blockedIds: [], removedIds: [] });
export const useNewsInteractions = () => useContext(NewsInteractionContext);
