import { captureApiIdentityCheck } from './api';
import { captureWebAuthCheck } from './webRecovery.mjs';

// Keep the transport identity and durable cross-tab auth receipt behind one
// adapter. Recovery hooks consume this fence without depending on the API.
export function captureWebRecoveryOwnership(accountId) {
  const identityCurrent = captureApiIdentityCheck(accountId);
  const authCurrent = captureWebAuthCheck();
  return () => identityCurrent() && authCurrent();
}
