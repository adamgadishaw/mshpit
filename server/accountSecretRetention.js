/** Remove expired capability hashes even when no later verification/reset arrives. */
export function pruneExpiredAccountSecrets(database, at = Date.now()) {
  const verificationTokens = database.prepare(`UPDATE users
    SET email_verify_hash=NULL,email_verify_expires=0
    WHERE email_verify_hash IS NOT NULL AND email_verify_expires>0 AND email_verify_expires<=?`).run(at);
  const resetTokens = database.prepare(`UPDATE users
    SET reset_hash=NULL,reset_expires=0
    WHERE reset_hash IS NOT NULL AND reset_expires>0 AND reset_expires<=?`).run(at);
  const verificationReceipts = database.prepare("DELETE FROM email_verification_receipts WHERE expires_at<=?").run(at);
  return {
    verificationTokens: Number(verificationTokens?.changes) || 0,
    resetTokens: Number(resetTokens?.changes) || 0,
    verificationReceipts: Number(verificationReceipts?.changes) || 0,
  };
}
