import useIOSDetailPresentation from "../../hooks/useIOSDetailPresentation";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppError } from "../../lib/diagnostics";
import { createArtistOverviewController } from "./artistOverviewController.ios.mjs";
import { readArtistOverview } from "./services/artistOverviewApi.mjs";

const asError = (error) => error instanceof AppError ? error : new AppError(undefined, {
  code: "PIT-API-001", context: "Loading artist shows and ratings", source: "artist-overview", cause: error,
});
export function useArtistOverview({ artistKey = null, accountId = null, enabled = true, pageSize = 12, publicPreview = false, presentation = null } = {}) {
  const inherited = useIOSDetailPresentation();
  const { active, current, guard, token } = presentation || inherited;
  // A new identity gets a new store during render, before effects run. An old
  // response cannot leak private block-aware ratings into the next identity.
  const controller = useMemo(() => createArtistOverviewController({
    artistKey, accountId, enabled, pageSize, publicPreview, read: readArtistOverview, asError,
  }), [artistKey, accountId, enabled, pageSize, publicPreview]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    if (!active || !current()) { controller.pause(); return undefined; }
    controller.resume();
    if (!controller.getSnapshot().resource.data?.schedule) void controller.reload({ current });
    return controller.pause;
  }, [controller, active, token]);
  useEffect(() => () => controller.dispose(), [controller]);
  return { ...snapshot, reload: guard(() => controller.reload({ current })), refresh: guard((options) => controller.refresh({ ...options, current })), loadMore: guard(() => controller.loadMore({ current })), setLocation: guard((value) => controller.setLocation(value, { current })) };
}
