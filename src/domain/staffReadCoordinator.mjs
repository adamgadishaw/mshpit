import { createScopedReadCoordinator } from "./scopedReadCoordinator.mjs";

export function staffScopeFor(session) {
  if (!session?.id || (session.role !== "admin" && session.role !== "moderator")) return null;
  return `${session.id}\u0000${session.role}`;
}

// Orders private staff reads independently from public Store hydration. The
// epoch is intentionally monotonic across reset: clearing a ticket map alone
// could let an old request's ticket `1` become current again after the same
// account signs back in and claims a fresh ticket `1`.
export function createStaffReadCoordinator() {
  return createScopedReadCoordinator(staffScopeFor);
}
