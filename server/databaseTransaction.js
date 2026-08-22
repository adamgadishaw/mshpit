// Run a synchronous SQLite write inside an IMMEDIATE transaction unless the
// caller already owns one. Keeping this primitive in one place prevents media
// subsystems from drifting on nested-transaction and rollback behavior.
export function withImmediateWrite(database, action) {
  const ownsTransaction = !database.isTransaction;
  if (ownsTransaction) database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    if (ownsTransaction) database.exec("COMMIT");
    return result;
  } catch (error) {
    if (ownsTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch (rollbackError) {
        // The action error is the causal failure; never replace it with a
        // secondary rollback error from an already-broken connection.
        void rollbackError;
      }
    }
    throw error;
  }
}
