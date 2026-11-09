import { createContext } from "react";

// A rendered predecessor is a visual preview, never a current presentation.
// Standalone screens and non-retained routes retain their existing behavior.
export const IOSDetailPresentationContext = createContext(null);
