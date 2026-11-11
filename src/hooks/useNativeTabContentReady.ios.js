import { useContext, useLayoutEffect } from "react";
import { NativeTabReadinessContext } from "../components/nativeTabPreviewContext.mjs";
export default function useNativeTabContentReady(ready) {
  const report = useContext(NativeTabReadinessContext);
  useLayoutEffect(() => { report?.(!!ready); }, [report, ready]);
}
