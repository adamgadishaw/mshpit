import { createSessionValidationStatus } from "../domain/sessionValidationStatus.mjs";

// The existing Store identity ref is the lifetime key. This adds neither a
// Store hook nor a global active session; abandoned owners are weakly held.
const channels = new WeakMap();
export function sessionValidationStatusForOwner(owner) {
  if (!channels.has(owner)) channels.set(owner, createSessionValidationStatus());
  return channels.get(owner);
}
