// Source privacy is derived from linked rows. Re-run the complete DB-only
// decision after a deadlock rollback with fresh READ COMMITTED statements;
// a Serializable snapshot can predate the competing private attachment.
// Do not pass operations with external side effects. Ambiguous connection
// failures, unique conflicts and source changes are not safe retry signals.
export async function runGeneralSourceWriteTransaction(database, operation) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: "ReadCommitted", timeout: 15_000
      });
    } catch (error) {
      const rolledBackConflict = error?.code === "P2034" ||
        (error?.code === "P2010" && error?.meta?.code === "40P01");
      if (!rolledBackConflict || attempt === 3) throw error;
    }
  }
}
