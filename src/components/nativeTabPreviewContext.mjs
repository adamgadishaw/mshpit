import { createContext } from "react";

// True only for the one real destination currently revealed by an iOS drag.
// A preview may read on that intent, but cannot persist, announce, autoplay
// or acquire foreground analytics ownership until navigation commits.
export const NativeTabPreviewContext = createContext(false);

export const NativeTabReadinessContext = createContext(null);
