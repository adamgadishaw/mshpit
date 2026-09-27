import { useEffect, useRef, useState } from "react";
import { toAppError } from "../../lib/diagnostics";
import { changeSearchGrowthMode, loadSearchGrowth } from "./searchGrowthService";
import { createSearchGrowthController, emptySearchGrowthState, searchGrowthScope } from "./searchGrowthState.mjs";

export default function useSearchGrowth({ accountId, role, emailVerified, active = true, refreshRegistry }) {
  const scope = searchGrowthScope({ accountId, role, emailVerified });
  const ownerRef = useRef({ scope });
  if (ownerRef.current.scope !== scope) ownerRef.current = { scope };
  const owner = ownerRef.current;
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    if (!scope || !active) return undefined;
    const controller = createSearchGrowthController({
      accountId, scope, read: loadSearchGrowth, change: changeSearchGrowthMode, initialState: owner.snapshot,
      normalizeError: (error) => toAppError(error, { context: "Search Growth" }),
      onState: (state) => {
        if (ownerRef.current !== owner) return;
        owner.snapshot = state;
        setSaved({ owner, state });
      },
    });
    owner.controller = controller;
    const refresh = () => controller.refresh();
    if (refreshRegistry) refreshRegistry.current.searchGrowth = refresh;
    void controller.refresh();
    return () => {
      controller.dispose();
      if (owner.controller === controller) owner.controller = null;
      if (refreshRegistry?.current.searchGrowth === refresh) delete refreshRegistry.current.searchGrowth;
    };
  }, [owner, scope, accountId, active, refreshRegistry]);
  return {
    ...(saved?.owner === owner ? saved.state : emptySearchGrowthState(scope)),
    available: !!scope, active,
    refresh: () => owner.controller?.refresh(),
    setMode: (mode) => owner.controller?.setMode(mode),
  };
}
