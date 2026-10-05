import { createContext } from "react";

// Global sheets can cover a still-mounted post/profile. Intersection alone
// cannot detect that occlusion; the shell supplies an additional polling veto.
export const CompletionVisibilityContext = createContext(true);
