// Generated object URLs/native image refs are owned by one exact media/asset
// pair. Identity checking prevents a late Image event from A releasing B after
// a fast A -> B tile recycle.
export function releaseVideoPosterAssetLease(ref, expected = null) {
  const current = ref?.current || null;
  if (!current) return false;
  if (expected && (current.uri !== expected.uri || current.asset !== expected.asset)) return false;
  ref.current = null;
  try { current.release?.(); } catch {}
  return true;
}

export function replaceVideoPosterAssetLease(ref, lease) {
  releaseVideoPosterAssetLease(ref);
  if (!ref || !lease?.uri || !lease?.asset || typeof lease.release !== "function") return false;
  ref.current = lease;
  return true;
}
