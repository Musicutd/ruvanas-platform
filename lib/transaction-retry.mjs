const RETRYABLE_TRANSACTION_CODES = new Set(["P2002", "P2034"]);

export function isRetryableTransactionError(error) {
  return RETRYABLE_TRANSACTION_CODES.has(error?.code);
}

export async function runSerializableTransaction(
  database,
  operation,
  { maxAttempts = 3, retryDelayMs = 0 } = {}
) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: "Serializable"
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
