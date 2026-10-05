const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function subscriberTestResetAvailable(environment = process.env) {
  if (environment.SUBSCRIBER_TEST_RESET_ENABLED !== "1" || environment.NODE_ENV !== "development") {
    return false;
  }

  try {
    const databaseUrl = new URL(environment.DATABASE_URL);
    return ["postgres:", "postgresql:"].includes(databaseUrl.protocol)
      && LOCAL_DATABASE_HOSTS.has(databaseUrl.hostname);
  } catch {
    return false;
  }
}
