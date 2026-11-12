import { useContext } from "react";
import { NativeTabPreviewContext } from "../components/nativeTabPreviewContext.mjs";
export default function useNativeTabPreview() { return useContext(NativeTabPreviewContext); }
