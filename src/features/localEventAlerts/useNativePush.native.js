import { useEffect, useLayoutEffect } from "react";
import { AppState } from "react-native";
import { authTransitions } from "../../lib/authTransitions";
import { nativePush } from "./nativePushService";

export function useNativePush({ accountId, authEpoch, onOpenEvent, onActivity }) {
  nativePush.setAccount(accountId, authEpoch);
  nativePush.updateCallbacks({ onOpenEvent, onActivity });
  useLayoutEffect(() => authTransitions.attachPreparation(nativePush), []);
  useEffect(() => {
    nativePush.start();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void nativePush.activate(); });
    return () => { subscription.remove(); nativePush.stop(); };
  }, []);
  useEffect(() => { nativePush.setAccount(accountId, authEpoch); void nativePush.activate(); }, [accountId, authEpoch]);
  return nativePush.cancelNavigation;
}
