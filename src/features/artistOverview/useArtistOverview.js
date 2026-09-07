import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppError } from "../../lib/diagnostics";
import { createArtistOverviewController } from "./artistOverviewController.mjs";
import { readArtistOverview } from "./services/artistOverviewApi.mjs";

const asError = (error) => error instanceof AppError ? error : new AppError(undefined, {
  code: "PIT-API-001", context: "Loading artist shows and ratings", source: "artist-overview", cause: error,
});
export function useArtistOverview({ artistKey = null, accountId = null, enabled = true, pageSize = 12, publicPreview = false } = {}) {
  // A new identity gets a new store during render, before effects run. An old
  // response cannot leak private block-aware ratings into the next identity.
  const controller = useMemo(() => createArtistOverviewController({
    artistKey, accountId, enabled, pageSize, publicPreview, read: readArtistOverview, asError,
  }), [artistKey, accountId, enabled, pageSize, publicPreview]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.resume(); void controller.reload(); return controller.dispose; }, [controller]);
  return { ...snapshot, reload: controller.reload, refresh: controller.refresh, loadMore: controller.loadMore, setLocation: controller.setLocation };
}
