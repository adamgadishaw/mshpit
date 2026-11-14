import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { toAppError } from "../../lib/diagnostics";
import { localAlertClient } from "./localAlertService";
import { createSecureInstallationStorage } from "./secureInstallationStorage.mjs";
import { createNativePushRuntime } from "./nativePushRuntime.mjs";

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const installationStorage = createSecureInstallationStorage({
  secureStore: { getItemAsync: key => SecureStore.getItemAsync(key, options), setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, options) },
  createIdentity: async () => ({ installationId: Crypto.randomUUID(), secret: Array.from(await Crypto.getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, "0")).join("") }),
});
// Foreground updates refresh Activity. No private account data or unchecked
// payload appears in a foreground banner, including during an account switch.
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }) });
export const nativePush = createNativePushRuntime({ api: localAlertClient, notifications: Notifications, installationStorage, platform: Platform.OS,
  projectId: Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId,
  enabled: Constants.expoConfig?.extra?.nativePushEnabled === true && Constants.executionEnvironment !== "storeClient",
  toAppError: error => toAppError(error, { code: "PIT-NET-001", message: "Device notifications could not be updated. Try again.", retryable: true }),
});
