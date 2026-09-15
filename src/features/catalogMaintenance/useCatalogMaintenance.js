import { useEffect, useRef, useState } from "react";
import { changeCatalogMaintenanceMode, loadCatalogMaintenance } from "./catalogMaintenanceService";
import { createCatalogMaintenanceController, emptyCatalogMaintenanceState } from "./catalogMaintenanceState.mjs";

export default function useCatalogMaintenance({ accountId, role, active = true, refreshRegistry }) {
  const scope = role === "admin" && accountId ? `${accountId}:admin` : null;
  const ownerRef = useRef({ scope });
  if (ownerRef.current.scope !== scope) ownerRef.current = { scope };
  const owner = ownerRef.current;
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    if (!scope || !active) return undefined;
    const controller = createCatalogMaintenanceController({
      accountId, read: loadCatalogMaintenance, change: changeCatalogMaintenanceMode,
      onState: (state) => {
        if (ownerRef.current === owner) setSaved({ owner, state });
      },
    });
    owner.controller = controller;
    const refresh = () => controller.refresh();
    if (refreshRegistry) refreshRegistry.current.catalogUpkeep = refresh;
    void controller.refresh();
    const timer = setInterval(() => { void controller.refresh(); }, 60_000);
    return () => {
      clearInterval(timer);
      controller.dispose();
      if (owner.controller === controller) owner.controller = null;
      if (refreshRegistry?.current.catalogUpkeep === refresh) delete refreshRegistry.current.catalogUpkeep;
    };
  }, [owner, scope, accountId, active, refreshRegistry]);
  return {
    ...(saved?.owner === owner ? saved.state : emptyCatalogMaintenanceState()),
    available: !!scope, active,
    refresh: () => owner.controller?.refresh(),
    setMode: (mode) => owner.controller?.setMode(mode),
  };
}
