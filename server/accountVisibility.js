// One authoritative public-account predicate for every UGC read surface.
// SQL aliases are developer-authored identifiers, never request data.
export function activeAccountSql(alias = "u") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new TypeError("Invalid SQL alias");
  return `${alias}.is_banned=0 AND (${alias}.suspended_until IS NULL OR ${alias}.suspended_until<=CAST(strftime('%s','now') AS INTEGER)*1000)`;
}

export function accountIsPublic(user, at = Date.now()) {
  return !!user && !user.is_banned && !(user.suspended_until && user.suspended_until > at);
}
