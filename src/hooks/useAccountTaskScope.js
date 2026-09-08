import { useEffect, useRef } from "react";
import { createAccountTaskScope } from "../domain/accountTaskScope.mjs";

export function useAccountTaskScope(accountId) {
  const scopeRef = useRef(null);
  if (!scopeRef.current) scopeRef.current = createAccountTaskScope();
  const scope = scopeRef.current;
  // Reject stale callbacks during the account-change render, before effects.
  scope.setAccount(accountId);
  useEffect(() => {
    scope.mount();
    return () => scope.dispose();
  }, [scope]);
  return scope;
}
