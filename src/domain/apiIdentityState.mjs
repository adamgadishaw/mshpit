export function apiIdentityBarrierDecision(identity, { skipIdentityCheck = false, expectedAccountId } = {}) {
  if (skipIdentityCheck || expectedAccountId !== undefined || identity?.ready) return "proceed";
  return identity?.accountId ? "reject" : "wait";
}
