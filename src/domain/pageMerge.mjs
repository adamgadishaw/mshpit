export function mergeUniquePage(current, incoming, keyOf = (item) => item?.id) {
  const merged = new Map();
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = keyOf(item);
    if (key == null || key === "") continue;
    // A later page can carry a fresher projection after another staff action.
    merged.set(key, item);
  }
  return [...merged.values()];
}

function memberStatus(member, now) {
  if (member?.isBanned) return "banned";
  const suspendedUntil = Number(member?.suspendedUntil);
  if (Number.isFinite(suspendedUntil) && suspendedUntil > now) return "suspended";
  return "active";
}

export function memberMatchesDirectory(member, directory = {}, { now = Date.now() } = {}) {
  if (!member) return false;
  const query = String(directory.query || "").trim().toLowerCase();
  const role = String(directory.role || "").trim().toLowerCase();
  const status = String(directory.status || "").trim().toLowerCase();
  if (query) {
    const searchable = [member.name, member.handle, member.id]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!searchable.includes(query)) return false;
  }
  if (role && String(member.role || "fan").toLowerCase() !== role) return false;
  if (status && memberStatus(member, now) !== status) return false;
  return true;
}

// A staff mutation can move a row out of the server scope currently displayed
// (for example, banning a member while the Active filter is selected). Keep the
// local page and its server-provided matching total coherent until the next GET.
export function reconcileMemberMutationPage(current, directory, memberId, patch, { now = Date.now() } = {}) {
  const members = Array.isArray(current) ? current : [];
  const index = members.findIndex((member) => member?.id === memberId);
  if (index < 0) return { members, directory };

  const updated = { ...members[index], ...(patch || {}) };
  if (memberMatchesDirectory(updated, directory, { now })) {
    const next = members.slice();
    next[index] = updated;
    return { members: next, directory };
  }

  const matchingTotal = Number(directory?.matchingTotal);
  return {
    members: members.filter((member) => member?.id !== memberId),
    directory: {
      ...(directory || {}),
      matchingTotal: Number.isFinite(matchingTotal)
        ? Math.max(0, matchingTotal - 1)
        : Math.max(0, members.length - 1),
    },
  };
}
