import { useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { captureWebRecoveryOwnership } from '../lib/webRecoveryOwnership';
import { registerWebRecoveryDraft } from '../lib/webRecovery.mjs';

// Capture the ownership epoch at registration, not at a later reload click.
// A→guest→A and callbacks retained across unmount remain invalid.
export function useWebRecoveryDraft(accountId, flush) {
  const current = useRef(flush);
  current.current = flush;
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const isCurrent = captureWebRecoveryOwnership(accountId);
    // Revalidation invalidates the old registration conservatively. A fresh
    // composer/new tab can register again after the account settles.
    return registerWebRecoveryDraft(() => current.current(), isCurrent);
  }, [accountId]);
}
