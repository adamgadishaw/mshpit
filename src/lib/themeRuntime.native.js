import Storage from "expo-sqlite/kv-store";
import { reloadAppAsync } from "expo";
import { createNativeThemeRuntime } from "./nativeThemeRuntime.mjs";
export const nativeThemeRuntime = true;
const runtime = createNativeThemeRuntime(Storage, reloadAppAsync, () => console.warn("Appearance could not be applied; it can be retried on the next launch."));
export const { readThemeSelection, persistThemeSelection, clearThemeSelection, reloadTheme } = runtime;
