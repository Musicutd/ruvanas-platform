export function requireEnvironment(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function requireEnvironmentGroup(names, serviceName) {
  const missing = names.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `${serviceName} is not configured. Missing environment variables: ${missing.join(
        ", "
      )}`
    );
  }

  return Object.fromEntries(
    names.map((name) => [name, process.env[name].trim()])
  );
}
