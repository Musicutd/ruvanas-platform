const RETRYABLE_TRANSACTION_CODES = new Set(["P2002", "P2034"]);

export function isRetryableTransactionError(error) {
  // Prisma reports PostgreSQL serialization failures from $queryRaw as P2010
  // rather than P2034. The SQLSTATE must still be checked so unrelated raw
  // query failures do not enter the retry loop.
  return RETRYABLE_TRANSACTION_CODES.has(error?.code) ||
    (error?.code === "P2010" && error?.meta?.code === "40001");
}

export async function runSerializableTransaction(
  database,
  operation,
  { maxAttempts = 3, retryDelayMs = 0, timeout } = {}
) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: "Serializable",
        ...(timeout === undefined ? {} : { timeout })
      });
    } catch (error) {
      lastError = error;

      if (!isRetryableTransactionError(error) || attempt === maxAttempts) {
        throw error;
      }
      if (retryDelayMs > 0) {
        const delayMs = Math.min(200, retryDelayMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * retryDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
