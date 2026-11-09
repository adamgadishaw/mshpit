import { createContext } from "react";

// Only a previously visible, still-mounted Feed can supply the real backdrop.
// No route reconstruction or hidden duplicate screen is a substitute.
export const NativeFeedBackContext = createContext(false);
