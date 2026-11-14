import { useContext } from "react";
import { IOSDetailPresentationContext } from "../components/iosDetailPresentationContext.mjs";
import useOrdinaryPresentation from "./useIOSDetailPresentation.js";

// The owner supplies an immutable admission token. A captured callback cannot
// regain permission when Back makes the same retained instance active again.
export default function useIOSDetailPresentation() {
  return useContext(IOSDetailPresentationContext) || useOrdinaryPresentation();
}
