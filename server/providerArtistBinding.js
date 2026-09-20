// Provider identity review applies only to imported events, never to a member's
// own show. A known pending/conflicting provider identity must not inherit an
// existing catalog artist merely because its display name happens to match.
export function tourDateArtistIdentityPending(row) {
  return row?.owner_id == null && ["pending", "conflict"].includes(row?.artist_identity_status);
}

export function tourDateArtistBindingAllowedSql(alias = "td") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("Invalid tour-date SQL alias");
  return `(${alias}.owner_id IS NOT NULL OR COALESCE(${alias}.artist_identity_status,'') NOT IN ('pending','conflict'))`;
}
